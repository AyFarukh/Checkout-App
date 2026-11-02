# Reference design and one-time routine additions

## Requested behavior

Match the supplied desktop_view.png and mobile_view.jpg: dark forest-green primary actions, pale green mobile status banner, warm neutral background, outlined icons, compact subscription rows, payment above shipping, five routine product tiles and six management actions. Preserve customer-specific subscription cards when the customer has more than one subscription, Back to account, authenticated reads and pending action recovery.

The implementation stays in the existing Liquid section and vanilla JavaScript/CSS assets. Outlined inline SVGs replace emoji and text glyphs. The dashboard does not supply a custom header or footer and does not hide the storefront header/footer. Existing theme branding and navigation remain in place. Contact links default to the store's existing contact-us page. Sample customer names, card numbers, charges and prices from the reference are never copied into customer data. Payment update and backup management continue through the secure account portal.

## Complete your routine configuration

Select Products to explore in the FTR Subscription Portal section to curate the recommendations. Without a selected collection, the existing all-products fallback remains. Render available variants only, exclude products requiring a selling plan, exclude products already present on the selected subscription, and show up to five products after filtering. Add opens the one-time modal with available variant choices and quantity. There is no View product purchase button. See more products is a separate browse link.

Add once uses the existing edit-products action with operation add-once, so it inherits signed authentication, ownership checks, preview tokens, explicit confirmation, durable Mongo idempotency, per-subscription locks and status recovery. Catalog validation is server-side at preview and execution, using the documented Loop product type ALL for one-time products and SUBSCRIPTION for recurring add/swap. Client-supplied prices, discounts and unsupported fields are rejected.

The provider request is POST subscription/{id}/line/once with variantShopifyId, quantity, discountType NONE, discountValue 0 and isUpsell true. Loop determines the ordinary product price. It does not use the recurring line endpoint and does not place or charge an immediate order. A verified result requires exactly one new isOneTimeAdded=true line of the requested variant and quantity, every prior line unchanged, and an unchanged next billing date. Unknown outcomes retain their key and never redispatch automatically. Added lines display One-time · Next order only.

Primary API contracts: https://developer.loopwork.co/reference/add-line-once and https://developer.loopwork.co/reference/list-products .

## Verification and rollout boundary

Validated 2026-11-02: 105 unit passes with two existing Mongo-dependent skips, 70 HTTP/Mongo integration passes, and 53 browser passes. Coverage includes the one-time endpoint, non-selling-plan variants, unsafe-price rejection, replay, unchanged/unknown outcomes, recovery after provider 500, preservation of existing one-time lines, keyboard focus, read-only Add behavior, selected-customer isolation and the existing action suite. Browser full-stack tests use real local Express routes and Mongo with controlled Loop HTTP fixtures. The changed theme files pass the Shopify validator with bundled schemas when the online documentation refresh is unavailable. Desktop and mobile rendering were inspected, including 390px overflow checks.

These are not new live-provider acceptance results. No live Loop credentials or customer browser session are available in this workspace. Gift remains blocked by Loop's unavailable API. Production mutation blocking and the authorized test scope are unchanged. No PR merge, production deployment or theme publication is performed.

Update backend PR21 and all three theme files from PR8 together after deployment approval. The local backend test fixture pins these exact theme assets and verifies their checksums. No new secret or app is required. Existing Fly configuration remains in use. Live one-time acceptance on authorized subscription 42347174 remains pending and must not be represented as passed; leave it ACTIVE and do not cancel as cleanup.
