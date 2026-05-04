import React, { useEffect, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import {
  APPROVED_ROLE,
  createTrackingRequestSchema,
  hasApprovedRole,
  profileSettingsSchema,
  refreshIntervals,
  type CreateTrackingRequest,
  type DashboardItem,
  type InspectUrlResult,
  type NotificationChannel,
  type ProfileSettings,
  type ProductCandidate,
} from "@pricechecker/shared";
import { apiDelete, apiGet, apiPatch, createTracking, getSettings, inspectUrl, updateSettings } from "./api";
import { supabase } from "./supabase";
import "./styles.css";

const THEME_STORAGE_KEY = "pricechecker-theme";
const trackingFormRefreshIntervals = refreshIntervals.filter((interval) => interval !== "5min");

type DashboardApiItem = {
  id: string;
  target_id: string;
  msrp_price: number | string | null;
  refresh_interval: DashboardItem["refreshInterval"];
  is_active: boolean;
  scrape_targets?: {
    canonical_url: string;
    website_name: string | null;
    website_host: string;
    item_name: string;
    image_url: string | null;
    last_known_price: number | string | null;
    last_known_currency: string | null;
    last_known_in_stock: boolean | null;
    last_checked_at: string | null;
  } | null;
};

function readInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") {
    return "light";
  }

  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {
    /* ignore */
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">(readInitialTheme);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  if (loading) {
    return <main className="shell">Loading...</main>;
  }

  if (!session) {
    return <AuthPanel />;
  }

  if (!hasApprovedRole(session.user.app_metadata, APPROVED_ROLE)) {
    return <PendingApproval email={session.user.email ?? ""} />;
  }

  return <Dashboard onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} theme={theme} />;
}

function AuthPanel() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");

    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    if (mode === "signup") {
      setMessage("Thanks for signing up. You will be able to use Pricechecker once your account is approved.");
    }
  }

  return (
    <main className="shell auth">
      <section className="card">
        <h1>Pricechecker</h1>
        <p>Create an account or log in to manage inventory alerts.</p>
        <form onSubmit={submit} className="stack">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              minLength={6}
              required
            />
          </label>
          <button type="submit">{mode === "login" ? "Log in" : "Create account"}</button>
        </form>
        <button className="link" type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Need an account?" : "Already have an account?"}
        </button>
        {message ? <p className="notice">{message}</p> : null}
      </section>
    </main>
  );
}

function PendingApproval({ email }: { email: string }) {
  return (
    <main className="shell auth">
      <section className="card">
        <h1>Thanks for signing up</h1>
        <p>
          Your account{email ? ` (${email})` : ""} is waiting for approval. Once your Supabase Auth app metadata role is
          set to <code>{APPROVED_ROLE}</code>, refresh or log in again to access tracking.
        </p>
        <button type="button" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </section>
    </main>
  );
}

function Dashboard({
  onToggleTheme,
  theme,
}: {
  onToggleTheme: () => void;
  theme: "light" | "dark";
}) {
  const [items, setItems] = useState<DashboardApiItem[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [settingsRefreshKey, setSettingsRefreshKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    apiGet<{ items: DashboardApiItem[] }>("/dashboard").then((data) => setItems(data.items)).catch(console.error);
  }, [refreshKey]);

  useEffect(() => {
    if (!items.some((item) => item.is_active && item.scrape_targets?.last_checked_at === null)) {
      return;
    }

    const interval = window.setInterval(() => setRefreshKey((value) => value + 1), 15_000);
    return () => window.clearInterval(interval);
  }, [items]);

  async function toggleItem(id: string, isActive: boolean) {
    await apiPatch(`/tracked-items/${id}`, { isActive: !isActive });
    setRefreshKey((value) => value + 1);
  }

  async function deleteItem(id: string) {
    const confirmed = window.confirm(
      "Are you sure? This will remove the tracker and you will need to request the tracker again.",
    );
    if (!confirmed) {
      return;
    }

    await apiDelete(`/tracked-items/${id}`);
    setRefreshKey((value) => value + 1);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Pricechecker</h1>
          <p>Track verified product pages and manage active alerts.</p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="secondary theme-toggle"
            onClick={onToggleTheme}
            aria-pressed={theme === "dark"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button type="button" onClick={() => setShowSettings((value) => !value)}>
            Settings
          </button>
          <button type="button" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {showSettings ? <SettingsPanel onSaved={() => setSettingsRefreshKey((value) => value + 1)} /> : null}
      <TrackingForm
        onConfigureSettings={() => setShowSettings(true)}
        onCreated={() => setRefreshKey((value) => value + 1)}
        settingsRefreshKey={settingsRefreshKey}
      />

      <section className="card">
        <h2>Your tracked items</h2>
        {items.length === 0 ? <p>No tracked items yet.</p> : null}
        <div className="grid">
          {items.map((item) => {
            const target = item.scrape_targets;
            const price = numberOrNull(target?.last_known_price);
            const msrp = numberOrNull(item.msrp_price);
            const priceStatus =
              target?.last_known_in_stock && price !== null && msrp !== null ? getPriceStatus(price, msrp) : null;
            const hasCurrentPrice = target?.last_known_in_stock && price !== null;
            const isPendingFirstCheck = item.is_active && target?.last_checked_at === null;
            return (
              <article className="item-card" key={item.id}>
                <a className="item-link" href={target?.canonical_url}>
                  {target?.image_url ? <img className="item-image" src={target.image_url} alt="" /> : null}
                  <div>
                    <h3>{target?.item_name}</h3>
                    <p>{target?.website_name ?? target?.website_host}</p>
                    <p>Refresh: {item.refresh_interval}</p>
                    <p>Status: {stockStatusLabel(target?.last_known_in_stock, isPendingFirstCheck)}</p>
                    {isPendingFirstCheck ? <p>First stock check pending. This updates automatically.</p> : null}
                    {msrp !== null ? <p>MSRP: {formatMoney(msrp, target?.last_known_currency)}</p> : null}
                    {hasCurrentPrice ? (
                      <p>
                        Price:{" "}
                        <span className={`price-pill ${priceStatus?.className ?? ""}`}>
                          {formatMoney(price!, target?.last_known_currency)}
                        </span>{" "}
                        {priceStatus ? <span className="price-overage">{priceStatus.label}</span> : null}
                      </p>
                    ) : target?.last_known_in_stock ? (
                      <p>Price: unavailable from the latest stock check</p>
                    ) : null}
                  </div>
                </a>
                <div className="item-actions">
                  <button type="button" onClick={() => toggleItem(item.id, item.is_active)}>
                    {item.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button type="button" className="danger" onClick={() => deleteItem(item.id)}>
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function numberOrNull(value: number | string | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value: number, currency?: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function stockStatusLabel(inStock: boolean | null | undefined, isPendingFirstCheck: boolean): string {
  if (isPendingFirstCheck) {
    return "Checking now...";
  }

  return inStock ? "In stock" : "Not in stock or unknown";
}

function getPriceStatus(price: number, msrp: number): { className: string; label: string } {
  const overMsrpPercent = Math.max(0, ((price - msrp) / msrp) * 100);

  if (overMsrpPercent === 0) {
    return { className: "price-good", label: "0% over MSRP" };
  }

  return {
    className: overMsrpPercent <= 20 ? "price-watch" : "price-high",
    label: `${formatPercent(overMsrpPercent)} over MSRP`,
  };
}

function formatPercent(value: number): string {
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

function TrackingForm({
  onConfigureSettings,
  onCreated,
  settingsRefreshKey,
}: {
  onConfigureSettings: () => void;
  onCreated: () => void;
  settingsRefreshKey: number;
}) {
  type TrackingDraft = Pick<CreateTrackingRequest, "websiteUrl" | "refreshInterval">;
  const emptyForm: TrackingDraft = {
    websiteUrl: "",
    refreshInterval: "15min",
  };
  const [form, setForm] = useState(emptyForm);
  const [inspection, setInspection] = useState<InspectUrlResult | null>(null);
  const [settings, setSettings] = useState<ProfileSettings | null>(null);
  const [alertPreference, setAlertPreference] = useState<NotificationChannel>("email");
  const [message, setMessage] = useState("");
  const [busyState, setBusyState] = useState<"idle" | "inspecting" | "tracking">("idle");
  const [settingsLoading, setSettingsLoading] = useState(true);

  useEffect(() => {
    setSettingsLoading(true);
    getSettings()
      .then(({ profile }) => {
        setSettings(profile);
        setAlertPreference(defaultAlertPreference(profile));
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load notification settings."))
      .finally(() => setSettingsLoading(false));
  }, [settingsRefreshKey]);

  function update<K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!hasAnyAlertMethod(settings)) {
      return;
    }

    setMessage("");
    setInspection(null);

    setBusyState("inspecting");
    try {
      const [{ profile }, result] = await Promise.all([
        getSettings(),
        inspectUrl({ websiteUrl: form.websiteUrl }),
      ]);
      setSettings(profile);
      setAlertPreference(defaultAlertPreference(profile));
      setInspection(result);

      if (result.status === "candidates_found") {
        setMessage("Choose the product you want to track.");
        return;
      }

      setMessage(result.reason ?? "No products were found on this page.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to inspect this URL.");
    } finally {
      setBusyState("idle");
    }
  }

  async function trackCandidate(candidate: ProductCandidate) {
    if (!hasAnyAlertMethod(settings)) {
      return;
    }

    const trackingRequest: CreateTrackingRequest = {
      websiteUrl: form.websiteUrl,
      verifiedUrl: candidate.url,
      itemName: candidate.title,
      notificationPreference: alertPreference,
      refreshInterval: form.refreshInterval,
      ...(candidate.image ? { imageUrl: candidate.image } : {}),
    };

    setBusyState("tracking");
    setMessage("Creating tracker and starting the first stock check. This can take up to a minute.");

    try {
      const parsed = createTrackingRequestSchema.safeParse(trackingRequest);
      if (!parsed.success) {
        setMessage(parsed.error.issues[0]?.message ?? "Check the form values.");
        return;
      }

      await createTracking(parsed.data);
      setInspection(null);
      setMessage("Tracking request created. First stock check is running in the background.");
      setForm(emptyForm);
      onCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create tracking request.");
    } finally {
      setBusyState("idle");
    }
  }

  const busy = busyState !== "idle";
  const formDisabled = busy || settingsLoading || !hasAnyAlertMethod(settings);

  return (
    <section className="card">
      <h2>Add a tracking request</h2>
      {!settingsLoading && !hasAnyAlertMethod(settings) ? (
        <p className="notice">
          You need to configure alert preferences before you can use this form.{" "}
          <button type="button" className="link inline-link" onClick={onConfigureSettings}>
            Click here
          </button>{" "}
          to configure your alert preferences.
        </p>
      ) : null}
      <form onSubmit={submit} className="stack">
        <label>
          Product or collection URL
          <input
            value={form.websiteUrl}
            disabled={formDisabled}
            onChange={(event) => update("websiteUrl", event.target.value)}
            required
          />
        </label>
        <label>
          Refresh rate
          <select
            value={form.refreshInterval}
            disabled={formDisabled}
            onChange={(event) => update("refreshInterval", event.target.value as CreateTrackingRequest["refreshInterval"])}
          >
            {trackingFormRefreshIntervals.map((interval) => (
              <option key={interval} value={interval}>
                {interval}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={formDisabled}>
          {busyState === "inspecting" ? "Inspecting..." : "Find products on this page"}
        </button>
      </form>
      {message ? <p className="notice">{message}</p> : null}
      {inspection?.candidates.length ? (
        <div className="suggestions">
          <AlertPreferenceField
            preference={alertPreference}
            settings={settings}
            onChange={setAlertPreference}
          />
          <h3>Choose an item to track</h3>
          {inspection.candidates.map((candidate) => (
            <article key={`${candidate.title}-${candidate.url}`} className="suggestion product-candidate">
              {candidate.image ? <img src={candidate.image} alt="" /> : null}
              <div>
                <strong>{candidate.title}</strong>
                {candidate.price ? (
                  <p>
                    Price: {candidate.currency ? `${candidate.currency} ` : ""}
                    {candidate.price}
                  </p>
                ) : null}
                {candidate.availability ? <p>Availability: {candidate.availability}</p> : null}
                <small>{candidate.url}</small>
              </div>
              <button type="button" onClick={() => trackCandidate(candidate)} disabled={formDisabled}>
                {busyState === "tracking" ? "Creating tracker..." : "Track this item"}
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AlertPreferenceField({
  preference,
  settings,
  onChange,
}: {
  preference: NotificationChannel;
  settings: ProfileSettings | null;
  onChange: (preference: NotificationChannel) => void;
}) {
  const hasEmail = Boolean(settings?.email);
  const hasPhone = Boolean(settings?.phone);
  const hasBoth = hasEmail && hasPhone;
  const hasSingleMethod = hasEmail !== hasPhone;

  return (
    <fieldset>
      <legend>In-stock alert method</legend>
      <label className="radio">
        <input
          checked={preference === "email"}
          disabled={!hasBoth}
          name="trackingNotificationPreference"
          onChange={() => onChange("email")}
          type="radio"
        />
        Email
      </label>
      <label className="radio">
        <input
          checked={preference === "sms"}
          disabled={!hasBoth}
          name="trackingNotificationPreference"
          onChange={() => onChange("sms")}
          type="radio"
        />
        Text
      </label>
      {hasSingleMethod ? (
        <p className="notice">If you prefer to receive notifications in a different way, please configure it in Settings.</p>
      ) : null}
      {!hasEmail && !hasPhone ? <p className="notice">Add an email address or phone number in Settings to receive alerts.</p> : null}
    </fieldset>
  );
}

function defaultAlertPreference(settings: ProfileSettings): NotificationChannel {
  if (settings.email && settings.phone) {
    return settings.notificationPreference;
  }

  return settings.phone ? "sms" : "email";
}

function hasAnyAlertMethod(settings: ProfileSettings | null): boolean {
  return Boolean(settings?.email || settings?.phone);
}

function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const emptySettings: ProfileSettings = {
    email: "",
    phone: "",
    notificationPreference: "email",
  };
  const [settings, setSettings] = useState<ProfileSettings>(emptySettings);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    getSettings()
      .then(({ profile }) => setSettings(profile))
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load settings."))
      .finally(() => setBusy(false));
  }, []);

  function update<K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const parsed = profileSettingsSchema.safeParse(settings);
      if (!parsed.success) {
        setMessage(parsed.error.issues[0]?.message ?? "Check your notification settings.");
        return;
      }

      const { profile } = await updateSettings(parsed.data);
      setSettings(profile);
      onSaved();
      setMessage("Settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save settings.");
    } finally {
      setBusy(false);
    }
  }

  const hasEmail = Boolean(settings.email);
  const hasPhone = Boolean(settings.phone);

  return (
    <section className="card">
      <h2>Settings</h2>
      <form onSubmit={submit} className="stack">
        <div className="row">
          <label>
            Email
            <span className="input-action">
              <input
                value={settings.email ?? ""}
                onChange={(event) => update("email", event.target.value)}
                type="email"
              />
              <button type="button" className="secondary" onClick={() => update("email", "")}>
                Remove
              </button>
            </span>
          </label>
          <label>
            Phone
            <span className="input-action">
              <input value={settings.phone ?? ""} onChange={(event) => update("phone", event.target.value)} />
              <button type="button" className="secondary" onClick={() => update("phone", "")}>
                Remove
              </button>
            </span>
          </label>
        </div>
        {hasEmail && hasPhone ? (
          <fieldset>
            <legend>Notification method</legend>
            <label className="radio">
              <input
                checked={settings.notificationPreference === "email"}
                name="notificationPreference"
                onChange={() => update("notificationPreference", "email")}
                type="radio"
              />
              Email
            </label>
            <label className="radio">
              <input
                checked={settings.notificationPreference === "sms"}
                name="notificationPreference"
                onChange={() => update("notificationPreference", "sms")}
                type="radio"
              />
              Phone
            </label>
          </fieldset>
        ) : (
          <p className="notice">{notificationMessage(hasEmail, hasPhone)}</p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save settings"}
        </button>
      </form>
      {message ? <p className="notice">{message}</p> : null}
    </section>
  );
}

function notificationMessage(hasEmail: boolean, hasPhone: boolean) {
  if (hasEmail) {
    return "You will be notified through your saved email address.";
  }

  if (hasPhone) {
    return "You will be notified through your saved phone number.";
  }

  return "Add an email address or phone number to receive inventory notifications.";
}

createRoot(document.getElementById("root")!).render(<App />);
