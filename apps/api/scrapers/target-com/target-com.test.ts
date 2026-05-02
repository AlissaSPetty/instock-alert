import { describe, expect, it } from "vitest";

describe("target.com scraper", () => {
  it("fetches the selected stock endpoint", async () => {
    const response = await fetch("https://www.target.com/cdui_orchestrations/v1/pages/pdp/deferred_enrichment/modules?auth=true&purchasable_store_ids=1394&latitude=34.250&longitude=-84.180&scheduled_delivery_store_id=1394&state=GA&zip=30040&store_id=1394&tcin=1008746912&sapphire_channel=WEB&sapphire_page=%2Fp%2FA-1008746912&channel=WEB&page=%2Fp%2FA-1008746912&visitor_id=019DE448B0B40200A234A1EACA6BFEE7&key=9f36aeafbe60771e321a7cc95a78140772ab3e96", {
      method: "POST"
    });

    expect(response.status).toBeLessThan(500);
    const text = await response.text();
    expect(text.toLowerCase()).toMatch(/stock|available|availability|inventory|quantity|sold|product/);
  });
});
