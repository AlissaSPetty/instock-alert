const TARGET_REDSKY_KEY = "9f36aeafbe60771e321a7cc95a78140772ab3e96";
const PRICE_FIELD_KEYS = [
  "currentretail",
  "currentprice",
  "saleprice",
  "offerprice",
  "unitprice",
  "retailprice",
  "price",
  "amount",
];
const CURRENCY_FIELD_KEYS = ["currency", "currencycode", "pricecurrency"];

/** Minimal scrape target fields needed to fetch and classify stock state (worker API + immediate check). */
export interface StockCheckTarget {
  canonical_url: string;
  website_host: string;
  request_pattern: {
    method?: string;
    url?: string;
    postData?: string;
    headers?: Record<string, string>;
  };
}

export async function fetchStockState(target: StockCheckTarget) {
  const request = targetStockRequestFallback(target) ?? target.request_pattern;
  const response = await fetchStockRequest(request, target.canonical_url);
  const text = await response.text();
  const parsed = parseJson(text);
  const inStock = targetStockStateFromJson(parsed, target) ?? detectInStock(text);
  let priceSnapshot = inStock ? extractPriceSnapshot(text) : null;
  let priceLookupStatusCode: number | null = null;

  if (inStock && !priceSnapshot) {
    const priceRequest = targetPriceRequestFallback(target);
    if (priceRequest) {
      const priceResponse = await fetchStockRequest(priceRequest, target.canonical_url);
      priceLookupStatusCode = priceResponse.status;
      priceSnapshot = extractPriceSnapshot(await priceResponse.text());
    }
  }

  return {
    inStock,
    statusCode: response.status,
    price: priceSnapshot?.price ?? null,
    currency: priceSnapshot?.currency ?? null,
    summary: {
      contentLength: text.length,
      matched: inStock ? "in_stock" : "not_in_stock",
      ...(priceSnapshot?.price ? { price: priceSnapshot.price } : {}),
      ...(priceSnapshot?.currency ? { currency: priceSnapshot.currency } : {}),
      ...(priceLookupStatusCode !== null ? { priceLookupStatusCode } : {}),
    },
  };
}

function fetchStockRequest(request: StockCheckTarget["request_pattern"], fallbackUrl: string) {
  const init: RequestInit = {
    method: request.method ?? "GET",
    signal: AbortSignal.timeout(20_000),
  };

  if (request.method && request.method !== "GET" && request.postData) {
    init.body = request.postData;
  }

  if (request.headers) {
    init.headers = request.headers;
  }

  return fetch(request.url ?? fallbackUrl, init);
}

export function detectInStock(text: string): boolean {
  const parsed = parseJson(text);
  if (parsed !== undefined) {
    const jsonMatch = stockStateFromJson(parsed);
    if (jsonMatch !== null) {
      return jsonMatch;
    }
  }

  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  return (
    (/\bin stock\b|\"inStock\"\s*:\s*true|\"available\"\s*:\s*true/i.test(text) ||
      compact.includes("schemaorginstock") ||
      compact.includes("availabilityinstock")) &&
    !normalized.includes("out of stock") &&
    !normalized.includes("sold out") &&
    !compact.includes("schemaorgoutofstock")
  );
}

export function extractPriceSnapshot(text: string): { price: number; currency: string | null } | null {
  const parsed = parseJson(text);
  if (parsed === undefined) {
    return null;
  }

  return priceSnapshotFromJson(parsed, null);
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stockStateFromJson(value: unknown): boolean | null {
  if (Array.isArray(value)) {
    return combineStockStates(value.map(stockStateFromJson));
  }

  if (!isRecord(value)) {
    return null;
  }

  const directMatches = Object.entries(value).map(([key, entry]) => stockStateForField(key, entry));
  if (directMatches.includes(false)) {
    return false;
  }

  if (directMatches.includes(true)) {
    return true;
  }

  return combineStockStates(Object.values(value).map(stockStateFromJson));
}

function priceSnapshotFromJson(value: unknown, inheritedCurrency: string | null): { price: number; currency: string | null } | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = priceSnapshotFromJson(entry, inheritedCurrency);
      if (match) {
        return match;
      }
    }

    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const currency = currencyFromRecord(value) ?? inheritedCurrency;
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeFieldKey(key);
    if (!PRICE_FIELD_KEYS.includes(normalizedKey)) {
      continue;
    }

    const price = numericPrice(entry);
    if (price !== null) {
      return { price, currency };
    }
  }

  for (const entry of Object.values(value)) {
    const match = priceSnapshotFromJson(entry, currency);
    if (match) {
      return match;
    }
  }

  return null;
}

function targetStockStateFromJson(value: unknown | undefined, target: StockCheckTarget): boolean | null {
  if (target.website_host !== "target.com" || value === undefined) {
    return null;
  }

  const context = targetRequestContext(target);
  if (!context) {
    return null;
  }

  const selectedVariation = findTargetVariation(value, context.tcin);
  return selectedVariation ? targetVariationStockState(selectedVariation) : null;
}

function findTargetVariation(value: unknown, tcin: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findTargetVariation(entry, tcin);
      if (match) {
        return match;
      }
    }

    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (String(value.tcin ?? "") === tcin && isRecord(value.fulfillment)) {
    return value;
  }

  for (const entry of Object.values(value)) {
    const match = findTargetVariation(entry, tcin);
    if (match) {
      return match;
    }
  }

  return null;
}

function targetVariationStockState(variation: Record<string, unknown>): boolean | null {
  const fulfillment = variation.fulfillment;
  if (!isRecord(fulfillment)) {
    return null;
  }

  if (fulfillment.is_sold_out === true) {
    return false;
  }

  const availabilityFields = [
    "is_shipping_available",
    "is_shipping_loyalty_available",
    "is_scheduled_delivery_available",
    "is_primary_store_available",
    "is_backup_store_available",
    "is_digital_options_available",
  ];

  if (availabilityFields.some((field) => fulfillment[field] === true)) {
    return true;
  }

  return availabilityFields.some((field) => fulfillment[field] === false) ? false : null;
}

function currencyFromRecord(value: Record<string, unknown>): string | null {
  for (const [key, entry] of Object.entries(value)) {
    if (CURRENCY_FIELD_KEYS.includes(normalizeFieldKey(key)) && typeof entry === "string") {
      return entry.toUpperCase();
    }
  }

  return null;
}

function numericPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return roundPrice(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const match = value.replace(/,/g, "").match(/\d+(?:\.\d{1,2})?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? roundPrice(parsed) : null;
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function stockStateForField(key: string, value: unknown): boolean | null {
  const normalizedKey = normalizeFieldKey(key);

  if (
    typeof value === "boolean" &&
    ["available", "isavailable", "instock", "purchasable", "sellable"].includes(normalizedKey)
  ) {
    return value;
  }

  if (
    typeof value === "number" &&
    value > 0 &&
    ["quantity", "availablequantity", "availabletopromisequantity", "inventoryquantity"].includes(normalizedKey)
  ) {
    return true;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (
    !["availability", "availabilitystatus", "message", "reason", "stockstatus", "inventorystatus", "status"].includes(
      normalizedKey,
    )
  ) {
    return null;
  }

  if (["instock", "available", "availabletopromise"].includes(normalizedValue)) {
    return true;
  }

  if (["outofstock", "soldout", "unavailable"].includes(normalizedValue)) {
    return false;
  }

  return null;
}

function normalizeFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function combineStockStates(states: Array<boolean | null>): boolean | null {
  if (states.includes(true)) {
    return true;
  }

  if (states.includes(false)) {
    return false;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function targetStockRequestFallback(target: StockCheckTarget): StockCheckTarget["request_pattern"] | null {
  if (target.website_host !== "target.com") {
    return null;
  }

  const context = targetRequestContext(target);
  if (!context) {
    return null;
  }

  const params = new URLSearchParams({
    key: TARGET_REDSKY_KEY,
    tcin: context.tcin,
    is_bot: "false",
    channel: "WEB",
    page: `/p/A-${context.tcin}`,
  });

  if (context.storeId) {
    params.set("store_id", context.storeId);
    params.set("required_store_id", context.storeId);
    params.set("scheduled_delivery_store_id", context.storeId);
  }

  for (const field of ["zip", "state", "latitude", "longitude"]) {
    const value = context.fields.get(field);
    if (value) {
      params.set(field, value);
    }
  }

  return {
    method: "GET",
    url: `https://redsky.target.com/redsky_aggregations/v1/web/product_fulfillment_and_variation_hierarchy_v1?${params.toString()}`,
    headers: {
      "user-agent": "Mozilla/5.0",
    },
  };
}

function targetPriceRequestFallback(target: StockCheckTarget): StockCheckTarget["request_pattern"] | null {
  if (target.website_host !== "target.com") {
    return null;
  }

  const context = targetRequestContext(target);
  if (!context) {
    return null;
  }

  const params = new URLSearchParams({
    key: TARGET_REDSKY_KEY,
    tcin: context.tcin,
    channel: "WEB",
    page: `/p/A-${context.tcin}`,
  });

  if (context.storeId) {
    params.set("pricing_store_id", context.storeId);
    params.set("store_id", context.storeId);
  }

  return {
    method: "GET",
    url: `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?${params.toString()}`,
    headers: {
      "user-agent": "Mozilla/5.0",
    },
  };
}

function targetRequestContext(target: StockCheckTarget):
  | {
      tcin: string;
      storeId: string | undefined;
      fields: Map<string, string>;
    }
  | null {
  const request = target.request_pattern;
  const source = `${request.url ?? ""}\n${request.postData ?? ""}`;
  const tcin =
    extractTargetField(target.canonical_url, "preselect") ??
    target.canonical_url.match(/\/A-(\d+)/i)?.[1] ??
    extractTargetField(source, "tcin");
  if (!tcin) {
    return null;
  }

  const fields = new Map<string, string>();
  for (const field of [
    "store_id",
    "required_store_id",
    "pricing_store_id",
    "scheduled_delivery_store_id",
    "zip",
    "state",
    "latitude",
    "longitude",
  ]) {
    const value = extractTargetField(source, field);
    if (value) {
      fields.set(field, value);
    }
  }

  return {
    tcin,
    storeId:
      fields.get("pricing_store_id") ??
      fields.get("store_id") ??
      fields.get("required_store_id") ??
      fields.get("scheduled_delivery_store_id"),
    fields,
  };
}

function extractTargetField(source: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`["?&]${escaped}["?]?\\s*[:=]\\s*"?([a-z0-9.-]+)`, "i"));
  return match?.[1];
}
