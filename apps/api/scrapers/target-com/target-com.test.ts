import { describe, expect, it } from "vitest";

describe("target.com scraper", () => {
  it("fetches the selected stock endpoint", async () => {
    const response = await fetch("https://redsky.target.com/redsky_aggregations/v1/web/product_fulfillment_and_variation_hierarchy_v1?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&required_store_id=1394&latitude=34.250&longitude=-84.180&scheduled_delivery_store_id=1394&state=GA&zip=30040&store_id=1394&paid_membership=false&base_membership=false&card_membership=false&is_bot=false&tcin=95058826&visitor_id=019DF11FE5150200AB608CBFC21C5FC7&channel=WEB&page=%2Fp%2FA-95058826", {
      method: "GET"
    });

    expect(response.status).toBeLessThan(500);
    const text = await response.text();
    expect(text.toLowerCase()).toMatch(/stock|available|availability|inventory|quantity|sold|product/);
  });
});
