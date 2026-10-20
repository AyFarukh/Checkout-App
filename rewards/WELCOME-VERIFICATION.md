# Welcome verification integration on Rewards Fly app

This feature branch is based on `feature/rewards-admin-v1`, preserving its Dockerfile and `fly.toml` (Fly app: `freetheroots-rewards-system`). **Do not merge/deploy until tested.**

## Required configuration
- Configure Shopify app proxy: prefix `apps`, subpath `ftr-welcome`, destination `https://freetheroots-rewards-system.fly.dev/apps/ftr-welcome`. Verify actual Fly domain first.
- Set Fly secrets: `SHOPIFY_API_SECRET` (or `SHOPIFY_API_SECRET_KEY`), `SHOPIFY_ADMIN_TOKEN` (offline Admin API token), `SHOPIFY_SHOP_DOMAIN` (myshopify domain). Do not commit secrets.
- Request Shopify `read_customers` scope and protected customer data access. Reauthorize app after scope changes.
- Configure theme popup verification URL as storefront `/apps/ftr-welcome`; code `WELCOME25`. URL must be supported by theme setting.
- Enforce first-order eligibility for the shared code **at checkout**. The popup alone is not a discount security boundary.

## Important production blockers
- App proxy HMAC verification needs integration testing against a real Shopify proxy request.
- The endpoint exposes eligibility for an arbitrary email; implement email ownership verification and durable per-IP/email abuse controls before enabling in production.
- Confirm the correct offline token storage mechanism in the rewards service before using `SHOPIFY_ADMIN_TOKEN`; the existing rewards app may use MongoDB tokens.
- Verify Admin GraphQL customer query and order count response against store permissions.
- No deployment or live Shopify configuration has been performed.

This route is isolated from the existing Rewards API and does not modify customer/order data.
