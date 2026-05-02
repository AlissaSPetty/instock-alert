import { describe, expect, it } from "vitest";
import { findClosestMsrpPrice } from "./matching";

describe("MSRP matching", () => {
  it("matches long retailer titles to the closest MSRP product type", () => {
    const match = findClosestMsrpPrice(
      "Pokemon TCG Scarlet & Violet Elite Trainer Box - Prismatic Evolutions of The Pokemon TCG (1 Fully Illustrated Promo Card, 9 Booster Packs & Premium)",
      [
        {
          product_name: "Pokemon TCG: Scarlet & Violet-Prismatic Evolutions Mini Tin",
          normalized_name: "Scarlet & Violet-Prismatic Evolutions Mini Tin",
          type: "Mini Tin",
          price: 9.99,
          currency: "USD",
        },
        {
          product_name: "Pokemon TCG: Scarlet & Violet-Prismatic Evolutions Elite Trainer Box",
          normalized_name: "Scarlet & Violet-Prismatic Evolutions Elite Trainer Box",
          type: "Elite Trainer Box",
          price: "49.99",
          currency: "USD",
        },
      ],
    );

    expect(match).toMatchObject({
      type: "Elite Trainer Box",
      price: 49.99,
    });
  });

  it("expands ETB before matching", () => {
    const match = findClosestMsrpPrice("Pokemon Prismatic Evolutions ETB", [
      {
        product_name: "Pokemon TCG: Scarlet & Violet-Prismatic Evolutions Elite Trainer Box",
        normalized_name: "Scarlet & Violet-Prismatic Evolutions Elite Trainer Box",
        type: "Elite Trainer Box",
        price: 49.99,
      },
    ]);

    expect(match?.price).toBe(49.99);
  });

  it("does not use weak unrelated matches", () => {
    const match = findClosestMsrpPrice("Mechanical keyboard carrying case", [
      {
        product_name: "Pokemon TCG: Scarlet & Violet Booster Bundle",
        normalized_name: "Scarlet & Violet Booster Bundle",
        type: "Booster Bundle",
        price: 26.94,
      },
    ]);

    expect(match).toBeNull();
  });
});
