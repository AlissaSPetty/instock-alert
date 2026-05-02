# target.com

## Website Interaction

- Method: `POST`
- URL: `https://www.target.com/cdui_orchestrations/v1/pages/pdp/deferred_enrichment/modules?auth=true&purchasable_store_ids=1394&latitude=34.250&longitude=-84.180&scheduled_delivery_store_id=1394&state=GA&zip=30040&store_id=1394&tcin=1008746912&sapphire_channel=WEB&sapphire_page=%2Fp%2FA-1008746912&channel=WEB&page=%2Fp%2FA-1008746912&visitor_id=019DE448B0B40200A234A1EACA6BFEE7&key=9f36aeafbe60771e321a7cc95a78140772ab3e96`
- Content-Type: `application/json`

## Scrape Strategy

Fetch the selected request directly and parse the response for stock indicators such as inventory, availability, quantity, sold out, or in-stock values. Avoid Playwright for recurring checks unless this direct request stops working.

## Verification Tests

The generated test checks that the captured request can be fetched and that the response contains likely stock-related fields or text. Keep this test updated if the site changes its inventory API.
