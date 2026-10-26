# Shopify reinstall authentication recovery

## Finding

The exact reported message is emitted only by `shopify-token.service.js` when
`/admin/oauth/access_token` fails without an OAuth error description. During
customer redemption the only caller of that endpoint is offline-token refresh:
`reserveRedemption` → `createRedemptionDiscount` →
`validateShopifyAdminConfiguration` → `storedOfflineTokenForShop` → `refresh`.
This failure occurs before discount creation, rather than in the GraphQL mutation.

The previous admin bootstrap first read/refreshed the existing record. A rejected
refresh aborted bootstrap before the fresh verified App Bridge ID token could be
exchanged. An apparently unexpired revoked token also bypassed exchange entirely.
These recovery failures are reproduced by the unit tests. Uninstall revocation is
consistent with the report, but the original live refresh rejection cannot be
attributed conclusively without server diagnostics: invalid/replaced refresh tokens,
changed app credentials, or a token belonging to another app can produce similar
symptoms. A genuinely new shop with no stored record would return the missing-token
error, not attempt refresh. Confirm the signed destination and failing shop match.

## Minimal change

- Authenticated admin bootstrap always exchanges its fresh verified ID token and
  replaces the token pair for the signed shop. The customer JWT is never exchanged
  for an Admin token. No OAuth authorization-code callback is implemented here;
  `/api/auth` in the app configuration is not a backend recovery endpoint.
- Rejected refresh (400/401), expired/missing refresh credentials, and Admin
  GraphQL 401 report `SHOPIFY_REAUTH_REQUIRED` with HTTP 409. Transient refresh
  failures remain transient. Mutations are not automatically replayed.
- Shopify token response error text is not copied into logs or API errors.
- The legacy `SHOPIFY_ADMIN_ACCESS_TOKEN` fallback requires a matching
  `SHOPIFY_ADMIN_SHOP`; prefer persisted tokens or `SHOPIFY_OFFLINE_TOKENS_JSON`.

## Reauthorize after an approved rollout

1. Verify privately that the running service's `SHOPIFY_API_KEY` and
   `SHOPIFY_API_SECRET` belong to the **same app installed on the affected store**.
   Never paste secret values into logs, tickets, or this document. This repository
   has several app configurations with different client IDs; the Rewards Fly URL
   and discount scopes are in `shopify.app.checkout-upsell-app.toml`.
2. Open that app from the affected development store's Shopify admin. Confirm
   `POST /api/shopify-token/exchange` succeeds with `ok: true`, the correct shop,
   and `status: authorized`. Do not copy its Authorization header. A 401 from
   adminAuth indicates ID-token/credential mismatch or expiry; an exchange failure
   after successful adminAuth needs installation/app-credential investigation.
3. Check only metadata in `ShopifyOfflineToken`: exactly one record for this shop,
   fresh `acquiredAt`, future access/refresh expiry, and granted discount scopes.
   Do not print access/refresh token fields. No manual database deletion is needed.
4. Wait for pending reward synchronization to resume. Confirm the Rewards Function
   is installed for this app and shop, and the selected reward is `SYNCED` at its
   current version. Old function IDs can differ between installations; the backend
   validates the configured ID and discovers by title per shop.
5. With an authorized test customer, redeem once with a new request ID, apply the
   code at checkout, and verify the amount and customer restriction. Check balance
   and reserved points. Failed discount creation attempts release the reservation;
   inspect the original attempt before retrying. Use a new request ID because an
   existing released redemption is returned as a duplicate.
6. Only with separately authorized test-order execution, verify `RESERVED` →
   `COMMITTED`, refund/cancellation behavior, and unused reservation expiry. Check
   that another store cannot read these rewards or use this store's credentials.

## Validation and limits

Run `npm ci --ignore-scripts`, `node --test test/shopify-token.unit.test.js`, and
`npm test` from `rewards`. Tests stub MongoDB/network boundaries and exercise the
real token and Admin client code; they use fabricated credentials exclusively.
MongoDB acceptance and live Shopify validation require the corresponding test
environment and remain separate from these unit tests.

No `app/uninstalled` subscription or handler exists in this branch. The patch
repairs reauthorization without depending on webhook arrival, including missed or
delayed deliveries. Revoked credentials remain stored until the next exchange;
background work can continue failing until the merchant reopens the app. Future
uninstall cleanup must verify HMAC, isolate the shop, and protect a newer reinstall
from delayed uninstall events. This patch does not add that separate lifecycle
mechanism or change existing reward/customer data retention.

Tokens are currently stored as plain MongoDB string fields. Application-level
encryption is not introduced in this minimal fix; database access restrictions and
encryption at rest must be verified by the operator. Multi-process refresh/exchange
serialization is also outside this patch.

No deployment, merge, live token exchange, or paid order is part of this change.

References:
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
