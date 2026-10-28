# Checkout rewards widget

The existing `FreeTheRoots Checkout Rewards` block now follows the supplied
collapsed/expanded layout: brand leaf, membership tier, wallet balance, next
order-discount gap, three affordable tiles, an expandable list, and estimated
purchase points. Tile order is descending points cost. Counts, values, and tier
come from the signed-in customer's live data; screenshot numbers are examples.

## Scope and styling

Tiles include enabled, synchronized fixed/percentage order discounts whose points
cost is affordable. Gifts and shipping rewards stay on the full rewards page.
Reserved codes remain recoverable in checkout, including when Shopify declines
to add a code. Minimum-spend and other Shopify discount conditions still apply.

This is a native Shopify checkout extension, not the custom storefront page.
Background, border, text color, typography, and spacing use Shopify's permitted
semantic styles and merchant checkout branding. Arbitrary mint/brown hex colors
and custom CSS cannot be assigned per component. The green leaf is an intentional
brand image served from the backend, not a merchant-color text icon.

Purchase points use the current checkout subtotal and configured purchase rules,
including per-rule rounding and multipliers. A numeric estimate is hidden when
store currency is unavailable/differs from presentment currency, or eligibility
needs unavailable tags, order history, product/collection restrictions, or award
limits. Estimates are not an award; the paid-order webhook remains authoritative.
Public shop currency metadata is cached per shop, with a one-second maximum wait
and shared in-flight requests, so metadata failure cannot stall the wallet.

## Reservation safety

The initial idempotency key is deterministic per checkout/customer/reward and
survives remounts. Terminal failed attempts use a deterministic retry key derived
from their reservation reference. A reservation still provisioning its code
blocks new selection. An added code can be reapplied after the buyer removes it.
Buyer changes reset the widget; stale responses never apply another buyer's code
or unlock the new buyer's in-flight reservation. Checkout instructions forbidding
discount updates block reservation before points are reserved.

## Release instructions

From the repository root on `feature/rewards-admin-v1`:

```sh
git pull --ff-only origin feature/rewards-admin-v1
flyctl deploy --remote-only --app freetheroots-rewards-system
npx shopify app build --config checkout-upsell-app
npx shopify app deploy --config checkout-upsell-app
```

Deploy the backend first for currency metadata and the leaf image. These are user
instructions; Codex has not deployed or merged this change.

In Shopify **Settings → Checkout → Edit/Customize configuration**, add or select
**FreeTheRoots Checkout Rewards** at the supported checkout app-block position.
Set **Rewards API URL** to `https://freetheroots-rewards-system.fly.dev`; set the
heading if desired, then save. Actual checkout appearance must be checked there
because the editor applies the store's branding.

## Development-store acceptance

1. Sign in as a customer with points and open an eligible checkout. Confirm tier,
   balance, next reward gap and the three highest-cost affordable order discounts.
2. When more than three qualify, expand the list and collapse it again. Confirm
   order and count match admin's synced order-discount catalogue.
3. Change cart quantities. Check the numeric estimate updates for a simple
   purchase rule; it should say estimated, and exclude shipping/tax.
4. Select one reward. Confirm one reservation and one checkout code. Remove the
   code using checkout's discount UI, then reapply the reserved code in the widget
   without another reservation.
5. Verify minimum-spend rejection leaves a recoverable reservation. Do not use a
   paid live order for this check. Complete an authorized test order to verify
   final consumption once.
6. Check signed-out, zero-points, fewer-than-three, unsynced, and restricted
   checkout states, plus desktop/mobile and Shop Pay where supported.
7. Confirm customer switching does not show/apply the previous customer's code.

Automated checks: `npm run test:checkout-ui`, `npm run test:account-ui`, and
`cd rewards && npm test`. Checkout DOM tests simulate Shopify responses; they do
not prove live checkout branding or Shopify's monetary discount application.

## Validation record

Local Shopify build and the checkout/account/backend test suites passed. The
public currency query passed GraphQL validation for 2026-07. The bundled
component validator could not run because its type index is absent; supported
component properties were checked against the installed 2026.7.0 SDK instead.
Live checkout visual and monetary validation remain the acceptance steps above.
