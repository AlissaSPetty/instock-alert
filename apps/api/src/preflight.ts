import {
  itemTokens,
  normalizeHost,
  type PreflightResult,
  type SearchSuggestion,
} from "@pricechecker/shared";
import { chromium } from "playwright";
import { searchSuggestions } from "./search";

const MAX_BODY_CHARS = 250_000;

export interface PreflightInput {
  websiteUrl: string;
  itemName: string;
}

export async function verifyWebsiteAndItem(input: PreflightInput): Promise<PreflightResult> {
  const expectedHost = normalizeHost(input.websiteUrl);

  try {
    const lightweight = await verifyWithFetch(input, expectedHost);
    if (lightweight.status === "verified") {
      return lightweight;
    }

    const rendered = await verifyWithBrowser(input, expectedHost);
    if (rendered.status === "verified") {
      return rendered;
    }

    return withSuggestions(input, rendered.reason ?? lightweight.reason);
  } catch (error) {
    return withSuggestions(input, error instanceof Error ? error.message : "Unable to verify page.");
  }
}

async function verifyWithFetch(input: PreflightInput, expectedHost: string): Promise<PreflightResult> {
  const response = await fetch(input.websiteUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "PricecheckerBot/0.1 (+https://example.com)",
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    },
  });

  const finalUrl = response.url || input.websiteUrl;
  const finalHost = normalizeHost(finalUrl);

  if (!response.ok) {
    return {
      status: "needs_verification",
      finalUrl,
      websiteHost: finalHost,
      reason: `The page returned HTTP ${response.status}.`,
    };
  }

  if (finalHost !== expectedHost) {
    return {
      status: "needs_verification",
      finalUrl,
      websiteHost: finalHost,
      reason: `The URL redirected from ${expectedHost} to ${finalHost}.`,
    };
  }

  const body = (await response.text()).slice(0, MAX_BODY_CHARS);
  return verifyPageText(input, finalUrl, finalHost, body, extractTitle(body));
}

async function verifyWithBrowser(input: PreflightInput, expectedHost: string): Promise<PreflightResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const response = await page.goto(input.websiteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

    const finalUrl = page.url();
    const finalHost = normalizeHost(finalUrl);

    if (finalHost !== expectedHost) {
      return {
        status: "needs_verification",
        finalUrl,
        websiteHost: finalHost,
        reason: `The URL redirected from ${expectedHost} to ${finalHost}.`,
      };
    }

    if (response && !response.ok()) {
      return {
        status: "needs_verification",
        finalUrl,
        websiteHost: finalHost,
        reason: `The rendered page returned HTTP ${response.status()}.`,
      };
    }

    const title = await page.title();
    const text = (await page.locator("body").innerText({ timeout: 10_000 })).slice(0, MAX_BODY_CHARS);
    return verifyPageText(input, finalUrl, finalHost, text, title);
  } finally {
    await browser.close();
  }
}

function verifyPageText(
  input: PreflightInput,
  finalUrl: string,
  websiteHost: string,
  text: string,
  title: string,
): PreflightResult {
  if (titleContainsItemName(title, input.itemName)) {
    return {
      status: "verified",
      finalUrl,
      websiteHost,
    };
  }

  const haystack = text.toLowerCase();
  const tokens = itemTokens(input.itemName);
  const matched = tokens.filter((token) => haystack.includes(token));
  const requiredMatches = Math.max(1, Math.ceil(tokens.length * 0.6));

  if (tokens.length > 0 && matched.length >= requiredMatches) {
    return {
      status: "verified",
      finalUrl,
      websiteHost,
    };
  }

  return {
    status: "needs_verification",
    finalUrl,
    websiteHost,
    reason: "The item name was not found in the page title or submitted page content.",
  };
}

async function withSuggestions(input: PreflightInput, reason = "Unable to verify item."): Promise<PreflightResult> {
  const host = normalizeHost(input.websiteUrl);
  const suggestions = await searchSuggestions(`${input.itemName} site:${host}`);

  return {
    status: "needs_verification",
    websiteHost: host,
    reason,
    suggestions: filterSuggestions(suggestions, host, input.itemName),
  };
}

function filterSuggestions(
  suggestions: SearchSuggestion[],
  expectedHost: string,
  itemName: string,
): SearchSuggestion[] {
  return suggestions.filter((suggestion) => {
    try {
      return normalizeHost(suggestion.url) === expectedHost && titleContainsItemName(suggestion.title, itemName);
    } catch {
      return false;
    }
  });
}

export function titleContainsItemName(title: string, itemName: string): boolean {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedItemName = normalizeSearchText(itemName);

  if (!normalizedTitle || !normalizedItemName) {
    return false;
  }

  if (normalizedTitle.includes(normalizedItemName)) {
    return true;
  }

  const tokens = itemTokens(itemName);
  return tokens.length > 0 && tokens.every((token) => normalizedTitle.includes(token));
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function extractTitle(html: string): string {
  const ogTitle = html.match(/<meta\s+[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (ogTitle?.[1]) {
    return decodeHtmlEntities(ogTitle[1]);
  }

  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return title?.[1] ? decodeHtmlEntities(title[1]) : "";
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
