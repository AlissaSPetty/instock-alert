import { describe, expect, it } from "vitest";
import { getBlockedSite } from "./siteCapabilities";

describe("getBlockedSite", () => {
  it("blocks Walmart URLs", () => {
    expect(getBlockedSite("https://www.walmart.com/ip/Roku-Streamer/16982615221")?.host).toBe("walmart.com");
  });

  it("allows unlisted sites", () => {
    expect(getBlockedSite("https://www.jetpens.com/product")).toBeNull();
  });
});
