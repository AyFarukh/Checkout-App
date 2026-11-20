# FreeTheRoots subscriber journey

## Approved behavior

- Each subscription has its own journey. Only ACTIVE subscriptions are enrolled, displayed or granted a reward.
- Existing successfully paid PROCESSED subscription orders carry over, including the checkout order when returned by Loop. Failed, pending, skipped and duplicate orders do not advance the journey. Paid partially refunded orders count; fully refunded orders do not newly advance it. Previously carried-over progress is not decremented by later refunds.
- Journey order 2 receives an additional 10% off; journey order 5 receives an additional 20% off. No gift, retroactive credit or rewards after completion.
- "Additional" means a reduction of the already-discounted merchandise subtotal: $100 with an existing 5% benefit becomes $95, then $85.50 with the 10% journey reward. It is not a ten percentage-point replacement of the existing benefit.
- A verified customer skip restarts an ongoing journey from zero and withdraws an unclaimed program reward. Orders paid after that skip advance the new cycle. Completed journeys never restart. Skips before initial program enrollment are not retroactively imported as resets.
- The server is the source of progress. The browser never increments order counts or grants discounts. The journey CTA uses the existing payment warning, preview, explicit confirmation, idempotency key and post-action verification.

This is a custom backend journey, not Loop's native Streaks program. Do not enable a competing native Flow/Streak reward for the same customers/milestones; doing so can double-discount an order.

## Deployment and configuration (operator approval required)

Initial rollout is restricted to `LOOP_JOURNEY_ALLOWED_SUBSCRIPTION_IDS=42347174` by default. Other subscriptions cannot display, enroll or receive journey discounts. Use a comma-separated reviewed cohort or the explicit value `all` only after production approval.

This change does not activate itself. Keep both new enable flags false while preparing it. Backend changes require a Fly deployment; dashboard assets require a theme update. Shopify CLI app deployment alone does not deploy the Fly backend.

1. Verify Loop supports one-order contract-bound manual discounts on this store, without changing its base subscription benefit. The documented Admin 2026-04 request is `POST subscription/{id}/discount` with `manualDiscount: {title, type: "PERCENTAGE", value: 10 or 20, orderLimit: 1, lineIds: null}`. Titles are deterministically bound to the program/subscription/reset cycle; these are manual discounts, not reusable Shopify coupon codes.
2. Test both percentages on authorized subscription 42347174 with Loop. After applying, Loop must expose matching `title`, `type: PERCENTAGE`, numeric `value`, `orderLimit: 1`, `usageCount: 0`, and `isActive: true`; the discounted merchandise subtotal must decrease by the expected amount. Unknown/missing fields do not prove success. Zero or missing discountable subtotal requires review. Confirm removal by `discountShopifyId` preserves every unrelated benefit.
3. Configure signed Loop deliveries to `https://<backend-host>/webhooks/loop-journey`. Deliver subscription creation/updates and processed/skipped order events. Set a Loop signing secret (rotation supports a comma-separated list). The raw-body HMAC is checked against `X-Loop-Webhook-Signature` using `v1=` + SHA256 hex. Header topic, timestamp and delivery-ID are not used as trusted event data.
4. Confirm the real signed payload uses `metaData.myshopifyDomain`, `metaData.entity: subscription|order`; subscription ID is `payload.id` for subscription events and `payload.subscriptionId` for orders. A skipped order must include `payload.status: SKIPPED`, `payload.id`, and a signed ISO `payload.skippedAt` or `payload.updatedAt`. Missing skip timestamps are quarantined, never replaced by the unsigned delivery timestamp. If Loop's actual payload differs, adapt and retest before enabling automation.
5. After the isolated test passes, approve the rollout allowlist/cohort before bulk enrollment. Enable journey display/enrollment only (`LOOP_JOURNEY_ENABLED=true`, automation still false) after approval. Preview the existing active subscriber export before persisting enrollment. Do this before the cohort's next charges; merely visiting the portal is not a sufficient bulk rollout. New active subscription/processed-order webhooks also enroll customers without requiring a portal visit.
6. When manual discounts AND signed callbacks have been tested, set `LOOP_JOURNEY_MANUAL_DISCOUNTS_VERIFIED=true`, `LOOP_JOURNEY_WEBHOOK_VERIFIED=true`, and `LOOP_JOURNEY_AUTOMATION_ENABLED=true` after approval. Existing Loop merchant/mutation gates must also allow writes. Configure `LOOP_JOURNEY_WEBHOOK_SECRETS` privately on Fly. Never paste API headers or signing keys into commits, screenshots or chat.
7. Verify the entire acceptance list below before enabling the full cohort. Keep approval for live charges separate from read-only inspection and source review.

The UI is hidden when the feature is off. When enabled, a due but unverified reward disables the journey CTA and the server rejects Order now preview/execution. This guard only controls our portal's immediate-order action. It does NOT intercept Loop's own scheduled billing or actions made in another portal. The five-second worker and signed events must be monitored and healthy before scheduled charges; a live outage/reconciliation issue requires operator intervention. Do not promise that webhook receipt itself synchronously blocks billing.

## Existing subscription enrollment

From `rewards/`, prepare a PRIVATE JSON export mapping each active Loop subscription to its Shopify customer ID. No emails, addresses or tokens are required:

```json
[{"customerId":"123","subscriptionId":"42347174"}]
```

Use `.journey-enrollment.json` (ignored by git). With the merchant and database environment already loaded:

```bash
node scripts/subscriber-journey.js --file=.journey-enrollment.json
node scripts/subscriber-journey.js --file=.journey-enrollment.json --apply
node scripts/subscriber-journey.js --inspect
```

The first command only previews eligibility and carried-over counts. `--apply` stores enrollment; it does not call a provider mutation. Inactive subscriptions are excluded. Repeated enrollment retains the original baseline and cannot restart completed journeys. Review subscriptions at/beyond five orders as complete; do not issue retroactive rewards.

After automation approval, manually process one batch if needed:

```bash
node scripts/subscriber-journey.js --reconcile
node scripts/subscriber-journey.js --inspect
```

A batch processes up to 20 enrolled subscriptions, in oldest-checked order. The command returns a nonzero exit status if disabled or a reconciliation fails. Inspection is limited to 1,000 records; use database tooling for larger cohorts. All provider mutations are protected by the existing durable subscription lock, shared with customer actions. The worker records the program/cycle/milestone/operation key; timeouts never trigger a fresh-key retry.

## Error recovery and rollback

- Set `LOOP_JOURNEY_AUTOMATION_ENABLED=false` to stop new program writes. Setting `LOOP_JOURNEY_ENABLED=false` also hides the card, enrollment and webhook processing. These switches do not remove previously applied rewards. Retain one-cycle limits and inspect affected subscriptions with Loop before changing discounts.
- An ambiguous add/remove retains its subscription lock. Subsequent worker runs perform read-only verification; they never re-dispatch that operation. A missing/unprovable outcome needs provider/operator investigation. Do NOT delete ledger records, clear locks, rotate program IDs or generate a new key to bypass uncertainty.
- Provider metadata/subtotal mismatches, missing discount IDs, externally added program discounts, late old history and missing signed skip timestamps persist an `issue` for inspection. Resolve authoritative evidence and have the operator review a targeted recovery; do not invent success or silently rewrite the baseline.
- A five-minute tolerance allows a recently processed checkout to become visible after enrollment. Older newly discovered paid history fails closed to prevent awarding the wrong milestone. Any paginated/truncated history response fails closed rather than guessing a count.
- Only program discounts with a successful, verified program-add receipt can be removed. Other customer, shipping and selling-plan benefits are preserved.
- Program keys and receipts have no TTL. A worker restart and duplicate webhooks cannot erase a previous payment/reward outcome.

## Tests

Run from `rewards/`:

```bash
npm ci
npm run test:journey
npm run test:subscriptions:all
```

A browser install may be required: `npx playwright install chromium`. To test a sibling theme checkout rather than the pinned fixture, set `FTR_THEME_ASSET` to its absolute `assets/ftr-subscription-dashboard.js` path. This environment uses `MONGOMS_VERSION=7.0.24` because MongoDB 8.2's allocator cannot read its virtual CPU topology; this is a disposable-test override, not a production MongoDB change.

Automated tests use disposable Mongo and a real local HTTP Loop fixture, not live customer subscriptions. They cover 10%/20%, carried-over history, end-of-program behavior, reset/withdrawal, discount expiry, preserving base discounts, auth/ownership, raw signed webhooks, event replay, races, ambiguous outcomes, kill switches and responsive browser confirmation flows.

### Live acceptance still required

- Verify manual-discount fields, combination and single-cycle expiry from actual Loop responses; show 10% on the second order and 20% on the fifth. Confirm orders 3/4/6 keep their normal benefits.
- Verify signed skip payload shape/timestamp and actual retries; confirm duplicate deliveries reset once and late deliveries order correctly. Skips made in Loop's admin/native portal must reach this receiver.
- Carry over paid history accurately for the active cohort and verify first-order inclusion, zero-priced contracts, refunds and prepaid contracts with the merchant before including exceptions.
- Verify skip before/after reward preparation, pending-state recovery, pause/reactivate, terminal completion and denied foreign-customer access on the real store.
- Test the CTA only with explicit authorization for an actual test-subscription charge. Verify replay creates no extra order and restore test products/address/schedule as agreed.

No production credentials, real Loop mutations, webhooks, deployments, account configuration or live payments were available/executed while implementing this change. Automated fixture passes do not replace these live checks.

## API references checked

- https://developer.loopwork.co/reference/add-discount
- https://developer.loopwork.co/reference/remove-discount
- https://developer.loopwork.co/v2023.10/reference/list-order-history (history fields; implementation uses existing Admin 2026-04 base)
- https://developer.loopwork.co/v2023.10/reference/webhooks
- https://developer.loopwork.co/reference/verifying-webhook-signatures-loop
