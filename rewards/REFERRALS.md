# Live referrals: rollout and development-store testing

Implemented on `feature/rewards-admin-v1`, with automatic activation off. Existing
milestone settings are retained. No deployment, order or merge was performed.

## Behavior

- Each authenticated customer receives a random shop-scoped code and share URL.
  Text/Email opens their composer; the backend sends no messages.
- A friend opens the link, signs in or creates an account, then explicitly claims
  the offer before their first order. If login doesn't return to the link, reopen
  it after signing in. App-proxy cookies are not required.
- The friend discount is customer-bound, first-order-only and single-use. Defaults
  are 10 off in store currency and 200 referrer points. The Function checks the
  authenticated buyer, prior orders and presentment currency conversion. Backend
  qualification independently verifies Shopify's first order, customer and money.
  Self-referrals and reassignment are rejected.
- Minimum merchandise subtotal before discount is the greater of the configured
  minimum and discount amount + 0.01. Zero-value merchandise orders don't qualify.
  Friend codes expire after the configured attribution days. Claiming snapshots
  the friend's offer and referrer's base-point policy.
- The first-referral milestone describes the same 200 points, not another bonus.
  Other point milestones award automatically. Product milestones have an explicit
  claim action. Each milestone is unique per shop/customer/milestone ID and its
  earned terms are snapshotted. Newly added eligible milestones also reconcile
  when the authenticated customer refreshes their referral page.
- Gift codes last 30 days after claim. They require the recipient to be signed in
  and discount only the selected variant, up to the configured quantity across all
  cart lines. Storefront customers can explicitly add the gift to their existing
  cart; account-extension customers can view the product and copy the code. Gifts,
  friend discounts and ordinary rewards do not stack.
- Partial refunds proportionally reduce base points using cumulative Shopify shop-
  currency totals, rounded down, but retain progress until fully refunded. Full
  refunds and paid-order cancellations revoke progress. Unused gift codes above
  the new count are deactivated through a persisted, serialized outbox. Regained
  eligibility reactivates the SAME one-use code, never a second gift.
- Already consumed/physically fulfilled gifts are not reissued or automatically
  recovered. The merchant must handle returns and abuse disputes separately.
- Spent-point refund shortfalls become referral debt. Future earnings recover it
  with explicit ledger entries; wallets never go negative and reserved points are
  not taken. Duplicate or stale webhook events cannot mint points again.

Pausing blocks new offer/gift claims; existing order settlement remains honored.
Product mappings, quantities, titles, thresholds and bonus amounts stay editable.

## Controlled rollout — only when ready to deploy

Pull the branch first. Keep your existing `SHOPIFY_TOKEN_ENCRYPTION_KEY` unchanged;
see [TOKEN-HARDENING.md](TOKEN-HARDENING.md). From the repository root:

1. Deploy the backend with readiness absent or `0`:

   ```sh
   flyctl deploy --remote-only --app freetheroots-rewards-system
   ```

2. Build and publish the Shopify version, including the updated Function, customer
   account extension and `orders/cancelled` webhook subscription:

   ```sh
   shopify app build --config checkout-upsell-app
   shopify app deploy --config checkout-upsell-app
   ```

3. ONLY AFTER the new Shopify version is released, declare Function readiness:

   ```sh
   flyctl secrets set REFERRALS_FUNCTION_V2_READY=1 --app freetheroots-rewards-system
   ```

4. Open Referrals in the app on the development store, verify the saved variants,
   save if needed, and choose **Enable referrals**. Server readiness and explicit
   store activation are both required. Never declare readiness before publishing:
   the old Function does not enforce the new first-order rules.

## Development-store testing

Use distinct accounts A (referrer) and B (new friend), with separate browser
sessions. Do not share their tokens, app credentials or encryption key.

1. A opens Rewards → Refer a Friend and copies the unique link.
2. B opens it, signs in/creates an account and claims the friend offer. Add eligible
   merchandise and apply the code at checkout. Verify amount and minimum spend.
3. Complete an authorized development test order. A gains exactly 200 points and
   one referral. Refresh repeatedly: no duplicate awards. The overall account
   balance refreshes on page reload after referral actions.
4. Reject A using their own code, another buyer using B's offer, a previous
   purchaser and a different store. No unauthorized discount should apply.
5. Repeat with new friends until a milestone unlocks. Claim it, add the selected
   variant and verify only the configured quantity is free; extra units stay paid.
   Retry returns the same code. After paid consumption, no second gift is issued.
6. Partially refund B's order, then refund the remainder. Verify proportional
   reversal once per cumulative amount and loss of progress on full refund. An
   unused gift above the new threshold becomes unavailable and is deactivated on
   the maintenance pass. If points were spent, verify debt and earning recovery.
7. Cancel another paid referral order. Check reversal, then pause referrals and
   confirm new offers/claims are blocked.

## Automated verification and limits

Run `npm test` in `rewards`. Integration tests require an isolated MongoDB replica
set and the existing local admin acceptance server. CI includes signed HTTP,
lifecycle, configuration, Function and external-discount race tests. GraphQL and
Function inputs were schema-validated and the local Shopify build passed.
Automated Shopify orders/discounts use mocked responses; the checklist above still
needs actual development-store validation after an approved rollout. Four existing
historical-event replay checks skip on an empty database.

Eligibility is customer-ID-based, not a device/payment fraud system. Multiple
accounts owned by one person need merchant abuse review. Cross-system cancellation
cannot retrieve a shipped free gift. No Loop subscription writes were enabled.
