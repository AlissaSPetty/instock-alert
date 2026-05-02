import { normalizeHost } from "@pricechecker/shared";

export interface BlockedSite {
  host: string;
  reason: string;
}

export const blockedSites: BlockedSite[] = [
  {
    host: "walmart.com",
    reason:
      "Walmart blocks automated product inspection with bot protection, so this site is not supported yet.",
  },
];

export function getBlockedSite(url: string): BlockedSite | null {
  const host = normalizeHost(url);
  return blockedSites.find((site) => host === site.host || host.endsWith(`.${site.host}`)) ?? null;
}
