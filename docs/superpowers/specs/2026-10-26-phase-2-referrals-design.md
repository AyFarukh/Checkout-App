# Phase 2: Referrals — draft for policy selection

Status: live implementation prepared, activation remains off. First referral earns
200 points total. Configuration and selected product mappings are preserved.
Implementation policies, rollout order and test checklist: rewards/REFERRALS.md.
No deployment or merge performed.

## User-supplied referral flow

Reference: referral screen supplied on 2026-10-26. Use its warm white background,
brown offer card, green actions, rounded white cards and cream share controls
within the existing storefront rewards surface. The Shopify customer account
extension should expose the same flow using its supported native components.

- Offer: “Give $10, Get 200 pts”. Friend receives $10 off their first order;
  referrer earns 200 points when that friend buys.
- Unique referral link and code, a copy action, and Text / Email / More sharing.
  Sharing opens user-controlled compose/share actions; it does not send messages
  from the backend. The sample name/code and 3/5 progress are illustrative, not
  hardcoded customer data.
- Real referral progress and the next reward, with locked/unlocked milestone rows:
  1 referral — 200 bonus points; 3 — Free Shampoo Bar; 5 — Free Full-Size Mist;
  10 — Free Four Mist Bundle.
- Main “Invite friends now” action opens the available share flow.

The user confirmed the first-referral row represents the same 200-point
per-referral award, not an additional bonus. The user requested product selection
in admin and controls to add more milestones; they will map products later. Do not infer inventory from display names or issue a generic unrestricted
100% discount. Existing point-cost redemptions require at least one point, so free
milestone entitlements need their own claim path rather than fake point balances.

Proposed qualification: immediate on a verified first paid order, reflecting
“when they buy”; the original question about any holding period remains open.
Award each milestone once per referrer per store, backed by a unique entitlement,
and derive progress from qualified referrals. Refund settlement, minimum qualifying
spend, stacking, and expired/claimed milestone behavior need explicit policy before
launch. Native implementation remains recommended; no external provider is needed.

The existing program has an inactive `REFERRAL` earning rule with a placeholder
500-point value. `ensureDefaultRewardsProgram` explicitly disables unsupported
rules, including referrals, and no referral attribution or qualification model
exists. The placeholder is not an approved business policy. The earlier chat
names referrals, additional earning methods and Loop rewards. The new visual
reference establishes the $10 / 200-point offer and milestone rewards above.

## Proposed first delivery

Build native referrals into this Node/Express/Mongoose rewards backend, then
additional earning methods, then Loop rewards. Reuse customer authentication,
the immutable points ledger, webhook queue and customer balance mirror.

Alternative: integrate a referral provider. This would outsource attribution and
fraud controls but requires selecting a provider and supplying its webhook/API
contract. Native referrals fit the current stack without an external dependency;
this is the implementer's recommendation, not an already approved provider choice.

## Required business decisions

- Friend benefit is $10 off the first order; minimum purchase and exclusions remain open.
- Referrer benefit is 200 points per successful referral; first-order qualification and any holding period remain open.
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
