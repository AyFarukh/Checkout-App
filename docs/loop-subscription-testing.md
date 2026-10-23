# FreeTheRoots subscription dashboard: testing and remaining release gates

The backend changes are on PR #21 (`feature/loop-action-adapter-v1`), and the theme changes are on PR #8 (`feature/loop-all-actions-confirmation-v1`). Neither PR should be merged or deployed as a finished production integration yet.

Eleven documented actions have executable implementations: reschedule, skip, delay, order now, frequency, pause, cancel, edit products, shipping address, discount, and subscription notes. Product editing supports quantity, add, swap and remove; Loop calculates pricing. Removing the last recurring line and editing bundled subscriptions are blocked. Use Loop's bundle editor for bundle changes.

**Gift an order is blocked with `GIFT_API_UNAVAILABLE`.** Loop documents its Gift instead of skip feature, including immediate payment and temporary shipping changes, but its published API index provides no gift-order endpoint contract. Do not simulate it by changing a permanent shipping address, placing an order, and trying to restore the address. Ask Loop for its supported endpoint, payload, authentication, eligibility, response and order verification contract. The gift tests currently prove that no fabricated write or false success occurs; they do not count as a successful gifting test.

## 1. Get both branches

Keep the repositories next to one another. In each repository, fetch its branch and switch to it; do not merge either PR.

```bash
# In Checkout-App
git fetch origin feature/loop-action-adapter-v1
git switch feature/loop-action-adapter-v1
git pull --ff-only origin feature/loop-action-adapter-v1

# In Freetheroot-Shopify-Theme-Dev
git fetch origin feature/loop-all-actions-confirmation-v1
git switch feature/loop-all-actions-confirmation-v1
git pull --ff-only origin feature/loop-all-actions-confirmation-v1
```

Use Node 22.12 or newer and npm. From `Checkout-App/rewards`:

```bash
npm ci
npx playwright install chromium
```

The default browser suite uses a checksum-verified copy of the real dashboard JavaScript and CSS bundled with this backend branch. Its source is theme commit `a34362971aaa666a5d5f5eacd717076db5355565`, recorded in `rewards/test/fixtures/subscription-theme/manifest.json`. You do not need a sibling theme checkout or a particular folder name for this run.

Clear any previously configured path before running the bundled tests:

```bash
unset FTR_THEME_ASSET
```

On PowerShell use `Remove-Item Env:FTR_THEME_ASSET -ErrorAction SilentlyContinue`.

To test your own theme checkout instead, set `FTR_THEME_ASSET` to its **actual existing absolute path**, with the dashboard CSS beside it. First pull `feature/loop-all-actions-confirmation-v1` there. An explicit missing or outdated asset now stops the suite once at startup, with an actionable error. The harness never silently falls back to the snapshot when an explicit checkout is invalid. The default snapshot proves that pinned theme version, not uncommitted changes in another directory.

## 2. Run the offline tests

These tests do **not** contact Shopify or Loop and do not use your production database. Integration and full-stack browser tests start a temporary Mongo process and an HTTP Loop fixture on loopback. Mongo's first run downloads a platform-specific binary.

```bash
npm test
npm run test:subscriptions:integration
npm run test:subscriptions:e2e
```

Or run all three in order:

```bash
npm run test:subscriptions:all
```

Expected: no failures. Two older rewards webhook unit tests skip without `MONGODB_URI`; they are outside the subscription suite. Subscription integration tests require no database environment variable and must not skip. Browser tests include the actual theme -> signed proxy emulator -> Express -> Mongo -> HTTP provider -> read-back path, plus UI recovery tests. The emulator does not prove that the real store's Shopify proxy configuration works.

If Chromium lacks Linux system packages, use `npx playwright install --with-deps chromium`. An already installed compatible Chromium can be selected with `FTR_CHROMIUM_EXECUTABLE`. `FTR_CHROMIUM_SINGLE_PROCESS=true` is a workaround for restricted CI that blocks Unix sockets; it is unnecessary on a normal laptop. No production setting depends on these browser test variables.

## 3. Configure local real-Loop tests

The existing `fly.toml` still names `freetheroots-rewards-system` and is unchanged. **Do not deploy these branches, change its secrets, set its mutation flag, or run this harness inside the production Fly machine.** The live runner runs on your computer, uses a dedicated test database, and contacts Loop only for the authorized subscription `42347174`.

From `Checkout-App/rewards`:

```bash
cp .env.loop-test.example .env.loop-test
cp test/fixtures/loop-live-actions.example.json test/fixtures/loop-live-actions.json
npm run test:subscriptions:db
```

Keep that terminal open. The local Mongo database uses port 27027 and preserves its ledger in `.loop-test-db` across restarts. Open a second terminal in the same `rewards` directory. Edit `.env.loop-test` locally:

- `LOOP_TEST_SHOP`: the installed `*.myshopify.com` domain.
- `LOOP_TEST_CUSTOMER_ID`: the Shopify customer who owns `42347174`.
- `SHOPIFY_API_SECRET`: a private local signing key for the CLI harness. A separate Shopify staging app must instead use its actual app secret for real Shopify proxy requests.
- `LOOP_ADMIN_REQUEST_HEADERS_JSON`: `{"X-Loop-Token":"YOUR_REAL_TOKEN"}`, configured locally only. The token must have the required read/write subscription permissions and product read access.
- Keep `NODE_ENV=test`, the dedicated `freetheroot_loop_test` DB name, and `LOOP_BILLING_TIMEZONE=America/New_York`.
- Initially keep `LOOP_TEST_MUTATIONS_ENABLED=false` and `LOOP_SUBSCRIPTION_MUTATIONS_ENABLED=false`.

The `.env`, real fixture, local request state and database directories are ignored by git. Never paste their contents into a PR or chat. Do not use the production Rewards database for this harness.

Initialize the **local harness's installation marker** and inspect the authorized subscription:

```bash
npm run test:subscriptions:live -- --init-local-test
npm run test:subscriptions:live -- --inspect
npm run test:subscriptions:live -- --list
```

The marker supplies an installation record only in the local test database; it neither installs an app in Shopify nor validates a real Shopify session. `--inspect` reads Loop and prints subscription status, scheduling and product line IDs without credentials or shipping details. Keep the original values privately so you can restore reversible changes.

Replace every placeholder in `test/fixtures/loop-live-actions.json` before testing its action. Use a real deliverable test address, valid subscription discount, existing Loop line ID, and a different quantity. The reschedule date must be a real date at least 24 hours ahead, at most 366 days ahead. The server preserves the current merchant-local billing time through DST. Anchored schedules and dunning subscriptions are blocked where the action is unsafe.

## 4. Preview, execute, verify, then replay each action

Start with a reversible note update:

```bash
npm run test:subscriptions:live -- --action order-note --preview
```

Preview validates ownership and details and stores a short-lived receipt. It makes no Loop changes. When ready to perform the authorized test action, change these **local file values only**:

```dotenv
LOOP_TEST_MUTATIONS_ENABLED=true
LOOP_LIVE_TEST_ACK=42347174
```

Run within five minutes of the preview:

```bash
npm run test:subscriptions:live -- --action order-note --execute
npm run test:subscriptions:live -- --action order-note --status
npm run test:subscriptions:live -- --action order-note --execute
```

Success requires `applied:true` and `verified:true`. The last command must return `replayed:true` using the same request key, with no additional write. The request key and receipt remain in `.loop-live-state.json`; **do not delete it to retry an uncertain request**.

For each action, replace `order-note` in those commands. Run actions individually in this order, inspect the subscription after each, and restore reversible values before proceeding:

| Action | Live test and evidence |
|---|---|
| `order-note` | Update subscription-level notes. Read-back must match exactly. This is the contract note inherited by subsequent orders; it does not edit a previously placed order. |
| `edit-address` | Change the test address; all supplied fields must match read-back. Restore the original address before any order placement. |
| `edit-products` | Start with quantity. For add use `{ "operation":"add", "variantShopifyId":"ID", "quantity":1 }`; swap also includes `lineId`; remove uses `{ "operation":"remove", "lineId":"ID" }`. Variants must appear in the merchant's subscription catalog. Read-back must prove the change. |
| `discount` | Use an eligible subscription code. Read-back must show the code without a rejection reason. |
| `frequency` | Change interval/count; both billing and delivery policies must match. |
| `reschedule` | Select a future date; the returned billing epoch must match read-back. |
| `delay` | Delay 7, 14 or 30 merchant calendar days; verify exact resulting epoch. |
| `skip` | Verify the original scheduled order's `SKIPPED` status and a later next order date. If Loop's schedule response omits skipped rows, status remains unknown; capture a redacted response shape for adapter adjustment. |
| `order-now` | Places a real order and may charge the saved payment method. Verify a newly successful order with a Shopify order ID in Loop history. Never create another key to retry an uncertain charge. |
| `pause` | Verify `PAUSED`. Resume manually in Loop before testing cancellation. |
| `cancel` | Run last, after reviewing the test subscription. Verify `CANCELLED`/`CANCELED`. No automatic reactivation or refund is performed. |
| `gift` | Expected blocker `GIFT_API_UNAVAILABLE`; a successful gift test needs Loop's API contract first. |

To test a second **intentional** change after a verified completion or definite rejection, update that action's fixture, then generate a fresh preview with `--new`:

```bash
npm run test:subscriptions:live -- --action order-note --new --preview
npm run test:subscriptions:live -- --action order-note --execute
```

An unknown outcome must first be resolved with `--status`. That command reads stored context and Loop; it never repeats the write. An `in_flight` attempt is left untouched while its worker may still be active, then becomes eligible for read-only reconciliation after two minutes. A crashed `reserved` operation remains locked for operator review; there is no automatic lease expiry that could duplicate a charge. Never delete a database attempt or unlock it without verifying the provider's actual state and confirming the old worker cannot dispatch.

## 5. Real Shopify browser acceptance

The offline browser suite and live CLI test separate different boundaries. Neither by itself proves the real Shopify login/proxy path. For that final check, use a separate staging Shopify app, an unpublished development theme, a test backend/tunnel with these branches, and the authorized customer login. Point that staging app's proxy to the test backend; leave the production app proxy and Fly deployment unchanged.

On that development theme, perform every supported action through Review change -> Confirm change. Check the refreshed state, repeat a request using the same key, test changed inputs, expired previews, another customer, and loss of connectivity after confirmation. Refreshing an unknown result must offer Check status and must not silently generate another write. Test mobile dialogs, keyboard focus and Escape. Use the CLI status command and local ledger to reconcile uncertain outcomes. Record redacted results for each action, including its request key and before/after state, never tokens or customer addresses.

## Verification performed on 2026-10-23

- `npm test`: 55 passed, 2 existing rewards webhook tests skipped without `MONGODB_URI`, zero failures.
- Subscription integration: 33 passed, zero skipped or failures, using real Mongo and the local HTTP provider.
- Browser E2E: 33 passed, including the full stack and mobile form. This environment used a locally available Chromium headless shell with the documented single-process CI workaround.
- No real Loop mutations, real Shopify sessions, production deployments or PR merges were performed.

## Path-error regression fix

The uploaded ENOENT failures came from a nonexistent FTR_THEME_ASSET path. Four new unit tests verify the default bundled assets, missing-path diagnostics, stale-theme detection and explicit paths containing spaces with adjacent CSS. Browser tests resolve assets before starting their servers or browsers.

## Current release status

Automated fixture tests verify application behavior and HTTP request contracts derived from Loop documentation. Real Loop schema, token scopes, store preferences, billing effects, timing, shipping eligibility, actual Shopify login/proxy behavior and the gift endpoint still require the controlled checks above. Do not treat an HTTP 200 alone, a fixture pass, or the gift rejection test as evidence that all 12 live actions work.

Production mutation enablement intentionally remains unavailable in this implementation: `NODE_ENV=production` always blocks mutation execution, including if the legacy flag is enabled. A separate reviewed change and your approval are required before enabling production behavior.

## API references

- [Loop API index](https://developer.loopwork.co/llms.txt)
- [Reschedule](https://developer.loopwork.co/reference/reschedule-subscription), [skip](https://developer.loopwork.co/reference/skip-next-order), [place order](https://developer.loopwork.co/reference/place-order)
- [Frequency](https://developer.loopwork.co/reference/update-frequency), [pause](https://developer.loopwork.co/reference/pause-subscription), [cancel](https://developer.loopwork.co/reference/cancel-subscription)
- [Add line](https://developer.loopwork.co/reference/add-line), [swap](https://developer.loopwork.co/reference/swap-line), [remove](https://developer.loopwork.co/reference/remove-line), [quantity](https://developer.loopwork.co/reference/edit-line)
- [Address](https://developer.loopwork.co/reference/update-address-on-subscription), [discount](https://developer.loopwork.co/reference/add-discount), [subscription note](https://developer.loopwork.co/reference/update-note)
- [Gift instead of skip](https://help.loopwork.co/en/articles/12714027-gift-instead-of-skip)
