import { chromium, type Page } from "playwright";
import { normalizeHost, slugify } from "@pricechecker/shared";

export const POKEMON_CENTER_TCG_URL =
  "https://www.pokemoncenter.com/category/trading-card-game?category=tcg-cards&page=1";

const BOT_BLOCK_PATTERNS = [/pardon our interruption/i, /something about your browser made us think you were a bot/i];
const DEFAULT_CURRENCY = "USD";

export interface MsrpPriceCandidate {
  sourceSite: string;
  sourceUrl: string;
  productName: string;
  normalizedName: string;
  price: number;
  currency: string;
  productUrl: string | null;
  imageUrl: string | null;
  releaseDate: string | null;
  type: string | null;
  scrapedAt: string;
}

export async function scrapePokemonCenterTcgMsrpPrices(sourceUrl = POKEMON_CENTER_TCG_URL): Promise<MsrpPriceCandidate[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const sourceSite = normalizeHost(sourceUrl);
    const scrapedAt = new Date().toISOString();
    const networkExtractions: Array<Promise<MsrpPriceCandidate[]>> = [];
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });

    page.on("response", (response) => {
      const contentType = response.headers()["content-type"] ?? "";
      if (!contentType.includes("json")) {
        return;
      }

      networkExtractions.push(
        response
          .json()
          .then((json) => extractMsrpPricesFromJson(json, sourceUrl, sourceSite, scrapedAt))
          .catch(() => []),
      );
    });

    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

    const html = await page.content();
    if (BOT_BLOCK_PATTERNS.some((pattern) => pattern.test(html))) {
      throw new Error("Pokemon Center blocked the scraper with a bot-interruption page.");
    }

    const networkCandidates = (await Promise.all(networkExtractions)).flat();
    return uniqueByNormalizedName([
      ...networkCandidates,
      ...extractMsrpPricesFromHtml(html, sourceUrl, sourceSite, scrapedAt),
      ...(await extractMsrpPricesFromRenderedCards(page, sourceUrl, sourceSite, scrapedAt)),
    ]);
  } finally {
    await browser.close();
  }
}

export function extractMsrpPricesFromHtml(
  html: string,
  sourceUrl: string,
  sourceSite = normalizeHost(sourceUrl),
  scrapedAt = new Date().toISOString(),
): MsrpPriceCandidate[] {
  return uniqueByNormalizedName([
    ...extractJsonLdPrices(html, sourceUrl, sourceSite, scrapedAt),
    ...extractEmbeddedJsonPrices(html, sourceUrl, sourceSite, scrapedAt),
  ]);
}

export function extractMsrpPricesFromJson(
  value: unknown,
  sourceUrl: string,
  sourceSite = normalizeHost(sourceUrl),
  scrapedAt = new Date().toISOString(),
): MsrpPriceCandidate[] {
  return uniqueByNormalizedName(pricesFromUnknownJson(value, sourceUrl, sourceSite, scrapedAt));
}

export function extractPokemonCenterCatalogMsrpPrices(
  value: unknown,
  scrapedAt = new Date().toISOString(),
): MsrpPriceCandidate[] {
  return uniqueByNormalizedName(pokemonCenterCatalogProducts(value).flatMap((product) => pokemonCenterCatalogCandidate(product, scrapedAt)));
}

function extractJsonLdPrices(
  html: string,
  sourceUrl: string,
  sourceSite: string,
  scrapedAt: string,
): MsrpPriceCandidate[] {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return scripts.flatMap((script) => {
    try {
      return pricesFromUnknownJson(JSON.parse(decodeHtmlEntities(script[1] ?? "")), sourceUrl, sourceSite, scrapedAt);
    } catch {
      return [];
    }
  });
}

function extractEmbeddedJsonPrices(
  html: string,
  sourceUrl: string,
  sourceSite: string,
  scrapedAt: string,
): MsrpPriceCandidate[] {
  const candidates: MsrpPriceCandidate[] = [];
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];

  for (const script of scripts) {
    const text = decodeHtmlEntities(script[1] ?? "").trim();
    if (!text.includes("price") || !text.includes("name")) {
      continue;
    }

    for (const jsonText of likelyJsonObjects(text)) {
      try {
        candidates.push(...pricesFromUnknownJson(JSON.parse(jsonText), sourceUrl, sourceSite, scrapedAt));
      } catch {
        /* Some scripts contain JS objects or partial state; skip those. */
      }
    }
  }

  return candidates;
}

async function extractMsrpPricesFromRenderedCards(
  page: Page,
  sourceUrl: string,
  sourceSite: string,
  scrapedAt: string,
): Promise<MsrpPriceCandidate[]> {
  const rows = await page
    .locator("a, article, li, [data-testid], [class*='product'], [class*='Product']")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const element = node as HTMLElement;
          const text = element.innerText || "";
          const price = text.match(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/)?.[0] ?? null;
          if (!price) {
            return null;
          }

          const link = element instanceof HTMLAnchorElement ? element.href : element.querySelector("a")?.href;
          const image = element.querySelector("img")?.src ?? null;
          const name = text
            .split(/\n+/)
            .map((part) => part.trim())
            .find((part) => part && !part.includes("$"));

          return name ? { name, price, link: link ?? null, image } : null;
        })
        .filter(Boolean),
    );

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object" || !("name" in row) || !("price" in row)) {
      return [];
    }

    return candidateFromParts({
      name: String(row.name),
      price: String(row.price),
      currency: DEFAULT_CURRENCY,
      productUrl: "link" in row && row.link ? absoluteUrl(String(row.link), sourceUrl) : null,
      imageUrl: "image" in row && row.image ? absoluteUrl(String(row.image), sourceUrl) : null,
      releaseDate: null,
      type: null,
      sourceUrl,
      sourceSite,
      scrapedAt,
    });
  });
}

function pricesFromUnknownJson(
  value: unknown,
  sourceUrl: string,
  sourceSite: string,
  scrapedAt: string,
): MsrpPriceCandidate[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => pricesFromUnknownJson(entry, sourceUrl, sourceSite, scrapedAt));
  }

  if (!isRecord(value)) {
    return [];
  }

  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  const isProduct = types.some((entry) => typeof entry === "string" && entry.toLowerCase() === "product");
  const nested = Object.values(value).flatMap((entry) => pricesFromUnknownJson(entry, sourceUrl, sourceSite, scrapedAt));
  const productName = stringValue(value.name ?? value.title ?? value.productName);
  const offers = Array.isArray(value.offers) ? value.offers[0] : value.offers;
  const offerRecord = isRecord(offers) ? offers : value;
  const price = stringValue(offerRecord.price ?? offerRecord.priceValue ?? offerRecord.salePrice);

  if (!isProduct || !productName || !price) {
    return nested;
  }

  return [
    ...candidateFromParts({
      name: productName,
      price,
      currency: stringValue(offerRecord.priceCurrency ?? offerRecord.currency) ?? DEFAULT_CURRENCY,
      productUrl: absoluteUrl(stringValue(value.url) ?? sourceUrl, sourceUrl),
      imageUrl: absoluteUrl(stringValue(value.image), sourceUrl),
      releaseDate: null,
      type: null,
      sourceUrl,
      sourceSite,
      scrapedAt,
    }),
    ...nested,
  ];
}

function candidateFromParts(input: {
  name: string;
  price: string;
  currency: string;
  productUrl: string | null;
  imageUrl: string | null;
  releaseDate: string | null;
  type: string | null;
  sourceUrl: string;
  sourceSite: string;
  scrapedAt: string;
}): MsrpPriceCandidate[] {
  const price = numericPrice(input.price);
  const productName = input.name.trim();
  if (!productName || price === null) {
    return [];
  }

  return [
    {
      sourceSite: input.sourceSite,
      sourceUrl: input.sourceUrl,
      productName,
      normalizedName: slugify(productName),
      price,
      currency: input.currency.toUpperCase(),
      productUrl: input.productUrl,
      imageUrl: input.imageUrl,
      releaseDate: input.releaseDate,
      type: input.type,
      scrapedAt: input.scrapedAt,
    },
  ];
}

function pokemonCenterCatalogProducts(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  if (Array.isArray(value.products)) {
    return value.products.filter(isRecord);
  }

  const response = value._raw;
  if (isRecord(response) && isRecord(response.response) && Array.isArray(response.response.docs)) {
    return response.response.docs.filter(isRecord);
  }

  return [];
}

function pokemonCenterCatalogCandidate(product: Record<string, unknown>, scrapedAt: string): MsrpPriceCandidate[] {
  const productName = stringValue(
    product.name ?? product.title ?? product.product_name ?? product.reportingName ?? product.reporting_product_name,
  );
  const code = stringValue(product.code ?? product.pid ?? product.mpn) ?? productCodeFromProductUrl(stringValue(product.product_url));
  const listPrice = isRecord(product.listPrice) ? product.listPrice.amount : product.listPrice;
  const price = numericPrice(stringValue(listPrice ?? product.price ?? product.sale_price) ?? "");

  if (!productName || price === null) {
    return [];
  }

  const imageUrl = originalImageUrl(product);
  const reportingCrumb = stringValue(product.reportingCrumb ?? product.reporting_crumb);
  const releaseDate = stringValue(product.releaseDate ?? product.launch_date) ?? null;
  const productUrl =
    stringValue(product.product_url) ??
    (code ? `https://www.pokemoncenter.com/product/${code}/${pokemonCenterProductSlug(productName)}` : null);

  return [
    {
      sourceSite: "pokemoncenter.com",
      sourceUrl: "pokemoncenter.com",
      productName,
      normalizedName: stringValue(product.normalized_name) ?? normalizePokemonCenterProductName(productName),
      price,
      currency: DEFAULT_CURRENCY,
      productUrl,
      imageUrl,
      releaseDate,
      type: stringValue(product.type) ?? productTypeFromReportingCrumb(reportingCrumb),
      scrapedAt,
    },
  ];
}

function originalImageUrl(product: Record<string, unknown>): string | null {
  if (Array.isArray(product.images)) {
    const first = product.images.find(isRecord);
    const original = first ? stringValue(first.original) : undefined;
    if (original) {
      return original;
    }
  }

  const fullSize = stringValue(product.primary_image_full_size);
  if (fullSize) {
    return `https://www.pokemoncenter.com/images/DAMRoot/${fullSize}`;
  }

  return stringValue(product.image ?? product.image_url ?? product.thumb_image) ?? null;
}

function productCodeFromProductUrl(productUrl: string | undefined): string | undefined {
  if (!productUrl) {
    return undefined;
  }

  return productUrl.match(/\/product\/([^/]+)/)?.[1];
}

function normalizePokemonCenterProductName(productName: string): string {
  return productName.replace(/^Pokémon TCG:\s*/i, "").trim();
}

function pokemonCenterProductSlug(productName: string): string {
  return productName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function productTypeFromReportingCrumb(reportingCrumb: string | undefined): string | null {
  if (!reportingCrumb) {
    return null;
  }

  const crumb = reportingCrumb.split(";")[0] ?? reportingCrumb;
  const parts = crumb
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1) ?? null;
}

function likelyJsonObjects(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return [trimmed];
  }

  return [...trimmed.matchAll(/JSON\.parse\((["'])([\s\S]*?)\1\)/g)].map((match) =>
    match[2]?.replace(/\\"/g, '"').replace(/\\\\/g, "\\") ?? "",
  );
}

function uniqueByNormalizedName(candidates: MsrpPriceCandidate[]): MsrpPriceCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.sourceSite}|${candidate.normalizedName}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function numericPrice(value: string): number | null {
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d{1,2})?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

function absoluteUrl(value: string | null | undefined, baseUrl: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return stringValue(value[0]);
  }

  return undefined;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
