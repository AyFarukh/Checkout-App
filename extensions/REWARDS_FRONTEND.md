# FreeTheRoots Rewards extensions

Customer-facing rewards surfaces are intentionally isolated from `checkout-upsell` and `smart-fbt-discount`.

- `rewards-account`: Shopify Customer Account full-page loyalty dashboard.
- `rewards-storefront`: Theme App Extension containing a Rewards program app block and optional floating launcher.

The account extension uses a Shopify session token for every backend request. The backend verifies the token signature, audience, shop destination and Shopify Customer subject before returning tenant/customer data.
