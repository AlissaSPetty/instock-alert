import { rm } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import {
  createTrackingRequestSchema,
  fetchStockState,
  inspectUrlRequestSchema,
  normalizeHost,
  profileSettingsSchema,
  refreshIntervalSeconds,
  slugify,
  type NotificationChannel,
  type ProfileSettings,
  type StockCheckTarget,
} from "@pricechecker/shared";
import { requireApproved, requireUser, type AuthenticatedRequest } from "./auth.js";
import { captureStockRequests } from "./capture.js";
import { inspectProductUrl } from "./inspect.js";
import { findClosestMsrpPrice, type MsrpPriceRow } from "./msrp/matching.js";
import { verifyWebsiteAndItem } from "./preflight.js";
import { getBlockedSite } from "./siteCapabilities.js";
import { supabaseService } from "./supabase.js";

export const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

router.get("/me", requireUser, (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  res.json({
    id: user.id,
    email: user.email,
    appMetadata: user.app_metadata,
  });
});

router.get("/settings", requireUser, requireApproved, async (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const profile = await getOrCreateProfileSettings(user.id, user.email ?? null);
    res.json({ profile });
  } catch (error) {
    next(error);
  }
});

router.patch("/settings", requireUser, requireApproved, async (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const parsed = profileSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const profile = await updateProfileSettings(user.id, parsed.data);
    res.json({ profile });
  } catch (error) {
    next(error);
  }
});

router.post("/track/inspect-url", requireUser, requireApproved, async (req, res, next) => {
  try {
    const parsed = inspectUrlRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const result = await inspectProductUrl(parsed.data.websiteUrl);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/track/preflight", requireUser, requireApproved, async (req, res, next) => {
  try {
    const parsed = createTrackingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const result = await verifyWebsiteAndItem({
      websiteUrl: parsed.data.verifiedUrl ?? parsed.data.websiteUrl,
      itemName: parsed.data.itemName,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/track", requireUser, requireApproved, async (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const parsed = createTrackingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const input = parsed.data;
    const profile = await getOrCreateProfileSettings(user.id, user.email ?? null);
    if (!profile.email && !profile.phone) {
      res.status(409).json({
        error: "Add an email address or phone number in settings before creating tracking requests.",
      });
      return;
    }

    if (!canUseNotificationPreference(profile, input.notificationPreference)) {
      res.status(409).json({
        error: "Configure that notification method in settings before creating tracking requests.",
      });
      return;
    }

    const urlToUse = input.verifiedUrl ?? input.websiteUrl;
    const blockedSite = getBlockedSite(urlToUse);

    if (blockedSite) {
      res.status(409).json({
        status: "no_candidates",
        websiteHost: normalizeHost(urlToUse),
        reason: blockedSite.reason,
        candidates: [],
      });
      return;
    }

    const preflight = await verifyWebsiteAndItem({
      websiteUrl: urlToUse,
      itemName: input.itemName,
    });

    if (preflight.status !== "verified" || !preflight.finalUrl) {
      res.status(409).json(preflight);
      return;
    }

    const capture = await captureStockRequests(preflight.finalUrl, input.itemName);
    const target = await upsertTarget({
      canonicalUrl: preflight.finalUrl,
      websiteHost: normalizeHost(preflight.finalUrl),
      websiteName: capture.websiteName,
      websiteSlug: capture.websiteSlug,
      itemName: input.itemName,
      itemSlug: slugify(input.itemName),
      requestPattern: {
        method: capture.selectedRequest.method,
        url: capture.selectedRequest.url,
        postData: capture.selectedRequest.postData,
        contentType: capture.selectedRequest.contentType,
      },
      generatedFolderPath: capture.folderPath,
      refreshSeconds: refreshIntervalSeconds[input.refreshInterval],
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    });

    const matchedMsrpPrice = input.msrpPrice ?? (await loadClosestMsrpPrice(input.itemName));
    const trackedItem = await createSubscription({
      userId: user.id,
      targetId: target.id,
      msrpPrice: matchedMsrpPrice,
      notificationPreference: input.notificationPreference,
      refreshInterval: input.refreshInterval,
      refreshSeconds: refreshIntervalSeconds[input.refreshInterval],
    });

    await runImmediateStockCheckForTarget(target.id);

    await recordUsage(user.id, "tracking_created", {
      targetId: target.id,
      trackedItemId: trackedItem.id,
      websiteHost: target.website_host,
    });

    const { data: latestTarget, error: latestTargetError } = await supabaseService
      .from("scrape_targets")
      .select("*")
      .eq("id", target.id)
      .single();

    if (latestTargetError) {
      throw latestTargetError;
    }

    res.status(201).json({ trackedItem, target: latestTarget ?? target });
  } catch (error) {
    next(error);
  }
});

router.get("/dashboard", requireUser, requireApproved, async (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const items = await loadDashboardItems(user.id);
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.patch("/tracked-items/:id", requireUser, requireApproved, async (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const isActive = Boolean(req.body?.isActive);

    const { data, error } = await supabaseService
      .from("tracked_items")
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("user_id", user.id)
      .select("id,target_id,is_active")
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      res.status(404).json({ error: "Tracked item not found." });
      return;
    }

    await recalculateTargetCadence(data.target_id);
    res.json({ trackedItem: data });
  } catch (error) {
    next(error);
  }
});

router.delete("/tracked-items/:id", requireUser, requireApproved, async (req, res, next) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const { data: trackedItem, error: lookupError } = await supabaseService
      .from("tracked_items")
      .select(
        `
        id,
        target_id,
        scrape_targets (
          generated_folder_path
        )
      `,
      )
      .eq("id", req.params.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    if (!trackedItem) {
      res.status(404).json({ error: "Tracked item not found." });
      return;
    }

    const targetId = trackedItem.target_id;
    const relatedTarget = Array.isArray(trackedItem.scrape_targets)
      ? trackedItem.scrape_targets[0]
      : trackedItem.scrape_targets;
    const folderPath = relatedTarget?.generated_folder_path ?? null;
    const { error: deleteError } = await supabaseService
      .from("tracked_items")
      .delete()
      .eq("id", trackedItem.id)
      .eq("user_id", user.id);

    if (deleteError) {
      throw deleteError;
    }

    const hasRemainingSubscribers = await targetHasSubscribers(targetId);
    if (hasRemainingSubscribers) {
      await recalculateTargetCadence(targetId);
    } else {
      await deleteScrapeTarget(targetId);
      await deleteScraperFolderIfUnused(folderPath);
    }

    await recordUsage(user.id, "tracking_deleted", {
      targetId,
      trackedItemId: trackedItem.id,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

async function upsertTarget(input: {
  canonicalUrl: string;
  websiteHost: string;
  websiteName: string;
  websiteSlug: string;
  itemName: string;
  itemSlug: string;
  imageUrl?: string;
  requestPattern: Record<string, unknown>;
  generatedFolderPath: string;
  refreshSeconds: number;
}) {
  const values = {
    canonical_url: input.canonicalUrl,
    website_host: input.websiteHost,
    website_name: input.websiteName,
    website_slug: input.websiteSlug,
    item_name: input.itemName,
    item_slug: input.itemSlug,
    image_url: input.imageUrl ?? null,
    request_pattern: input.requestPattern,
    generated_folder_path: input.generatedFolderPath,
    minimum_refresh_seconds: input.refreshSeconds,
    next_check_at: new Date(Date.now() + 15_000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await upsertScrapeTarget(values);

  if (isMissingColumnError(error, "image_url")) {
    const { image_url: _imageUrl, ...valuesWithoutImage } = values;
    const fallback = await upsertScrapeTarget(valuesWithoutImage);
    if (fallback.error) {
      throw fallback.error;
    }

    return fallback.data;
  }

  if (error) {
    throw error;
  }

  return data;
}

async function loadDashboardItems(userId: string) {
  const attempts = [
    { includeImageUrl: true, includePrices: true, includeMsrp: true },
    { includeImageUrl: true, includePrices: false, includeMsrp: true },
    { includeImageUrl: false, includePrices: false, includeMsrp: true },
    { includeImageUrl: false, includePrices: false, includeMsrp: false },
  ];

  for (const attempt of attempts) {
    const { data, error } = await dashboardItemsQuery(attempt)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (!error) {
      return hydrateDashboardMsrpPrices(withDashboardDefaults(data ?? [], attempt));
    }

    if (!isDashboardSchemaFallbackError(error)) {
      throw error;
    }
  }

  return [];
}

function dashboardItemsQuery(options: { includeImageUrl: boolean; includePrices: boolean; includeMsrp: boolean }) {
  return supabaseService.from("tracked_items").select(`
    id,
    target_id,
    ${options.includeMsrp ? "msrp_price," : ""}
    refresh_interval,
    is_active,
    scrape_targets (
      canonical_url,
      website_name,
      website_host,
      item_name,
      ${options.includeImageUrl ? "image_url," : ""}
      ${options.includePrices ? "last_known_price, last_known_currency," : ""}
      last_known_in_stock,
      last_checked_at
    )
  `);
}

async function loadClosestMsrpPrice(itemName: string): Promise<number | null> {
  const rows = await loadMsrpPriceRows();
  return findClosestMsrpPrice(itemName, rows)?.price ?? null;
}

async function loadMsrpPriceRows(): Promise<MsrpPriceRow[]> {
  const withType = await supabaseService
    .from("msrp_prices")
    .select("product_name,normalized_name,type,price,currency")
    .order("scraped_at", { ascending: false })
    .limit(5000);

  if (!withType.error) {
    return (withType.data ?? []) as MsrpPriceRow[];
  }

  if (!isMissingColumnError(withType.error, "type")) {
    if (isMissingMsrpPricesTableError(withType.error)) {
      return [];
    }
    throw withType.error;
  }

  const withoutType = await supabaseService
    .from("msrp_prices")
    .select("product_name,normalized_name,price,currency")
    .order("scraped_at", { ascending: false })
    .limit(5000);

  if (withoutType.error) {
    if (isMissingMsrpPricesTableError(withoutType.error)) {
      return [];
    }
    throw withoutType.error;
  }

  return (withoutType.data ?? []) as MsrpPriceRow[];
}

async function hydrateDashboardMsrpPrices(items: unknown[]) {
  if (!items.some((item) => isDashboardItemMissingMsrp(item))) {
    return items;
  }

  const rows = await loadMsrpPriceRows();
  if (rows.length === 0) {
    return items;
  }

  return items.map((item) => {
    if (!isDashboardItemMissingMsrp(item)) {
      return item;
    }

    const target = item.scrape_targets;
    const match = findClosestMsrpPrice(target.item_name, rows);
    return match ? { ...item, msrp_price: match.price } : item;
  });
}

function withDashboardDefaults(
  items: unknown[],
  options: { includeImageUrl: boolean; includePrices: boolean; includeMsrp: boolean },
) {
  return items.map((item) => {
    if (!isRecord(item)) {
      return item;
    }

    if (!isRecord(item.scrape_targets)) {
      return options.includeMsrp ? item : { ...item, msrp_price: null };
    }

    return {
      ...item,
      ...(options.includeMsrp ? {} : { msrp_price: null }),
      scrape_targets: {
        ...item.scrape_targets,
        ...(options.includeImageUrl ? {} : { image_url: null }),
        ...(options.includePrices ? {} : { last_known_price: null, last_known_currency: null }),
      },
    };
  });
}

function isDashboardItemMissingMsrp(
  item: unknown,
): item is Record<string, unknown> & { scrape_targets: Record<string, unknown> & { item_name: string } } {
  if (!isRecord(item) || item.msrp_price != null || !isRecord(item.scrape_targets)) {
    return false;
  }

  return typeof item.scrape_targets.item_name === "string";
}

function isDashboardSchemaFallbackError(error: unknown): boolean {
  return ["image_url", "msrp_price", "last_known_price", "last_known_currency"].some((column) =>
    isMissingColumnError(error, column),
  );
}

function upsertScrapeTarget(values: Record<string, unknown>) {
  return supabaseService
    .from("scrape_targets")
    .upsert(values, { onConflict: "website_host,item_slug,canonical_url" })
    .select("*")
    .single();
}

async function targetHasSubscribers(targetId: string): Promise<boolean> {
  const { data, error } = await supabaseService.from("tracked_items").select("id").eq("target_id", targetId).limit(1);

  if (error) {
    throw error;
  }

  return Boolean(data?.length);
}

async function deleteScrapeTarget(targetId: string) {
  const { error } = await supabaseService.from("scrape_targets").delete().eq("id", targetId);

  if (error) {
    throw error;
  }
}

async function deleteScraperFolderIfUnused(folderPath: string | null) {
  if (!folderPath) {
    return;
  }

  const { data, error } = await supabaseService
    .from("scrape_targets")
    .select("id")
    .eq("generated_folder_path", folderPath)
    .limit(1);

  if (error) {
    throw error;
  }

  if (data?.length) {
    return;
  }

  const scrapersRoot = path.resolve(process.cwd(), "scrapers");
  const absoluteFolderPath = path.resolve(process.cwd(), folderPath);

  if (!absoluteFolderPath.startsWith(`${scrapersRoot}${path.sep}`)) {
    return;
  }

  await rm(absoluteFolderPath, { recursive: true, force: true });
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  return (
    isRecord(error) &&
    typeof error.message === "string" &&
    (error.message.includes(`'${columnName}' column`) || error.message.includes(`.${columnName} does not exist`))
  );
}

function isMissingMsrpPricesTableError(error: unknown): boolean {
  return (
    isRecord(error) &&
    typeof error.message === "string" &&
    error.message.includes("msrp_prices") &&
    error.message.includes("does not exist")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getOrCreateProfileSettings(userId: string, authEmail: string | null) {
  const { data, error } = await supabaseService
    .from("profiles")
    .select("email,phone,notification_preference")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return toProfileSettings(data);
  }

  const inserted = await updateProfileSettings(userId, {
    email: authEmail ?? "",
    phone: "",
    notificationPreference: "email",
  });
  return inserted;
}

async function updateProfileSettings(userId: string, input: ProfileSettings) {
  const email = input.email || null;
  const phone = input.phone || null;
  const notificationPreference = normalizeNotificationPreference(email, phone, input.notificationPreference);
  const { data, error } = await supabaseService
    .from("profiles")
    .upsert(
      {
        id: userId,
        email,
        phone,
        notification_preference: notificationPreference,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("email,phone,notification_preference")
    .single();

  if (error) {
    throw error;
  }

  return toProfileSettings(data);
}

function toProfileSettings(profile: {
  email: string | null;
  phone: string | null;
  notification_preference: string | null;
}): ProfileSettings {
  const email = profile.email ?? "";
  const phone = profile.phone ?? "";
  return {
    email,
    phone,
    notificationPreference: normalizeNotificationPreference(
      email,
      phone,
      profile.notification_preference === "sms" ? "sms" : "email",
    ),
  };
}

function normalizeNotificationPreference(
  email: string | null,
  phone: string | null,
  preference: NotificationChannel,
): NotificationChannel {
  if (email && phone) {
    return preference;
  }

  if (phone) {
    return "sms";
  }

  return "email";
}

function canUseNotificationPreference(profile: ProfileSettings, preference: NotificationChannel): boolean {
  return preference === "sms" ? Boolean(profile.phone) : Boolean(profile.email);
}

async function createSubscription(input: {
  userId: string;
  targetId: string;
  msrpPrice?: number | null;
  notificationPreference: NotificationChannel;
  refreshInterval: string;
  refreshSeconds: number;
}) {
  const { data, error } = await supabaseService
    .from("tracked_items")
    .upsert(
      {
        user_id: input.userId,
        target_id: input.targetId,
        msrp_price: input.msrpPrice ?? null,
        notification_preference: input.notificationPreference,
        refresh_interval: input.refreshInterval,
        refresh_seconds: input.refreshSeconds,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,target_id" },
    )
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  await recalculateTargetCadence(input.targetId);
  return data;
}

async function recalculateTargetCadence(targetId: string) {
  const { data, error } = await supabaseService
    .from("tracked_items")
    .select("refresh_seconds")
    .eq("target_id", targetId)
    .eq("is_active", true);

  if (error) {
    throw error;
  }

  const minimum = Math.min(...(data ?? []).map((item) => item.refresh_seconds));
  const minimumRefreshSeconds = Number.isFinite(minimum) ? minimum : 3600;

  const { error: updateError } = await supabaseService
    .from("scrape_targets")
    .update({
      minimum_refresh_seconds: minimumRefreshSeconds,
      next_check_at: new Date(Date.now() + minimumRefreshSeconds * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetId);

  if (updateError) {
    throw updateError;
  }
}

async function runImmediateStockCheckForTarget(targetId: string) {
  const { data: row, error } = await supabaseService
    .from("scrape_targets")
    .select("id,canonical_url,website_host,request_pattern,minimum_refresh_seconds")
    .eq("id", targetId)
    .maybeSingle();

  if (error || !row) {
    console.error("Immediate stock check skipped: target not loaded", error);
    return;
  }

  const pattern = row.request_pattern as StockCheckTarget["request_pattern"];
  const stockTarget: StockCheckTarget = {
    canonical_url: row.canonical_url,
    website_host: row.website_host,
    request_pattern: pattern ?? {},
  };

  const scheduleNextCheck = () => new Date(Date.now() + row.minimum_refresh_seconds * 1000).toISOString();

  try {
    const result = await fetchStockState(stockTarget);
    await supabaseService.from("stock_checks").insert({
      target_id: row.id,
      in_stock: result.inStock,
      status_code: result.statusCode,
      price: result.inStock ? result.price : null,
      currency: result.inStock ? result.currency : null,
      response_summary: result.summary,
    });
    const values: Record<string, unknown> = {
      last_checked_at: new Date().toISOString(),
      last_known_in_stock: result.inStock,
      last_error: null,
      next_check_at: scheduleNextCheck(),
      updated_at: new Date().toISOString(),
    };

    if (result.inStock) {
      values.last_known_price = result.price;
      values.last_known_currency = result.currency;
    }

    await supabaseService.from("scrape_targets").update(values).eq("id", row.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Immediate stock check failed.";
    await supabaseService.from("stock_checks").insert({
      target_id: row.id,
      in_stock: null,
      status_code: null,
      response_summary: {},
      error: message,
    });
    await supabaseService
      .from("scrape_targets")
      .update({
        last_checked_at: new Date().toISOString(),
        last_known_in_stock: null,
        last_error: message,
        next_check_at: scheduleNextCheck(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }
}

async function recordUsage(userId: string, eventType: string, metadata: Record<string, unknown>) {
  await supabaseService.from("usage_events").insert({
    user_id: userId,
    event_type: eventType,
    metadata,
  });
}
