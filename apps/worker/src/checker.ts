import { createClient } from "@supabase/supabase-js";
import { fetchStockState, type StockCheckTarget } from "@pricechecker/shared";
import { config } from "./config.js";
import { sendInventoryAlertEmail } from "./email.js";

export interface ScrapeTarget extends StockCheckTarget {
  id: string;
  item_name: string;
  minimum_refresh_seconds: number;
}

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const hostLocks = new Set<string>();

export { detectInStock, fetchStockState } from "@pricechecker/shared";

export async function runWorkerBatch() {
  const targets = await listDueTargets();

  for (const target of targets) {
    if (hostLocks.has(target.website_host)) {
      continue;
    }

    hostLocks.add(target.website_host);
    try {
      await runStockCheck(target);
    } finally {
      hostLocks.delete(target.website_host);
    }
  }
}

export async function listDueTargets(): Promise<ScrapeTarget[]> {
  const { data, error } = await supabase
    .from("scrape_targets")
    .select("id,canonical_url,website_host,item_name,request_pattern,minimum_refresh_seconds")
    .lte("next_check_at", new Date().toISOString())
    .order("next_check_at", { ascending: true })
    .limit(config.WORKER_BATCH_SIZE);

  if (error) {
    throw error;
  }

  return (data ?? []) as ScrapeTarget[];
}

export async function runStockCheck(target: ScrapeTarget) {
  const checkStartedAt = new Date();

  try {
    const result = await fetchStockState(target);
    await recordStockCheck(target, result.inStock, result.statusCode, result.summary, result.price, result.currency);
    await updateTargetAfterCheck(target, result.inStock, null, new Date(), result.price, result.currency);

    if (result.inStock) {
      await fanOutNotifications(target);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error.";
    await recordStockCheck(target, null, null, {}, null, null, message);
    await updateTargetAfterCheck(target, null, message, checkStartedAt);
  }
}

async function recordStockCheck(
  target: ScrapeTarget,
  inStock: boolean | null,
  statusCode: number | null,
  summary: Record<string, unknown>,
  price: number | null = null,
  currency: string | null = null,
  error?: string,
) {
  const { error: insertError } = await supabase.from("stock_checks").insert({
    target_id: target.id,
    in_stock: inStock,
    status_code: statusCode,
    price: inStock ? price : null,
    currency: inStock ? currency : null,
    response_summary: summary,
    error,
  });

  if (insertError) {
    throw insertError;
  }
}

async function updateTargetAfterCheck(
  target: ScrapeTarget,
  inStock: boolean | null,
  error: string | null,
  from = new Date(),
  price: number | null = null,
  currency: string | null = null,
) {
  const nextCheck = new Date(from.getTime() + target.minimum_refresh_seconds * 1000);
  const values: Record<string, unknown> = {
    last_checked_at: new Date().toISOString(),
    last_known_in_stock: inStock,
    last_error: error,
    next_check_at: nextCheck.toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (inStock) {
    values.last_known_price = price;
    values.last_known_currency = currency;
  }

  const { error: updateError } = await supabase.from("scrape_targets").update(values).eq("id", target.id);

  if (updateError) {
    throw updateError;
  }
}

async function fanOutNotifications(target: ScrapeTarget) {
  const { data, error } = await supabase
    .from("tracked_items")
    .select("id,user_id,notification_preference")
    .eq("target_id", target.id)
    .eq("is_active", true);

  if (error) {
    throw error;
  }

  const items = data ?? [];
  if (items.length === 0) {
    return;
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,phone,notification_preference")
    .in(
      "id",
      items.map((item) => item.user_id),
    );

  if (profileError) {
    throw profileError;
  }

  const profilesByUserId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  const rows: Array<{
    user_id: string;
    tracked_item_id: string;
    target_id: string;
    channel: string;
    destination: string | null;
    message: string;
    status: string;
  }> = [];

  for (const item of items) {
    const message = `${target.item_name} appears to be in stock: ${target.canonical_url}`;
    const profile = profilesByUserId.get(item.user_id);
    const destination = notificationDestination(
      profile,
      item.notification_preference === "sms" || item.notification_preference === "email"
        ? item.notification_preference
        : undefined,
    );

    let status = "logged";

    if (destination.channel === "email" && destination.destination) {
      const sendResult = await sendInventoryAlertEmail(destination.destination, message);
      if (sendResult.kind === "sent") {
        status = "sent";
      } else if (sendResult.kind === "failed") {
        status = "failed";
      } else {
        status = "logged";
      }
    }

    rows.push({
      user_id: item.user_id,
      tracked_item_id: item.id,
      target_id: target.id,
      channel: destination.channel,
      destination: destination.destination,
      message,
      status,
    });
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("notification_events").insert(rows);
    if (insertError) {
      throw insertError;
    }
  }
}

function notificationDestination(profile?: {
  email: string | null;
  phone: string | null;
  notification_preference: string | null;
}, preference?: "email" | "sms") {
  const notificationPreference = preference ?? (profile?.notification_preference === "sms" ? "sms" : "email");

  if (profile?.email && profile?.phone) {
    return notificationPreference === "sms"
      ? { channel: "sms", destination: profile.phone }
      : { channel: "email", destination: profile.email };
  }

  if (profile?.phone) {
    return { channel: "sms", destination: profile.phone };
  }

  if (profile?.email) {
    return { channel: "email", destination: profile.email };
  }

  return { channel: "log", destination: null };
}
