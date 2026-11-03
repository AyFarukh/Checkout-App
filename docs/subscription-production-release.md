# Supported subscription actions: production release

Scope approved by the operator on 2026-11-03: launch without Gift. Gift stays visibly disabled, cannot open a form, and backend requests return GIFT_API_UNAVAILABLE without creating an attempt or sending a provider mutation.

## Code and configuration

Use the existing `freetheroots-rewards-system` Fly app, root Dockerfile and fly.toml. Do not create another app. Backend PR #21 targets feature/rewards-admin-v1; theme PR #8 targets feature/custom-subscription-dashboard-v2. Main is an older checkout baseline and is not the release checkout for this runbook. Do not copy the whole theme onto the live store or deploy Shopify Functions/extensions for this backend/theme change.

Production writes require BOTH NODE_ENV=production and LOOP_PRODUCTION_MUTATIONS_ENABLED=true, plus a valid exact LOOP_ADMIN_SHOP matching the merchant of the configured Loop token. No test-shop fallback authorizes production writes. The example configuration defaults false; existing test/legacy flags do not enable production writes. In development/test, the original configured customer and subscription 42347174 allowlist still applies.

Every action verifies the signed customer, active installation, customer subscription membership and exact subscription ownership. Preview receipts bind the customer, merchant, subscription, payload, request key and current state. Durable Mongo locks and replay records remain in the existing production database. Disabling writes preserves status verification of existing attempts. Never clear the action collection or create a new request key to bypass an unknown outcome.

## Validation recorded for this revision

- 109 unit passes in the general command. Its two Mongo-dependent skips were subsequently run against disposable Mongo: all three webhook unit tests passed, including those two previously skipped cases (111 distinct unit cases verified overall).
- 86 HTTP/Mongo integration passes, including all 11 supported actions in production mode, signed-route body spoofing, exact ownership, inactive installations, concurrent keys, disabled writes with pending verification, and direct Gift rejection.
- 67 browser passes using real Express routes, Mongo and a controlled HTTP provider. Includes all 11 supported actions and one-time additions in both test and production modes, disabled Gift, read-only behavior and mobile layout/keyboard regressions.
- 24 separate admin/webhook/token/uninstall/referral acceptance passes with a disposable Mongo replica set; no skips in that acceptance run.
- Companion theme JS passed the Shopify validator using bundled schemas after online docs refresh was unavailable.

These are controlled-provider tests, not deployment acceptance. Operator live evidence for one-time addition: request 64cd025f-0fba-4512-8790-a60f66ef9643 returned applied/verified, and execute replay + status preserved the successful result. Inspect showed one added variant 56487377174900 quantity 1, original variant unchanged, ACTIVE state, MONTH/3 and unchanged billing epoch 1800940212. No extra real order was placed during this revision. Preserve test subscription 42347174 ACTIVE.

## Deployment from the authorized operator's Mac

The connected workspace has repository access but no authenticated Fly CLI, Fly token, authenticated Shopify theme CLI session, confirmed live theme ID or confirmed canonical merchant myshopify.com domain. Never paste credentials into chat. The operator can perform the following using existing local logins. Replace the clearly marked domain placeholder with the merchant domain bound to the Loop token.

From the backend repository root, after PR #21 is merged:

```bash
git fetch origin
git switch feature/rewards-admin-v1
git pull --ff-only origin feature/rewards-admin-v1
fly auth whoami
fly secrets list --app freetheroots-rewards-system
```

Verify that existing database, Shopify signing/encryption, Loop header and billing timezone settings remain present. Do not print their values or replace the production database with the local test database. Billing timezone must match the merchant's configured timezone.

Stage a read-only release and deploy the tested backend (the placeholder below is a nonsecret merchant identifier):

```bash
fly secrets set LOOP_ADMIN_SHOP=YOUR_STORE.myshopify.com LOOP_PRODUCTION_MUTATIONS_ENABLED=false --stage --app freetheroots-rewards-system
fly deploy --remote-only --config fly.toml --app freetheroots-rewards-system
fly status --app freetheroots-rewards-system
curl --fail --silent --show-error https://freetheroots-rewards-system.fly.dev/health
```

From the theme repository after PR #8 is merged, identify and back up the current live dashboard files first:

```bash
git fetch origin
git switch feature/custom-subscription-dashboard-v2
git pull --ff-only origin feature/custom-subscription-dashboard-v2
shopify theme list --store YOUR_STORE.myshopify.com
```

After confirming the live target, push only the four portal files below to that live theme. Preserve every unrelated template, merchant setting, header and footer. The subscription page must already exist; if it does not, create/configure the page before linking to it.

```bash
shopify theme push --store YOUR_STORE.myshopify.com --live --allow-live --only assets/ftr-subscription-dashboard.js --only assets/ftr-subscription-dashboard.css --only sections/ftr-subscription-dashboard.liquid --only templates/page.ftr-subscriptions.json
```

Open /pages/subscription?view=ftr-subscriptions without preview_theme_id while signed in. Verify correct customer subscriptions, switching cards, account return link, schedule/history, mobile display and disabled Gift. Check another customer cannot see the authorized customer's subscription. Keep writes off while checking these reads.

Then enable the already-approved supported production actions:

```bash
fly secrets set LOOP_PRODUCTION_MUTATIONS_ENABLED=true --app freetheroots-rewards-system
```

Refresh the signed-in dashboard. Supported actions become available only for customer-owned subscriptions. Validate an order-note preview on authorized subscription 42347174, explicitly confirm that harmless note change, and check status/replay. Verify one-time additions are marked next-order-only; do not place another order or cancel the subscription merely to smoke-test production. Inspect the upcoming test order before its billing date because the live test addition remains present. See docs/subscription-dashboard-quick-test.md for the full browser checklist.

## Rollback

Disable writes immediately if verification fails:

```bash
fly secrets set LOOP_PRODUCTION_MUTATIONS_ENABLED=false --app freetheroots-rewards-system
```

This keeps detail/order reads and pending status verification available. Restore only the backed-up portal files if the layout must be rolled back. Keep Mongo attempts intact and reconcile unknown outcomes with their original keys; rolling back code does not undo provider mutations.

Command references: https://fly.io/docs/flyctl/secrets-set/ , https://fly.io/docs/flyctl/deploy/ , https://shopify.dev/docs/api/shopify-cli/theme/theme-push .
