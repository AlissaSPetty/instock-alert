import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeHost, slugify } from "@pricechecker/shared";
import { chromium, type Response } from "playwright";

export interface CapturedRequest {
  url: string;
  method: string;
  status: number;
  contentType: string;
  postData?: string;
  responseSample?: string;
  score: number;
}

export interface CaptureResult {
  websiteHost: string;
  websiteName: string;
  websiteSlug: string;
  itemSlug: string;
  folderPath: string;
  selectedRequest: CapturedRequest;
  capturedRequests: CapturedRequest[];
}

const STOCK_TERMS = [
  "stock",
  "instock",
  "in_stock",
  "available",
  "availability",
  "inventory",
  "quantity",
  "soldout",
  "sold_out",
  "product",
];

const STOCK_ENDPOINT_TERMS = ["availability", "fulfillment", "inventory", "pdp", "product"];
const PAGE_FALLBACK_MIN_SCORE = 6;
const TELEMETRY_ENDPOINT_TERMS = [
  "analytics",
  "event",
  "events",
  "experiment_exposed",
  "firefly_events",
  "page_view",
  "telemetry",
  "traffic_source",
];

export async function captureStockRequests(websiteUrl: string, itemName: string): Promise<CaptureResult> {
  const websiteHost = normalizeHost(websiteUrl);
  const websiteName = websiteHost.split(".")[0] ?? websiteHost;
  const websiteSlug = slugify(websiteHost);
  const itemSlug = slugify(itemName);
  const scrapersRoot = path.join(process.cwd(), "scrapers");
  const folderPath =
    (await existingScraperFolderPath(scrapersRoot, websiteSlug)) ?? path.join("scrapers", websiteSlug);
  const absoluteFolderPath = path.join(process.cwd(), folderPath);
  const capturedRequests: CapturedRequest[] = [];
  const pendingCaptures: Array<Promise<void>> = [];
  let pageRequest: CapturedRequest | null = null;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on("response", async (response) => {
      const request = response.request();
      const resourceType = request.resourceType();

      if (!["xhr", "fetch"].includes(resourceType)) {
        return;
      }

      const pendingCapture = captureResponse(response, itemName)
        .then((captured) => {
          if (captured) {
            capturedRequests.push(captured);
          }
        })
        .catch(() => undefined);
      pendingCaptures.push(pendingCapture);
    });

    const pageResponse = await page.goto(websiteUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await Promise.allSettled(pendingCaptures);
    pageRequest = pageResponse ? await captureResponse(pageResponse, itemName) : null;
  } finally {
    await browser.close();
  }

  const sortedRequests = capturedRequests.sort((a, b) => b.score - a.score);
  const selectedRequest =
    sortedRequests.find((request) => request.score > 0) ??
    (pageRequest && pageRequest.score >= PAGE_FALLBACK_MIN_SCORE ? pageRequest : undefined);

  if (!selectedRequest || selectedRequest.score <= 0) {
    throw new Error("No likely stock or inventory network request was captured.");
  }

  const allCapturedRequests = [...sortedRequests, ...(pageRequest ? [pageRequest] : [])].sort(
    (a, b) => b.score - a.score,
  );

  await mkdir(absoluteFolderPath, { recursive: true });
  await writeScraperDocs(absoluteFolderPath, {
    websiteHost,
    selectedRequest,
  });

  return {
    websiteHost,
    websiteName,
    websiteSlug,
    itemSlug,
    folderPath,
    selectedRequest,
    capturedRequests: allCapturedRequests,
  };
}

async function captureResponse(response: Response, itemName: string): Promise<CapturedRequest | null> {
  const request = response.request();
  const headers = response.headers();
  const contentType = headers["content-type"] ?? "";

  if (!contentType.includes("json") && !contentType.includes("text")) {
    return null;
  }

  const responseText = await response.text().catch(() => "");
  const responseSample = responseText.slice(0, 25_000);
  const method = request.method();
  const url = request.url();
  const postData = request.postData() ?? undefined;

  return {
    url,
    method,
    status: response.status(),
    contentType,
    responseSample,
    score: scoreCapturedRequest(
      {
        url,
        responseSample,
        status: response.status(),
        ...(postData ? { postData } : {}),
      },
      itemName,
    ),
    ...(postData ? { postData } : {}),
  };
}

export function scoreCapturedRequest(
  request: {
    url: string;
    postData?: string;
    responseSample: string;
    status: number;
  },
  itemName: string,
): number {
  const requestText = `${request.url}\n${request.postData ?? ""}`;
  const responseScore = scoreRequest(request.responseSample, itemName);
  const requestScore = Math.floor(scoreRequest(requestText, itemName) / 3);
  const url = request.url.toLowerCase();
  let score = responseScore + requestScore;

  if (STOCK_ENDPOINT_TERMS.some((term) => url.includes(term))) {
    score += 4;
  }

  if (TELEMETRY_ENDPOINT_TERMS.some((term) => url.includes(term))) {
    score -= 12;
  }

  if (request.responseSample.trim().length === 0) {
    score -= 6;
  }

  if (request.status === 204) {
    score -= 4;
  }

  return Math.max(0, score);
}

export function scoreRequest(content: string, itemName: string): number {
  const haystack = content.toLowerCase();
  const itemParts = itemName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length >= 3);

  let score = 0;

  for (const term of STOCK_TERMS) {
    if (haystack.includes(term)) {
      score += 2;
    }
  }

  for (const part of itemParts) {
    if (haystack.includes(part)) {
      score += 1;
    }
  }

  return score;
}

async function writeScraperDocs(
  folder: string,
  input: {
    websiteHost: string;
    selectedRequest: CapturedRequest;
  },
) {
  const markdownPath = path.join(folder, `${slugify(input.websiteHost)}.md`);
  const markdown = `# ${input.websiteHost}

## Website Interaction

- Method: \`${input.selectedRequest.method}\`
- URL: \`${input.selectedRequest.url}\`
- Content-Type: \`${input.selectedRequest.contentType}\`

## Scrape Strategy

Fetch the selected request directly and parse the response for stock indicators such as inventory, availability, quantity, sold out, or in-stock values. Avoid Playwright for recurring checks unless this direct request stops working.

## Verification Tests

The generated test checks that the captured request can be fetched and that the response contains likely stock-related fields or text. Keep this test updated if the site changes its inventory API.
`;

  const testFile = `import { describe, expect, it } from "vitest";

describe("${input.websiteHost} scraper", () => {
  it("fetches the selected stock endpoint", async () => {
    const response = await fetch(${JSON.stringify(input.selectedRequest.url)}, {
      method: ${JSON.stringify(input.selectedRequest.method)}
    });

    expect(response.status).toBeLessThan(500);
    const text = await response.text();
    expect(text.toLowerCase()).toMatch(/stock|available|availability|inventory|quantity|sold|product/);
  });
});
`;

  await writeFile(markdownPath, markdown);
  await writeFile(path.join(folder, `${slugify(input.websiteHost)}.test.ts`), testFile);
}

async function existingScraperFolderPath(scrapersRoot: string, websiteSlug: string): Promise<string | null> {
  const entries = await readdir(scrapersRoot, { withFileTypes: true }).catch(() => []);
  const folder = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .find((folderName) => folderName === websiteSlug || folderName.startsWith(`${websiteSlug}-`));

  return folder ? path.join("scrapers", folder) : null;
}
