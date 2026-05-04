import { describe, expect, it } from "vitest";
import { scoreCapturedRequest, scoreRequest } from "./capture";

describe("scoreRequest", () => {
  it("prioritizes item and stock related responses", () => {
    const score = scoreRequest(
      JSON.stringify({
        product: "PlayStation 5 Console",
        inventory: { available: true, quantity: 3 },
      }),
      "PlayStation 5 Console",
    );

    expect(score).toBeGreaterThan(5);
  });

  it("scores unrelated responses low", () => {
    expect(scoreRequest('{"navigation":["home","about"]}', "PlayStation 5 Console")).toBe(0);
  });

  it("penalizes telemetry endpoints even when the event payload mentions the product", () => {
    const score = scoreCapturedRequest(
      {
        url: "https://api.target.com/firefly_events/v1/events/product_detail_view",
        postData: JSON.stringify({ product: "La Marca Prosecco Sparkling Wine" }),
        responseSample: "",
        status: 201,
      },
      "La Marca Prosecco Sparkling Wine",
    );

    expect(score).toBe(0);
  });

  it("prioritizes fulfillment endpoints with stock information", () => {
    const score = scoreCapturedRequest(
      {
        url: "https://redsky.target.com/redsky_aggregations/v1/web/product_fulfillment_and_variation_hierarchy_v1?tcin=14767254",
        responseSample: JSON.stringify({
          product: {
            title: "La Marca Prosecco Sparkling Wine",
            fulfillment: {
              shipping_options: { availability_status: "IN_STOCK" },
            },
          },
        }),
        status: 200,
      },
      "La Marca Prosecco Sparkling Wine",
    );

    expect(score).toBeGreaterThan(10);
  });

  it("scores product pages with embedded availability metadata", () => {
    const score = scoreCapturedRequest(
      {
        url: "https://example.com/products/playstation-5-console",
        responseSample: `
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "PlayStation 5 Console",
              "offers": { "availability": "https://schema.org/InStock" }
            }
          </script>
        `,
        status: 200,
      },
      "PlayStation 5 Console",
    );

    expect(score).toBeGreaterThan(5);
  });

});
