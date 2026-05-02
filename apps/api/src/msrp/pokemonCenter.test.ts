import { describe, expect, it } from "vitest";
import {
  extractMsrpPricesFromHtml,
  extractMsrpPricesFromJson,
  extractPokemonCenterCatalogMsrpPrices,
} from "./pokemonCenter";

describe("Pokemon Center MSRP extraction", () => {
  it("extracts MSRP prices from JSON-LD product data", () => {
    const rows = extractMsrpPricesFromHtml(
      `
        <script type="application/ld+json">
          {
            "@type": "Product",
            "name": "Pokémon TCG: Scarlet & Violet Booster Bundle",
            "image": "/images/booster.jpg",
            "url": "/product/123",
            "offers": {
              "price": "26.94",
              "priceCurrency": "USD"
            }
          }
        </script>
      `,
      "https://www.pokemoncenter.com/category/trading-card-game?category=tcg-cards&page=1",
      "pokemoncenter.com",
      "2026-05-02T00:00:00.000Z",
    );

    expect(rows).toEqual([
      {
        sourceSite: "pokemoncenter.com",
        sourceUrl: "https://www.pokemoncenter.com/category/trading-card-game?category=tcg-cards&page=1",
        productName: "Pokémon TCG: Scarlet & Violet Booster Bundle",
        normalizedName: "pok-mon-tcg-scarlet-violet-booster-bundle",
        price: 26.94,
        currency: "USD",
        productUrl: "https://www.pokemoncenter.com/product/123",
        imageUrl: "https://www.pokemoncenter.com/images/booster.jpg",
        releaseDate: null,
        type: null,
        scrapedAt: "2026-05-02T00:00:00.000Z",
      },
    ]);
  });

  it("deduplicates products by normalized name", () => {
    const rows = extractMsrpPricesFromHtml(
      `
        <script type="application/ld+json">
          [
            {"@type":"Product","name":"Test Box","offers":{"price":"59.99","priceCurrency":"USD"}},
            {"@type":"Product","name":"Test Box","offers":{"price":"59.99","priceCurrency":"USD"}}
          ]
        </script>
      `,
      "https://www.pokemoncenter.com/category/trading-card-game?category=tcg-cards&page=1",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.price).toBe(59.99);
  });

  it("extracts MSRP prices from nested product JSON", () => {
    const rows = extractMsrpPricesFromJson(
      {
        data: {
          products: [
            {
              "@type": "Product",
              name: "Pokémon TCG: Example Collection",
              url: "/product/456",
              offers: { price: 39.99, priceCurrency: "USD" },
            },
          ],
        },
      },
      "https://www.pokemoncenter.com/category/trading-card-game?category=tcg-cards&page=1",
      "pokemoncenter.com",
      "2026-05-02T00:00:00.000Z",
    );

    expect(rows).toMatchObject([
      {
        productName: "Pokémon TCG: Example Collection",
        price: 39.99,
        productUrl: "https://www.pokemoncenter.com/product/456",
      },
    ]);
  });

  it("extracts Pokemon Center catalog fields for msrp_prices", () => {
    const rows = extractPokemonCenterCatalogMsrpPrices(
      [
        {
          code: "10-10407-119",
          images: [{ original: "https://www.pokemoncenter.com/images/DAMRoot/Full-Size/10030/P11219_10-10407-119_01.jpg" }],
          listPrice: { amount: 161.64, display: "$161.64" },
          name: "Pokémon TCG: Mega Evolution-Chaos Rising Booster Display Box (36 Packs)",
          releaseDate: "2026-04-13T00:00:00Z",
          reportingCrumb: "TRADING CARD GAME>TCG Cards>Booster Packs",
        },
      ],
      "2026-05-02T00:00:00.000Z",
    );

    expect(rows).toEqual([
      {
        sourceSite: "pokemoncenter.com",
        sourceUrl: "pokemoncenter.com",
        productName: "Pokémon TCG: Mega Evolution-Chaos Rising Booster Display Box (36 Packs)",
        normalizedName: "Mega Evolution-Chaos Rising Booster Display Box (36 Packs)",
        price: 161.64,
        currency: "USD",
        productUrl:
          "https://www.pokemoncenter.com/product/10-10407-119/pokemon-tcg-mega-evolution-chaos-rising-booster-display-box-36-packs",
        imageUrl: "https://www.pokemoncenter.com/images/DAMRoot/Full-Size/10030/P11219_10-10407-119_01.jpg",
        releaseDate: "2026-04-13T00:00:00Z",
        type: "Booster Packs",
        scrapedAt: "2026-05-02T00:00:00.000Z",
      },
    ]);
  });
});
