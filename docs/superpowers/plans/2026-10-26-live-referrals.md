# Live referral implementation record

Goal: connect the approved $10/200-point referral flow and configurable milestones.
Spec: ../specs/2026-10-26-phase-2-referrals-design.md

- [x] Add shop/customer-scoped referral identities, first-order claim snapshots,
  unique milestone entitlements, and serialized ledger settlement.
- [x] Implement verified order/refund/cancellation processing, proportional point
  recovery, debt settlement from future earnings, and gift activation outbox.
- [x] Add native customer-account and signed storefront UI with explicit sharing,
  friend offer claims, and gift claims. Add merchant activation/readiness gates.
- [x] Test first-order/customer/quantity/currency protections in the Shopify
  Function, validate GraphQL schemas, and build the app locally.
- [x] Independent review: fix stale external activation and interrupted-creation
  recovery findings with failing-then-passing regression tests.
- [x] Finish final regression run, commit, and push without deployment or merge.

Verification: Node 22 full suite 102 passed, 4 historical-data skips, 0 failures.
Shopify app build and GraphQL schema validation passed.

Implementation choices: claims expire after attributionDays; gift claims last 30
 days; minimum pre-discount merchandise subtotal covers discount + 0.01; partial
refunds retain referral progress until fully refunded; consumed gifts aren't
reissued; shortfalls from spent points are recovered from future earnings.
These are implementation policies, not additional choices quoted from the user.

Known validation boundary: live Shopify checkout and new account login return URLs
require the authorized development-store rollout checklist in rewards/REFERRALS.md.
