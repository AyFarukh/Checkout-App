# Phase 2: Referrals — draft for policy selection

Status: discovery complete; reward policy pending. No referral awards activated.

The existing program has an inactive `REFERRAL` earning rule with a placeholder
500-point value. `ensureDefaultRewardsProgram` explicitly disables unsupported
rules, including referrals, and no referral attribution or qualification model
exists. The placeholder is not an approved business policy. The earlier chat
names referrals, additional earning methods and Loop rewards but supplies no
amounts, eligibility details, integration provider, or settlement policy.

## Proposed first delivery

Build native referrals into this Node/Express/Mongoose rewards backend, then
additional earning methods, then Loop rewards. Reuse customer authentication,
the immutable points ledger, webhook queue and customer balance mirror.

Alternative: integrate a referral provider. This would outsource attribution and
fraud controls but requires selecting a provider and supplying its webhook/API
contract. Native referrals fit the current stack without an external dependency;
this is the implementer's recommendation, not an already approved provider choice.

## Required business decisions

- Friend benefit: points or checkout discount, amount, minimum purchase, exclusions.
- Referrer benefit: points/amount, qualifying first order, and any holding period.
- Refund handling: proportional reversal or cancellation of the referral award;
  define what happens if the referrer has already spent the points.
- Attribution window and whether a friend with any previous order is excluded.

## Proposed security and consistency contract

Every link and claim belongs to a signed shop/customer identity. Use random
unguessable referral codes, not customer IDs or emails. Permit one referrer per
friend per store, reject self-referrals, and do not expose another customer's
identity. Treat browser referral input as a claim only, never proof of a purchase.
Qualify through verified Shopify order data and the existing durable webhook
processing, with transactionally unique awards per shop/claim/order/beneficiary.
Retries and out-of-order deliveries must not duplicate points. Refund reversals
must reference the original ledger entry and never exceed its original award.

Keep the program disabled until policy is configured and tested. Snapshot the
policy on each qualified referral so later admin edits do not change past awards.
The default seeding code must stop forcibly disabling referrals only after the
feature is ready; birthday/review/bonus rules remain gated by their own readiness.

## Delivery sequence

1. Approve the economic and qualification policy, then finalize data/API contracts.
2. Implement configuration, referral identity/claim storage and authenticated APIs.
3. Implement order qualification, idempotent awards and refund settlement.
4. Add referral UI to existing customer surfaces, admin reporting and audit trails.
5. Run tenant isolation, spoofing, repeated delivery, concurrent claims, existing
   customer, refund, spent-points and configuration-change tests. Validate on a
   development store before a separately authorized rollout.

Loop subscription rewards follow a separate design because subscription statuses,
renewal billing events, cancellation and refund mapping require the chosen Loop
event contract. Existing read-only subscription APIs are not proof of eligibility
to issue points. No emails, messages, discounts, paid orders, deployment or merge
are authorized by this draft alone.
