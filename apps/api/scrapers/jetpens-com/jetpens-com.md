# jetpens.com

## Website Interaction

- Method: `POST`
- URL: `https://www.jetpens.com/cdn-cgi/challenge-platform/h/b/flow/ov1/3306608356:1777606039:PdW5t9CD_enI7qvaqRzNf9ZSae0_o_BSD_5dVh6hJtI/9f4bf5981a1112f1/pgEPelaaqnTTNJ5wsFYxRtXj88_0ixMS8Q.LzRfGY9U-1777608866-1.2.1.1-mRjvlPWpHEePVjAePc4NK.hqNH4AAfSaLHc4fYcw_cURAiB0AYlozhyVxr5UPPoV`
- Content-Type: `text/plain; charset=UTF-8`

## Scrape Strategy

Fetch the selected request directly and parse the response for stock indicators such as inventory, availability, quantity, sold out, or in-stock values. Avoid Playwright for recurring checks unless this direct request stops working.

## Verification Tests

The generated test checks that the captured request can be fetched and that the response contains likely stock-related fields or text. Keep this test updated if the site changes its inventory API.
