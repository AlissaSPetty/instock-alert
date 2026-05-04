# target.com

## Website Interaction

- Method: `GET`
- URL: `https://redsky.target.com/redsky_aggregations/v1/web/product_fulfillment_and_variation_hierarchy_v1?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&required_store_id=1394&latitude=34.250&longitude=-84.180&scheduled_delivery_store_id=1394&state=GA&zip=30040&store_id=1394&paid_membership=false&base_membership=false&card_membership=false&is_bot=false&tcin=95058826&visitor_id=019DF11FE5150200AB608CBFC21C5FC7&channel=WEB&page=%2Fp%2FA-95058826`
- Content-Type: `application/json`

## Scrape Strategy

Fetch the selected request directly and parse the response for stock indicators such as inventory, availability, quantity, sold out, or in-stock values. Avoid Playwright for recurring checks unless this direct request stops working.

## Verification Tests

The generated test checks that the captured request can be fetched and that the response contains likely stock-related fields or text. Keep this test updated if the site changes its inventory API.
