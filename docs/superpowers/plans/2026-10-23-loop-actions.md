# Loop subscription actions implementation plan

Goal: complete documented subscription actions, gated to the authorized test subscription, and provide executable offline, Mongo integration, browser and live test commands.
Architecture: existing signed app proxy -> scoped customer ownership -> signed preview with state hash -> durable Mongo operation reservation and per-subscription lock -> one provider write -> bounded read-back -> stored verified result. Ambiguous outcomes retain locks and never repeat writes automatically.
Tech stack: existing Node/Express/Mongoose, Node test runner, Playwright for theme E2E.

Constraints: preserve Fly production configuration; no merge, deploy, production enablement, credentials in responses, browser-controlled identities or pricing.
Ruling: gift has no published API contract in Loop's current llms.txt; return explicit GIFT_API_UNAVAILABLE and document vendor dependency. Never simulate gifting by changing the permanent shipping address.
Ruling: product editing uses the documented add, swap, remove and quantity endpoints, one provider operation per request; merchant catalog variants only, no customer-defined pricing.

- [x] 1. Action validation, documented adapters, timezone conversion and post-action verification, with failing behavior tests first.
- [x] 2. Durable idempotency, subscription serialization, state-bound preview and service execution; Mongo races, restart, unknown-outcome tests.
- [x] 3. Signed proxy and legacy portal routes through the unified executor; auth and fail-closed tests.
- [x] 4. Theme forms, single confirmation, stable request keys, ambiguous outcome handling, keyboard behavior and browser tests.
- [x] 5. Local/live runners, non-secret examples, exact testing runbook, review and PR updates without merging.

Review focus: duplicate requests with different keys; crash after dispatch; stale preview; invalid or mismatched shop/customer; success HTTP with failure JSON; DST and leap dates; billing/payment side effects and irreversible cancellation; shared legacy routes.

Verification (2026-10-23): 51 unit tests passed, 2 existing rewards webhook tests skipped without MONGODB_URI; 33 genuine Mongo/HTTP integration tests passed; 33 browser tests passed (including full stack provider fixture and mobile product dialog). No real Shopify/Loop tests ran.

Review rulings and fixes: the required independent review identified crashed in-flight reconciliation, operation-specific product retry fields, and terminal rejection recovery. All were fixed with regression coverage. Recent in-flight attempts remain locked for two minutes; stale ones allow read-only reconciliation. No replay dispatch is allowed. Gift remains an explicit unresolved vendor contract. No minor findings were deferred.
