import { describe, expect, it } from "vitest";
import {
  createTrackingRequestSchema,
  hasApprovedRole,
  itemTokens,
  normalizeHost,
  notificationPreferenceSchema,
  refreshIntervalSeconds,
  slugify,
} from "./index";

describe("shared validation", () => {
  it("accepts tracking requests without notification contact fields or MSRP", () => {
    const result = createTrackingRequestSchema.safeParse({
      websiteUrl: "https://example.com/item",
      itemName: "Test Item",
      notificationPreference: "email",
      refreshInterval: "5min",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a valid request with an image", () => {
    const result = createTrackingRequestSchema.safeParse({
      websiteUrl: "https://example.com/item",
      itemName: "Test Item",
      imageUrl: "https://example.com/image.jpg",
      msrpPrice: 99.99,
      notificationPreference: "sms",
      refreshInterval: "5min",
    });

    expect(result.success).toBe(true);
  });

  it("rejects removed fast refresh intervals", () => {
    const result = createTrackingRequestSchema.safeParse({
      websiteUrl: "https://example.com/item",
      itemName: "Test Item",
      msrpPrice: 99.99,
      notificationPreference: "email",
      refreshInterval: "1min",
    });

    expect(result.success).toBe(false);
  });

  it("requires profile settings to include a contact method", () => {
    const result = notificationPreferenceSchema.safeParse({
      email: "",
      phone: "",
      notificationPreference: "email",
    });

    expect(result.success).toBe(false);
  });

  it("normalizes hostnames and slugs", () => {
    expect(normalizeHost("https://www.Example.com/item")).toBe("example.com");
    expect(slugify("Example Store / Test Item")).toBe("example-store-test-item");
  });

  it("checks approved roles from app metadata", () => {
    expect(hasApprovedRole({ role: "pricechecker_approved" })).toBe(true);
    expect(hasApprovedRole({ role: "pending" })).toBe(false);
  });

  it("extracts meaningful item tokens", () => {
    expect(itemTokens("Sony PlayStation 5 Pro")).toEqual(["sony", "playstation", "pro"]);
    expect(refreshIntervalSeconds["24hours"]).toBe(86400);
  });
});
