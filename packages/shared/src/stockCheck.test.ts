import { describe, expect, it, vi } from "vitest";
import { detectInStock, extractPriceSnapshot, fetchStockState, type StockCheckTarget } from "./stockCheck";

const baseTarget: StockCheckTarget = {
  canonical_url: "https://example.com/item",
  website_host: "example.com",
  request_pattern: {
    method: "GET",
    url: "https://example.com/api/item",
  },
};

describe("fetchStockState", () => {
  it("detects in-stock responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"available": true, "quantity": 2}', { status: 200 })),
    );

    const result = await fetchStockState(baseTarget);

    expect(result.inStock).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it("extracts prices from in-stock responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              available: true,
              price: { current_retail: 129.99, currency_code: "usd" },
            }),
            { status: 200 },
          ),
      ),
    );

    const result = await fetchStockState(baseTarget);

    expect(result.price).toBe(129.99);
    expect(result.currency).toBe("USD");
  });

  it("does not mark sold-out responses as in stock", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"available": true, "message": "sold out"}', { status: 200 })),
    );

    const result = await fetchStockState(baseTarget);

    expect(result.inStock).toBe(false);
  });

  it("detects Target-style availability status fields", () => {
    expect(
      detectInStock(
        JSON.stringify({
          data: {
            product: {
              fulfillment: {
                shipping_options: {
                  availability_status: "IN_STOCK",
                },
              },
            },
          },
        }),
      ),
    ).toBe(true);
  });

  it("detects available-to-promise quantities", () => {
    expect(
      detectInStock(
        JSON.stringify({
          fulfillment: {
            store_options: [{ available_to_promise_quantity: 4 }],
          },
        }),
      ),
    ).toBe(true);
  });

  it("extracts Target-style price snapshots", () => {
    expect(
      extractPriceSnapshot(
        JSON.stringify({
          data: {
            product: {
              price: {
                formatted_current_price: "$549.99",
                current_retail: 549.99,
                currency_code: "USD",
              },
            },
          },
        }),
      ),
    ).toEqual({ price: 549.99, currency: "USD" });
  });

  it("repairs captured Target telemetry requests before checking stock", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              product: {
                fulfillment: {
                  shipping_options: { availability_status: "IN_STOCK" },
                },
              },
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStockState({
      canonical_url: "https://www.target.com/p/la-marca-prosecco-sparkling-wine-750ml-bottle/-/A-14767254",
      website_host: "target.com",
      request_pattern: {
        method: "POST",
        url: "https://api.target.com/firefly_events/v1/events/product_detail_view",
        postData: JSON.stringify({ store_id: "1394", zip: "30040", state: "GA" }),
      },
    });

    expect(result.inStock).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("redsky_aggregations/v1/web/product_fulfillment_and_variation_hierarchy_v1"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("repairs captured Target PDP enrichment requests before checking stock", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              product: {
                fulfillment: {
                  shipping_options: { availability_status: "IN_STOCK" },
                },
              },
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStockState({
      canonical_url: "https://www.target.com/p/example-product/-/A-1008746912",
      website_host: "target.com",
      request_pattern: {
        method: "POST",
        url: "https://www.target.com/cdui_orchestrations/v1/pages/pdp/deferred_enrichment/modules?store_id=1394&zip=30040&state=GA&tcin=1008746912",
      },
    });

    expect(result.inStock).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("redsky_aggregations/v1/web/product_fulfillment_and_variation_hierarchy_v1"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("looks up Target price when the fulfillment response has only stock data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              product: {
                fulfillment: {
                  shipping_options: { availability_status: "IN_STOCK" },
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              product: {
                price: {
                  current_retail: 219.99,
                  formatted_current_price: "$219.99",
                  currency_code: "USD",
                },
              },
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStockState({
      canonical_url: "https://www.target.com/p/example-product/-/A-1008746912",
      website_host: "target.com",
      request_pattern: {
        method: "POST",
        url: "https://www.target.com/cdui_orchestrations/v1/pages/pdp/deferred_enrichment/modules?store_id=1394&zip=30040&state=GA&tcin=1008746912",
      },
    });

    expect(result.inStock).toBe(true);
    expect(result.price).toBe(219.99);
    expect(result.currency).toBe("USD");
    expect(result.summary).toMatchObject({ priceLookupStatusCode: 200 });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("redsky_aggregations/v1/web/pdp_client_v1"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toContain("pricing_store_id=1394");
  });
});
