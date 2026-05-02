import { describe, expect, it } from "vitest";
import { titleContainsItemName } from "./preflight";

describe("titleContainsItemName", () => {
  it("allows titles with extra model and retailer text", () => {
    expect(titleContainsItemName("Ninja Pressure Cooker PC200 - Walmart.com", "Ninja Pressure Cooker")).toBe(true);
  });

  it("does not allow unrelated titles", () => {
    expect(titleContainsItemName("Robot or human?", "Ninja Pressure Cooker")).toBe(false);
  });
});
