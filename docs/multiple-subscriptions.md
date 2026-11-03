# Organized customer subscription dashboard

The dashboard reads each signed-in customer's subscriptions through the existing Shopify app proxy. It displays selectable cards containing subscription ID, status, products and next date. There is no customer or subscription ID embedded in the theme. Selection updates all details and action targets together, survives verified refresh, and is locked while a dialog is open. Pending requests remain scoped to their original subscription.

## Layout and real data

- Back to account uses Liquid routes.account_url and remains available on success, empty and error screens.
- Products, shipping, saved order note and active discounts use the selected subscription's response.
- Payment management and account order links return to the existing account portal.
- Scheduled and past orders load on demand from authenticated POST /apps/ftr-welcome/subscriptions/order-list with subscriptionId and kind (schedule or history). Errors offer a read retry. Empty lists have explicit messages. The response contains safe order fields only, displays up to the first 100 returned orders and discloses truncation.
- Products to explore come from the section's collection setting, falling back to collections.all. Unavailable products and products already on the selected subscription are excluded. Empty recommendations are hidden. Add buttons now open a preview/confirmation flow for one-time products on the next subscription order. See docs/reference-dashboard-one-time.md for the current design and configuration.

## Authentication and mutation gates

The backend derives shop and customer ID from Shopify's signed proxy request. Both subscription lists and order reads require an installed store and a configured merchant matching the global Loop token. Set LOOP_ADMIN_SHOP to that merchant's exact myshopify.com domain. For existing configurations the service also accepts LOOP_TEST_SHOP, then SHOPIFY_ADMIN_SHOP as fallbacks. No match or missing configuration fails closed. Order reads additionally verify customer ownership and the fetched subscription identity before reading its orders.

The UI requires explicit boolean mutationsEnabled=true and mutationAllowed=true. Missing, null or string capability values keep changes disabled. Production's existing server mutation block remains unchanged. The authorized local test scope remains subscription 42347174; production mutations are not enabled. Existing pending requests can still check status without another write. Preview tokens, explicit confirmation, durable idempotency and post-action verification remain intact.

Loop confirmed there is no gift-upcoming-order API for a custom portal. Gift displays that limitation and sends no mutation. Payment management uses the account portal rather than an unsupported custom form. No claim is made that all 12 live actions pass.

## Validation and preview update

On 2026-11-03 the suite passed 105 unit tests (two existing Mongo-dependent skips), 70 subscription integration tests and 55 browser tests. Browser coverage includes all supported action forms and full local Express/Mongo/provider-fixture flows, card selection/isolation, pending checks in read-only mode, account/payment links, safe lazy order views with retries, saved fields, recommendation links, missing/malformed permissions and mobile fit. These are local controlled-provider tests, not a new live customer acceptance run. Liquid/asset validation passed using the validator's bundled Shopify schemas because its online documentation refresh timed out.

The theme changes are on feature/loop-all-actions-confirmation-v1. Update these three files together in the unpublished development theme: assets/ftr-subscription-dashboard.js, assets/ftr-subscription-dashboard.css and sections/ftr-subscription-dashboard.liquid. Select a recommendation collection in the theme editor if desired. Reload the signed-in preview and select the intended subscription card.

The matching backend changes are on feature/loop-action-adapter-v1. The new order-list route and capability response require deploying that branch before testing the new order views in the preview. Confirm LOOP_ADMIN_SHOP or its existing fallback matches the Loop merchant; never copy local live-test credentials into the theme or Fly configuration. Do not merge PRs, publish the theme or enable production mutations without approval. Subscription 42347174 must remain ACTIVE; do not cancel as cleanup.

Run the full offline suite from Checkout-App/rewards:

```sh
npm ci
npx playwright install chromium
npm run test:subscriptions:all
```

The backend includes pinned theme assets with SHA256 integrity checks, so this command needs no separate theme checkout. When testing current theme work directly, set FTR_THEME_ASSET to the absolute path of assets/ftr-subscription-dashboard.js; its matching CSS must be beside it.

Signed-in acceptance after the approved deployment: verify both owned subscription cards, compare all fields while switching, open both order views, follow Back to account and payment links, check recommendation product destinations, and confirm production changes stay disabled. Credentials and customer addresses must not be posted into chat. Real signed-in browser acceptance remains pending; no new live Loop mutations were performed for this update.
