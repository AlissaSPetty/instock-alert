# Pricechecker

Pricechecker is a lightweight inventory tracking app for user-submitted product pages.

The MVP uses:

- React + Vite for the web dashboard.
- Node.js + Express for authenticated API routes, Playwright capture, preflight verification, and scraper generation.
- Supabase for Auth, RLS, Postgres, and user-owned tracking data.
- A Node worker for scalable stock checks, with a path to deploy on Google Cloud Run.

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy environment variables:

   ```sh
   cp .env.example .env
   ```

3. Fill in Supabase values and a SerpAPI key in `.env`.

   For real email alerts from the worker, set `EMAIL_NOTIFICATIONS_ENABLED=true` and add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (Resend: verify your domain or use their test sender). Leave these unset or disabled for local dev if you do not want outbound email.

4. Apply the migration in `supabase/migrations`.

5. Start development services:

   ```sh
   npm run dev:api
   npm run dev:web
   npm run dev:worker
   ```

## Approval Flow

Users can create an account, but inventory tracking is hidden until they are approved.

Approval is controlled through Supabase Auth app metadata:

```json
{
  "role": "pricechecker_approved"
}
```

Do not use user metadata for this role. User metadata is editable by users and is not safe for authorization.

## Scaling Notes

The schema separates shared `scrape_targets` from user-owned `tracked_items`, so many users can subscribe to the same target without creating duplicate checks.

The MVP worker can run locally. For production scale, deploy the worker to Google Cloud Run and later add Cloud Tasks or Pub/Sub for queueing.

## Search Suggestions

When a submitted page cannot be verified, the API uses SerpAPI to find candidate product pages for the same website and item. Set `SERPAPI_API_KEY` in `.env`.
