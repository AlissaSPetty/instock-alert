import { z } from "zod";

export const APPROVED_ROLE = "pricechecker_approved";

export const refreshIntervals = [
  "5min",
  "15min",
  "30min",
  "1hour",
  "2hours",
  "5hours",
  "24hours",
] as const;

export type RefreshInterval = (typeof refreshIntervals)[number];

export const refreshIntervalSeconds: Record<RefreshInterval, number> = {
  "5min": 300,
  "15min": 900,
  "30min": 1800,
  "1hour": 3600,
  "2hours": 7200,
  "5hours": 18000,
  "24hours": 86400,
};

export const notificationPreferenceFields = {
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(7).max(32).optional().or(z.literal("")),
};

export const notificationChannels = ["email", "sms"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

export const profileSettingsSchema = z.object({
  ...notificationPreferenceFields,
  notificationPreference: z.enum(notificationChannels),
});

export const notificationPreferenceSchema = profileSettingsSchema.refine((value) => Boolean(value.email || value.phone), {
  message: "Enter an email address or phone number.",
  path: ["email"],
});

export type ProfileSettings = z.infer<typeof profileSettingsSchema>;

export const createTrackingRequestSchema = z.object({
  websiteUrl: z.string().url(),
  itemName: z.string().min(2).max(200),
  imageUrl: z.string().url().optional(),
  msrpPrice: z.coerce.number().positive().finite().nullable().optional(),
  notificationPreference: z.enum(notificationChannels),
  refreshInterval: z.enum(refreshIntervals),
  verifiedUrl: z.string().url().optional(),
});

export type CreateTrackingRequest = z.infer<typeof createTrackingRequestSchema>;

export const inspectUrlRequestSchema = z.object({
  websiteUrl: z.string().url(),
});

export type InspectUrlRequest = z.infer<typeof inspectUrlRequestSchema>;

export interface ProductCandidate {
  title: string;
  url: string;
  image?: string;
  price?: string;
  currency?: string;
  availability?: string;
  source: "json_ld" | "open_graph" | "page_title";
}

export interface InspectUrlResult {
  status: "candidates_found" | "no_candidates";
  finalUrl?: string;
  websiteHost?: string;
  reason?: string;
  candidates: ProductCandidate[];
}

export type PreflightStatus = "verified" | "needs_verification" | "failed";

export interface SearchSuggestion {
  title: string;
  url: string;
  displayLink?: string;
  snippet?: string;
}

export interface PreflightResult {
  status: PreflightStatus;
  finalUrl?: string;
  websiteHost?: string;
  reason?: string;
  suggestions?: SearchSuggestion[];
}

export interface DashboardItem {
  id: string;
  targetId: string;
  canonicalUrl: string;
  websiteName: string;
  websiteHost: string;
  itemName: string;
  imageUrl: string | null;
  msrpPrice: number | null;
  lastKnownPrice: number | null;
  lastKnownCurrency: string | null;
  refreshInterval: RefreshInterval;
  isActive: boolean;
  lastKnownInStock: boolean | null;
  lastCheckedAt: string | null;
}

export function normalizeHost(inputUrl: string): string {
  const url = new URL(inputUrl);
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function itemTokens(itemName: string): string[] {
  return itemName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

export function hasApprovedRole(
  appMetadata: Record<string, unknown> | null | undefined,
  approvedRole = APPROVED_ROLE,
): boolean {
  return appMetadata?.role === approvedRole;
}

export function nextCheckAt(interval: RefreshInterval, from = new Date()): Date {
  return new Date(from.getTime() + refreshIntervalSeconds[interval] * 1000);
}

export { detectInStock, fetchStockState, type StockCheckTarget } from "./stockCheck";
