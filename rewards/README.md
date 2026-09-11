# FreeTheRoot Rewards Admin V1

This directory contains the new rewards system. It is intentionally isolated from the existing checkout extension so rewards development cannot change checkout behavior by accident.

## Safety boundary

- Do not modify files under `extensions/checkout-upsell/` as part of Rewards V1.
- Do not deploy rewards work to the production Shopify app until it has been reviewed and tested on a development store.
- MongoDB is the rewards source of truth. Shopify customer metafields may later mirror display-only balance/tier data.
- All point changes must be immutable ledger transactions; never directly overwrite a customer's balance without a corresponding transaction.
- Shopify webhook processing must be idempotent before automatic earning is enabled.

## Planned admin modules

1. Dashboard
2. Customers
3. Points activity / ledger
4. Earn rules
5. Rewards
6. Settings

## Planned collections

- `reward_customers`
- `points_transactions`
- `earning_rules`
- `rewards`
- `reward_settings`

## Rollout

Phase 1 establishes the MongoDB connection, data models, ledger service, and admin UI with manual point adjustments. Automatic order earning/refund handling will only be enabled after webhook and idempotency tests pass.
