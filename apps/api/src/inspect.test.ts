import { describe, expect, it } from "vitest";
import { extractProductCandidatesFromHtml } from "./inspect";

describe("extractProductCandidatesFromHtml", () => {
  it("extracts product candidates from JSON-LD", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Ninja Pressure Cooker PC200",
          "image": "https://example.com/image.jpg",
          "offers": {
            "price": "89.99",
            "priceCurrency": "USD",
            "availability": "https://schema.org/InStock"
          }
        }
      </script>
    `;

    const candidates = extractProductCandidatesFromHtml(html, "https://example.com/product");

    expect(candidates[0]).toMatchObject({
      title: "Ninja Pressure Cooker PC200",
      price: "89.99",
      currency: "USD",
      source: "json_ld",
    });
  });

  it("ignores generic bot-check titles", () => {
    const candidates = extractProductCandidatesFromHtml(
      "<title>Robot or human?</title>",
      "https://example.com/product",
    );

    expect(candidates).toEqual([]);
  });
});
