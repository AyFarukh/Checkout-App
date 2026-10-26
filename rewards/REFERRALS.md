# Referral configuration

Open **Referrals** in the embedded Rewards admin after deploying this branch.
This page currently configures the program as a draft. It does not activate
referral links, issue discounts, qualify orders, or award referral points yet.

The default offer is 10 off a friend's first order, in the store's currency, and
200 points per successful referral. The first milestone describes those same
200 points; it does not add a second 200-point bonus.

Default product milestones match the reference:

| Successful referrals | Gift |
| --- | --- |
| 3 | Free Shampoo Bar |
| 5 | Free Full-Size Mist |
| 10 | Free Four Mist Bundle |

Product mappings are optional for drafts. Use **Select product** inside Shopify
Admin, choose the product, and choose one of its variants if more than one is
returned. For a bundle, select a bundle product. Choose the gift quantity (1–10).
**Clear product** returns the gift to an unmapped draft. A product selection with
multiple variants requires a variant or clearing the selection before saving.

Use **Add product milestone** or **Add bonus-points milestone** to add more tiers.
Edit the referral threshold and display title, or remove a milestone. Thresholds
must be unique; they sort automatically after saving. Up to 50 milestones can be
configured. The first-referral row stays fixed at one referral to prevent double
awarding, and its display tracks the configured per-referral amount. Extra point
milestones are separate bonuses at higher thresholds.

The preview follows the reference's brown, green, white and cream treatment.
Its adjustable referral count is sample data only. Copy and share actions and
personal referral links remain part of the customer-facing implementation.

Changes are scoped to the authenticated store, checked against its live Shopify
product variants, revision-protected against concurrent editors, and recorded
atomically in the admin audit log. Product titles are read from Shopify rather
than trusted from the browser. An unconfigured draft can be saved without a
Shopify product lookup. No schema migration or production data reset is required.

Deployment was not performed. Token-hardening key setup from
[TOKEN-HARDENING.md](TOKEN-HARDENING.md) is still required before backend rollout.

Next phase: use this versioned configuration to implement attribution, verified
first-order discounts, idempotent referral awards, milestone entitlements and
refund settlement, then enable the customer sharing flow. Order and refund policy
must be pinned by tests before enabling monetary benefits.
