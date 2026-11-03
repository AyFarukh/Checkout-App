# Quick testing guide: dashboard without custom header/footer

The dashboard keeps the reference body design and outlined icons. It uses the existing theme header/footer instead of adding replacements. Back to account stays inside the dashboard. No mutation permissions, production flags or customer scope have changed.

## 1. Update the backend test branch

Use Node 22.12 or newer. From your existing Checkout-App checkout, keep local credentials private and leave local uncommitted work intact. If git reports local changes blocking a switch/pull, resolve them before continuing; do not reset them.

```sh
cd /Users/farukhsultan/shopify-checkout/Checkout-App
git fetch origin
git switch feature/loop-action-adapter-v1
git pull --ff-only origin feature/loop-action-adapter-v1
cd rewards
npm ci
npx playwright install chromium
unset FTR_THEME_ASSET
npm run test:subscriptions:all
```

This is the safe automated suite: real local Express/Mongo and controlled Loop fixtures. It never mutates live subscriptions. Expected: 105 unit passes, two existing Mongo-dependent skips, 70 integration passes and 55 browser passes. It covers existing actions, one-time Add, durable replay/unknown recovery, authentication/ownership, variants, keyboard controls, mobile layout and preservation of existing store header/footer.

To run just routine-related browser checks:

```sh
npm run test:subscriptions:e2e -- --grep routine
```

## 2. Update the unpublished theme preview

From your existing Freetheroot-Shopify-Theme-Dev checkout:

```sh
git fetch origin
git switch feature/loop-all-actions-confirmation-v1
git pull --ff-only origin feature/loop-all-actions-confirmation-v1
shopify theme dev
```

Use the existing linked store. Open the preview URL printed by Shopify CLI, then visit /pages/subscription?view=ftr-subscriptions inside that preview session and sign in through your own customer account. Do not share login codes or API tokens.

Alternatively copy these three files together into the unpublished development theme: assets/ftr-subscription-dashboard.js, assets/ftr-subscription-dashboard.css and sections/ftr-subscription-dashboard.liquid. Products to explore in the FTR Subscription Portal settings selects the recommendation collection; Support page URL overrides the existing contact-us page. There is no portal logo setting because the existing storefront header handles branding.

Check desktop and mobile: normal storefront header/footer visible, no duplicates, reference dashboard body intact, each owned subscription card updates the entire view, Back to account works, notes/discount/address match, scheduled/past orders load, payment links open the account portal, and routine Add buttons present the variant/quantity confirmation. Existing one-time lines show Next order only.

## 3. Live-test boundary

The latest backend runtime must be deployed after approval before the new order reads/capability response/one-time adapter are available to the preview. Updating theme files does not deploy the backend. Existing production configuration intentionally disables mutations, so disabled Add/change controls on production are expected.

Live one-time acceptance is still pending. Use only the authorized local test environment and subscription 42347174 when separately running a live test. Never use cancel as cleanup; leave this subscription ACTIVE. Order now can charge a payment method and must not be used merely to test the layout. An unknown outcome must keep its original request key; use status, never create a replacement attempt while uncertain. Gift remains unavailable because Loop provides no custom-portal gift API. A passing blocked-gift test does not mean gift functionality is available.

Do not merge either PR, publish the theme, deploy production or enable production mutations without approval.
