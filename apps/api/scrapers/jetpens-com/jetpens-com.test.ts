import { describe, expect, it } from "vitest";

describe("jetpens.com scraper", () => {
  it("fetches the selected stock endpoint", async () => {
    const response = await fetch("https://www.jetpens.com/cdn-cgi/challenge-platform/h/b/flow/ov1/3306608356:1777606039:PdW5t9CD_enI7qvaqRzNf9ZSae0_o_BSD_5dVh6hJtI/9f4bf5981a1112f1/pgEPelaaqnTTNJ5wsFYxRtXj88_0ixMS8Q.LzRfGY9U-1777608866-1.2.1.1-mRjvlPWpHEePVjAePc4NK.hqNH4AAfSaLHc4fYcw_cURAiB0AYlozhyVxr5UPPoV", {
      method: "POST"
    });

    expect(response.status).toBeLessThan(500);
    const text = await response.text();
    expect(text.toLowerCase()).toMatch(/stock|available|availability|inventory|quantity|sold|product/);
  });
});
