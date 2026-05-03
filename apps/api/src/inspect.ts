import { normalizeHost, type InspectUrlResult, type ProductCandidate } from "@pricechecker/shared";
import { chromium } from "playwright";
import { getBlockedSite } from "./siteCapabilities.js";

const MAX_BODY_CHARS = 500_000;
const GENERIC_TITLES = [/robot or human/i, /access denied/i, /captcha/i, /just a moment/i];

export async function inspectProductUrl(websiteUrl: string): Promise<InspectUrlResult> {
  const expectedHost = normalizeHost(websiteUrl);
  const blockedSite = getBlockedSite(websiteUrl);

  if (blockedSite) {
    return {
      status: "no_candidates",
      websiteHost: expectedHost,
      reason: blockedSite.reason,
      candidates: [],
    };
  }

  try {
    const fetched = await inspectWithFetch(websiteUrl, expectedHost);
    if (fetched.candidates.length > 0) {
      return fetched;
    }

    const rendered = await inspectWithBrowser(websiteUrl, expectedHost);
    if (rendered.candidates.length > 0) {
      return rendered;
    }

    return {
      status: "no_candidates",
      reason: rendered.reason ?? fetched.reason ?? "No product candidates were found on this page.",
      candidates: [],
      ...(rendered.finalUrl ?? fetched.finalUrl ? { finalUrl: rendered.finalUrl ?? fetched.finalUrl } : {}),
      ...(rendered.websiteHost ?? fetched.websiteHost ? { websiteHost: rendered.websiteHost ?? fetched.websiteHost } : {}),
    };
  } catch (error) {
    return {
      status: "no_candidates",
      websiteHost: expectedHost,
      reason: error instanceof Error ? error.message : "Unable to inspect this URL.",
      candidates: [],
    };
  }
}

async function inspectWithFetch(websiteUrl: string, expectedHost: string): Promise<InspectUrlResult> {
  const response = await fetch(websiteUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "PricecheckerBot/0.1 (+https://example.com)",
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    },
  });
  const finalUrl = response.url || websiteUrl;
  const websiteHost = normalizeHost(finalUrl);

  if (!response.ok) {
    return {
      status: "no_candidates",
      finalUrl,
      websiteHost,
      reason: `The page returned HTTP ${response.status}.`,
      candidates: [],
    };
  }

  if (websiteHost !== expectedHost) {
    return {
      status: "no_candidates",
      finalUrl,
      websiteHost,
      reason: `The URL redirected from ${expectedHost} to ${websiteHost}.`,
      candidates: [],
    };
  }

  const html = (await response.text()).slice(0, MAX_BODY_CHARS);
  const candidates = extractProductCandidatesFromHtml(html, finalUrl);

  return {
    status: candidates.length > 0 ? "candidates_found" : "no_candidates",
    finalUrl,
    websiteHost,
    candidates,
  };
}

async function inspectWithBrowser(websiteUrl: string, expectedHost: string): Promise<InspectUrlResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const response = await page.goto(websiteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

    const finalUrl = page.url();
    const websiteHost = normalizeHost(finalUrl);

    if (websiteHost !== expectedHost) {
      return {
        status: "no_candidates",
        finalUrl,
        websiteHost,
        reason: `The URL redirected from ${expectedHost} to ${websiteHost}.`,
        candidates: [],
      };
    }

    if (response && !response.ok()) {
      return {
        status: "no_candidates",
        finalUrl,
        websiteHost,
        reason: `The rendered page returned HTTP ${response.status()}.`,
        candidates: [],
      };
    }

    const html = (await page.content()).slice(0, MAX_BODY_CHARS);
    const candidates = extractProductCandidatesFromHtml(html, finalUrl);

    return {
      status: candidates.length > 0 ? "candidates_found" : "no_candidates",
      finalUrl,
      websiteHost,
      candidates,
    };
  } finally {
    await browser.close();
  }
}

export function extractProductCandidatesFromHtml(html: string, pageUrl: string): ProductCandidate[] {
  return uniqueCandidates([
    ...extractJsonLdCandidates(html, pageUrl),
    ...extractOpenGraphCandidate(html, pageUrl),
    ...extractTitleCandidate(html, pageUrl),
  ]);
}

function extractJsonLdCandidates(html: string, pageUrl: string): ProductCandidate[] {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return scripts.flatMap((script) => {
    try {
      return productsFromJsonLd(JSON.parse(decodeHtmlEntities(script[1] ?? "")), pageUrl);
    } catch {
      return [];
    }
  });
}

function productsFromJsonLd(value: unknown, pageUrl: string): ProductCandidate[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => productsFromJsonLd(entry, pageUrl));
  }

  if (!isRecord(value)) {
    return [];
  }

  const graph = value["@graph"];
  const graphProducts = Array.isArray(graph) ? graph.flatMap((entry) => productsFromJsonLd(entry, pageUrl)) : [];
  const nestedProducts = Object.values(value).flatMap((entry) => productsFromJsonLd(entry, pageUrl));
  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];

  if (!types.includes("Product")) {
    return [...graphProducts, ...nestedProducts];
  }

  const title = stringValue(value.name);
  if (!title || isGenericTitle(title)) {
    return [...graphProducts, ...nestedProducts];
  }

  const offers = Array.isArray(value.offers) ? value.offers[0] : value.offers;
  const image = stringValue(value.image);
  const price = isRecord(offers) ? stringValue(offers.price) : undefined;
  const currency = isRecord(offers) ? stringValue(offers.priceCurrency) : undefined;
  const availability = isRecord(offers) ? stringValue(offers.availability) : undefined;

  const candidate: ProductCandidate = {
    title,
    url: absoluteUrl(stringValue(value.url) ?? pageUrl, pageUrl),
    source: "json_ld",
    ...(image ? { image: absoluteUrl(image, pageUrl) } : {}),
    ...(price ? { price } : {}),
    ...(currency ? { currency } : {}),
    ...(availability ? { availability } : {}),
  };

  return [candidate, ...graphProducts, ...nestedProducts];
}

function extractOpenGraphCandidate(html: string, pageUrl: string): ProductCandidate[] {
  const title = metaContent(html, "og:title") ?? metaContent(html, "twitter:title");
  if (!title || isGenericTitle(title)) {
    return [];
  }

  const image = metaContent(html, "og:image");
  const price = metaContent(html, "product:price:amount");
  const currency = metaContent(html, "product:price:currency");
  const availability = metaContent(html, "product:availability");

  return [
    {
      title,
      url: absoluteUrl(metaContent(html, "og:url") ?? pageUrl, pageUrl),
      source: "open_graph",
      ...(image ? { image: absoluteUrl(image, pageUrl) } : {}),
      ...(price ? { price } : {}),
      ...(currency ? { currency } : {}),
      ...(availability ? { availability } : {}),
    },
  ];
}

function extractTitleCandidate(html: string, pageUrl: string): ProductCandidate[] {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (!title || isGenericTitle(title)) {
    return [];
  }

  return [
    {
      title: decodeHtmlEntities(title),
      url: pageUrl,
      source: "page_title",
    },
  ];
}

function metaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"),
  );
  return match?.[1] ? decodeHtmlEntities(match[1]) : undefined;
}

function uniqueCandidates(candidates: ProductCandidate[]): ProductCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.title.toLowerCase()}|${candidate.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function absoluteUrl(value: string, baseUrl: string): string {
  return new URL(value, baseUrl).toString();
}

function isGenericTitle(title: string): boolean {
  return GENERIC_TITLES.some((pattern) => pattern.test(title));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
