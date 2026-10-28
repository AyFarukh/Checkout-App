# FreeTheRoots subscription dashboard: testing and remaining release gates

The backend changes are on PR #21 (`feature/loop-action-adapter-v1`), and the theme changes are on PR #8 (`feature/loop-all-actions-confirmation-v1`). Neither PR should be merged or deployed as a finished production integration yet.

Eleven documented actions have executable implementations: reschedule, skip, delay, order now, frequency, pause, cancel, edit products, shipping address, discount, and subscription notes. Product editing supports quantity, add, swap and remove; Loop calculates pricing. Removing the last recurring line and editing bundled subscriptions are blocked. Use Loop's bundle editor for bundle changes.

**Gift an order is blocked with `GIFT_API_UNAVAILABLE`.** Loop support confirmed on 2026-10-27 that no API is currently available to implement gifting an upcoming order in a custom portal. Do not simulate it by changing a permanent shipping address, placing an order, and trying to restore the address. Ask Loop for its supported endpoint, payload, authentication, eligibility, response and order verification contract. The gift tests currently prove that no fabricated write or false success occurs; they do not count as a successful gifting test.

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

- `npm test`: 69 passed, 2 existing rewards webhook tests skipped without `MONGODB_URI`, zero failures.
- Subscription integration: 61 passed, zero skipped or failures, using real Mongo and the local HTTP provider.
- Browser E2E: 33 passed, including the full stack and mobile form. This environment used a locally available Chromium headless shell with the documented single-process CI workaround.
- No real Loop mutations, real Shopify sessions, production deployments or PR merges were performed.

## Path-error regression fix

The uploaded ENOENT failures came from a nonexistent FTR_THEME_ASSET path. Four new unit tests verify the default bundled assets, missing-path diagnostics, stale-theme detection and explicit paths containing spaces with adjacent CSS. Browser tests resolve assets before starting their servers or browsers.

## Admin order-note verification fix

Loop Admin `GET /subscription/{id}` returns `data.orderNote`; its webhook entity uses `note`. The verifier and preview state hash now prefer `orderNote` when present, including explicit null values, and fall back to `note` only when the Admin field is absent. The HTTP fixture now returns the Admin shape. Regression tests cover exact note verification, state binding, replay and reconciliation of an existing unknown operation without another provider write.

If an order-note request is already unknown, pull this branch and run only `npm run test:subscriptions:live -- --action order-note --status`. Keep the local database and `.loop-live-state.json` intact. A matching changed `orderNote` can reconcile the original attempt; a missing or mismatched value stays unknown. Do not create another request to bypass that state. API reference: https://developer.loopwork.co/reference/read-subscription-details.

## Frequency no-op recovery

Frequency preview now returns `NO_CHANGE` before reservation or dispatch when billing and delivery already match the requested interval/count. For an older frequency attempt recorded as unknown, status checks compare its stored before-state and the current provider read. Only when both policies already matched before and still match now is the attempt resolved with `NO_CHANGE` and its lock released. This records no successful frequency change and sends no provider write. Missing/mismatched policies remain unknown; active in-flight workers keep their lock.

For this recovery, pull the branch and run `npm run test:subscriptions:live -- --action frequency --status` with the original local database and state file. The result has `code: "NO_CHANGE"`, `applied: false`, `verified: false`; the CLI exits nonzero because no applied change is claimed. The stored attempt is now resolved, so a subsequent deliberate change can use a new preview. Do not delete an unknown attempt to bypass a lock.

## Live Admin skip schedule selection

The observed Admin schedule uses `status: "UNPROCESSED"` and an ISO `billingDate`. Skip selection now supports that shape as well as the older `SCHEDULED`/`scheduledAt` shape. It sorts pending rows by their validated timestamp, requires an unambiguous numeric ID and an exact match to the subscription's next billing epoch, and refuses incomplete/mismatched evidence. Preview now performs this check before issuing a receipt. The shared HTTP fixture returns the live Admin shape, including in browser tests.

A skip still requires the original order ID to be read back as `SKIPPED` and a later next billing date. A date change alone or omission of the skipped row remains unknown and must not trigger another write. Regression tests cover missing evidence, ambiguous selection, replay and read-only recovery when the skipped row becomes visible.

For the pre-dispatch `NEXT_ORDER_UNAVAILABLE` attempt, pull the fix, create a new skip preview, then execute and check status. The failed attempt sent no skip write. If any later dispatched attempt is unknown, use only status; do not create a new key.

## Invalid address fixture recovery (local CLI only)

The live runner rejects the supplied `REPLACE`, `REPLACE_...`, `YOUR_...` and `ACTUAL_...` address placeholders with `LIVE_FIXTURE_PLACEHOLDERS` before database or provider access. Diagnostics list only field names, never values. Replace the entire address fixture with the actual original address, preserve optional values, and change only address2 for the intended test.

For an older unknown request that used this invalid template, do not delete its ledger or generate another key. Ensure the old live CLI command has exited and no other test worker is running. After at least two minutes, run:

```bash
npm run test:subscriptions:live -- --action edit-address --recover-invalid-address-fixture --confirm-worker-stopped
```

This operator-only command requires NODE_ENV=test and a dedicated local test database. It rechecks ownership and the provider's current address against all ten saved original address fields. It refuses missing original data, a changed address, a non-placeholder request, recent attempts, and in-flight workers. It sends no provider mutation. Only after those checks does it mark the local attempt resolved/rejected with `INVALID_TEST_FIXTURE_RECONCILED`, retain its history, release its lock and update the local state file. `applied` and `verified` remain false: this is an operator resolution of an invalid fixture, not proof of provider rejection or a successful address update. The HTTP dashboard cannot invoke this recovery command.

After recovery and correction of the fixture, use `--action edit-address --new --preview` for a deliberate valid test. Do not run recovery for other unknown outcomes. If the provider state differs, preserve the lock and investigate the provider result instead.

## Prepare an address test from the real baseline

To avoid hand-copying country/province codes incorrectly, use the local CLI:

```bash
npm run test:subscriptions:live -- --action edit-address --prepare-address-fixture
```

This checks customer ownership, reads the authorized subscription, saves its original normalized address in `.loop-original-address.json` (ignored by git, mode 0600), and updates only the address action in the private fixture. All fields are copied from Loop except address2, which gets a temporary marker. The command prints only changed field names and makes no provider mutation. It refuses to overwrite a different original backup. Restore the original values from that private backup after the valid action and replay have been verified; do not print or upload it.

For an existing unknown address test with a verified unchanged original address but no template placeholders, an operator may explicitly abandon/reconcile that test:

```bash
npm run test:subscriptions:live -- --action edit-address --resolve-unchanged-address --confirm-worker-stopped
```

First ensure the old CLI has exited and no other test worker can dispatch. The same local-only, ownership, two-minute age, unknown-state and complete address comparison guards apply. A changed address or active worker keeps its lock. Resolution preserves the attempt as rejected with `UNCHANGED_ADDRESS_RECONCILED` and updates the local state file; it does not assert provider rejection or successful application. It is never automatic and cannot be invoked through the dashboard. Only afterward prepare the correct fixture and create a new preview.

New provider failures retain only the HTTP status and a coarse allowlisted failure category (`HTTP_ERROR`, `BUSINESS_REJECTION`, `UNEXPECTED_RESPONSE`, or `TRANSPORT_OR_PRE_DISPATCH`). These appear on live execute/status results; provider bodies, headers and error messages remain excluded. Older attempts cannot retroactively recover discarded HTTP diagnostics.

## Admin order-now history verification

The observed Admin history returns `status: "PROCESSED"` and `financialStatus: "paid"` for a completed order. Order-now verification now recognizes that shape and requires one unambiguous newly paid order, absent from the saved pre-dispatch history, with valid Loop and Shopify order IDs. Older `SUCCESS` records remain supported only when they do not explicitly contradict successful payment. Pending, refunded, failed, missing-ID and ambiguous multiple-new-order results are not accepted. The shared HTTP fixture uses the observed Admin shape in integration and browser tests.

For an existing unknown order-now request, pull this fix and run only `npm run test:subscriptions:live -- --action order-now --status`. It rechecks history and can resolve the original paid order without placing another order. Keep the same request key, state file and ledger. Do not use `--new`, manual Place order, or an operator address recovery to bypass an uncertain charge.

## Explicit discount test deferral

A pending discount test is not automatically unlocked by an HTTP 500. When Loop's own admin has explicitly rejected the same code, the operator can defer this test while preserving its failure and request history:

```bash
npm run test:subscriptions:live -- --action discount --defer-discount-test --confirm-worker-stopped --confirm-loop-rejected
```

Use this only after the old CLI has exited, no other worker can dispatch, and Loop's UI rejection has been observed. The command is restricted to NODE_ENV=test, the dedicated local database, configured customer/shop and subscription 42347174. It requires an unknown, completed attempt at least two minutes old, a recorded HTTP 500 failure, a fresh unchanged discount set, and absence of the requested code in both the saved baseline and the current read. Active/recent attempts, changed discounts or an applied code retain their lock.

The local record becomes rejected with `DISCOUNT_TEST_DEFERRED`, keeps its provider diagnostics and receives an operator-resolution audit record. The CLI synchronizes its private state file. No Loop mutation is sent, no successful discount application is claimed, and the discount test remains pending. After deferral, refresh the cancellation preview before executing it. Tests verify rejection guards, zero discount writes and a subsequent independently verified cancellation through the normal executor.

Loop support confirmed on 2026-10-27 that gifting the upcoming order is not available through an API for custom portals. Published gift-subscription APIs are a different feature. Keep gift blocked; do not substitute those APIs or fabricate an address/order sequence.

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

## Rewards branch integration and discount retest (2026-10-28)

The subscription branch integrates rewards-admin-v1 commit `4918d0e1777b2c8d28b30621d6e9f42450170366`, including storefront/account/checkout redesigns, referrals and encrypted credential lifecycle. Retained uninstall records no longer authorize subscription actions or subscription storefront reads: an active installation with nonempty credentials is required. The production write gate and Fly configuration remain unchanged. This is a development branch merge, not a production deployment or a PR merge.

Verified on the combined code: 104 unit tests with local Mongo (no skips), 62 subscription HTTP/Mongo integration tests, 33 fixture browser tests, 2 account widget tests, 7 checkout widget tests, and 44 rewards acceptance tests. Four existing business-event replay checks skip on the empty test database because they require historical EARN, REFUND, committed REDEEM and REVERSAL records. They are not claimed as passing. The browser harness emulates the signed proxy; real Shopify login/proxy acceptance remains outstanding.

User-supplied live evidence covers 10 actions. Discount remains pending, and gift is externally blocked. Loop/client support reported that removing the existing 100% product discount allowed the Shopify discount to be applied; our custom API path still needs its own verified retest.

Perform these steps only on authorized subscription 42347174:

1. Privately save its current status, future billing schedule, full discount settings and usage/remaining-cycle counts. The last verified status was CANCELLED. Reactivate it in Loop admin with a future billing date, verify no billing is due now, then remove only the `Test Subscription` 100% product discount. Keep the shipping discount. Do not place an order or run order-now while the product discount is absent.
2. In Checkout-App/rewards, update only the discount fixture in the existing private `test/fixtures/loop-live-actions.json` to `"discount": { "value": "SUBTESTING1" }` (or the configured LOOP_LIVE_FIXTURES file). Preserve valid JSON and every other fixture. Do not copy the template over the private fixture.
3. Keep the existing Mongo database, ledger and state file. Confirm the previous discount attempt is already resolved as DISCOUNT_TEST_DEFERRED before creating a new request. If it remains unknown, stop and reconcile that original attempt; never delete its history or bypass its lock.
4. Run:

```bash
npm run test:subscriptions:live -- --inspect
npm run test:subscriptions:live -- --action discount --new --preview
npm run test:subscriptions:live -- --action discount --execute
npm run test:subscriptions:live -- --action discount --status
npm run test:subscriptions:live -- --action discount --execute
```

The first execute must be applied/verified with replayed=false. Status and repeated execute must be applied/verified with replayed=true and the same request key. Confirm SUBTESTING1 is active in Loop. If the outcome is unknown, preserve that request and run only status; do not begin another request or change the discount set while investigating.

5. Once the result is confirmed, remove SUBTESTING1 and restore the original product-discount eligibility, remaining cycles and shipping settings. Avoid resetting consumed cycles. Restore the saved status (CANCELLED unless a different state was explicitly authorized) and confirm the original product/address/frequency remain intact. Retain test evidence privately. No paid order is required for this discount-action test.

Live execution requires the operator's existing private .env.loop-test, local ledger and Loop credentials; these are not present in the integration workspace. Never upload them, and do not enable production mutations to run this test.

