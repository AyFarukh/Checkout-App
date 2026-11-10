# Cart Transform switch — prepared, not executed

## Test alongside the old registration — default off

For theme property migration, see [CART-TRANSFORM-THEME-TEST.md](CART-TRANSFORM-THEME-TEST.md).
Our registration was confirmed by the merchant as `gid://shopify/CartTransform/138019188`
for Function `01a144b1-43fc-759c-be7e-f6efaf9fa299`. Do not create a duplicate.
The mutation that created it supplied no test configuration.

The replacement is now test-only. Keep every existing registration, including
`40894836`, while testing. Do not run the removal mutation below during testing.
Codex has not published, registered, changed live configuration or deleted any registration.
The merchant registered our Function separately, as recorded above.

Two independent conditions are required before our Function emits operations:

1. Its own Cart Transform registration has an app-owned JSON metafield with
   namespace `$app`, key `bundle-test-rollout`, containing `testEnabled: true`,
   `countsVersion: 1` and the validated `blockCounts` snapshot.
2. The individual cart has attribute `_ftr_bundle_pricing_test` equal to `true`.

Missing/false/malformed configuration or an absent cart flag returns no operations.
The cart flag is not secret and does not bypass product or quantity authorization.
There is deliberately no unrestricted production mode in this implementation.

Our Function is already registered. Publish its code update only when ready,
retain all existing registrations, and refresh the app-owned configuration using
the checked command from the backend's existing private environment:

```sh
cd rewards
node scripts/set-bundle-test-rollout.js \
  --shop YOUR-STORE.myshopify.com \
  --transform-id gid://shopify/CartTransform/138019188 \
  --enabled true
```

This reads all four count metafields, validates and snapshots them, writes only
our registration's app-owned configuration, and verifies it by read-back. Require
`verified: true` and `enabled: true`. A manually written `testEnabled: true` alone
is insufficient after the complexity fix. Re-run this command after changing
quantity metafields or adding bundle products. The ordinary product allowlists
remain live. A different GraphiQL app's `$app` namespace cannot configure ours.
See the theme test guide for automatic URL opt-in without console commands.

In the browser console on your test storefront, opt ONLY that cart into testing:

```javascript
const response = await fetch(window.Shopify.routes.root + 'cart/update.js', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({attributes: {_ftr_bundle_pricing_test: 'true'}})
});
if (!response.ok) throw new Error('Could not enable the test cart');
await response.json();
```

Set the cart attribute to an empty string to opt that cart out. Set the app-owned
JSON value to `{"testEnabled":false}` to stop our operations for every cart.
Neither step removes or disables any other app's transform.

Both registered Functions can still act on the SAME cart. The flag controls only
ours, and the old Function does not understand it. A checkout price of zero cannot
prove which Function produced it. Use our local Function runs or Function run
logs to inspect our emitted operations; use a separate development store without
the old registration for a fully isolated checkout test.

### Theme-compatible variable blocks

The validator uses all four live product lists and an app-owned snapshot of the exact quantity fields found
in the theme: `no_of_block_1_free_products`, `total_block_2_free_products`,
`total_block_3_free_products`, `total_block_4_free_products`, in namespace `custom`.
The enable command reads these quantity fields from Shopify and saves them in
`countsVersion: 1`, `blockCounts: {numericProductId: [count1,count2,count3,count4]}`
in the app-owned JSON configuration. Re-run enable after changing counts or adding
bundle products. Missing/zero counts disable blocks; active counts require valid
live authorized lists. This avoids four runtime metafield lookups, reducing the
query from 42 to the supported maximum of 30 points. Existing configurations with
only `testEnabled: true` must be refreshed.
Four-child and variable-count bundles are supported when they fit those trusted
rules. Frontend labels and quantities are not trusted as authorization.
See the theme test guide for URL opt-in and the new ownership-checked command to
set the app-owned test switch without using a different GraphiQL app's namespace.

## Confirmed scope

Disable only the old `cart-grouped-merge` owned by `free-the-root-checkout-app`:

- Cart Transform registration: `gid://shopify/CartTransform/40894836`
- Function: `b85ed0fd-51d6-4854-8a9b-bad87cbd1759`
- Owner client ID: `c24ea9fdf0bc50deaa2f77882c5269bf`

Keep the existing registrations `40927604` (`freetheroot-cart-transform`) and
`41189748` (`price-update-final-app`). They can still execute. Installing our
function does not turn another app's function off; `blockOnFailure: false` is
failure handling, not an enabled/disabled flag.

Our replacement belongs to `Freetheroots Checkout Events`:

- Client ID: `2faa75d1b8a04a2fb7872c3b0b1b437f`
- Function: `01a144b1-43fc-759c-be7e-f6efaf9fa299`
- Handle: `cart-grouped-merge`
- Prepared title: `FreeTheRoots Bundle Pricing` (previously `t:name`)

## Prepared replacement behavior

The Function reads `custom.block_1_products` through `custom.block_4_products`
and the matching integer counts snapshotted by the enable command above. At least one block must be
active. Each active block requires a valid, nonempty `list.product_reference`.
No separate manual product allowlist is needed. Overlapping lists are allocated
against every block's required quantity using bounded flow, not just combined
list membership. Missing/zero counts disable a block; malformed counts fail closed.

Shopify may merge identical variant selections into one line. Child quantities
are counted per parent unit. The limits are 50 included units per parent, 50 cart
lines, and 256 products per active block. Invalid quantities, incomplete/extra or
unauthorized children, unpaid/ambiguous parents, bad configuration and selling-plan
lines produce no operations for that set. The parent price is unchanged; valid
included children receive a zero per-unit price. Independent valid sets still work.

Test-only properties are required: `_ftr_test_parent=true` on the parent, matching
`_ftr_test_set` values of the form `set-...`, and `_ftr_test_parent_variant_id`
containing the parent's numeric VARIANT ID on each child. `_ftr_test_bundle_id`
is optional; if present it must match `_ftr_test_set`. Test sets carrying any
legacy `_parent`, `_set`, `_parent_product_id`, or `_bundleId` are rejected.
Legacy-only lines are ignored by our Function. Block names supplied in cart
properties are never trusted as authorization. Eligibility uses Shopify product
identity, not client-supplied product labels or IDs.

Product-level metafields authorize all variants of each listed child product,
and every positive-priced variant of the configured parent product. If the
catalog includes sample/premium variants that should be excluded, add explicit
variant rules before activation. Optional blocks are supported when their count is missing or zero.

## Before the switch

1. Publish the prepared source and app configuration only when ready:

   ```sh
   git pull --ff-only origin feature/rewards-admin-v1
   npx shopify app build --config checkout-upsell-app
   npx shopify app deploy --config checkout-upsell-app
   ```

   The configuration now requests read_cart_transforms/write_cart_transforms and
   names the extension `FreeTheRoots Bundle Pricing` instead of `t:name`. Publishing
   is not registration and does not delete the old registration.
2. Open the app in Shopify and approve its updated permissions if prompted, then
   refresh authorization. Merely adding scopes to a local file does not grant them.
3. Verify one actual parent product's three metafields and a representative cart
   against the documented properties. Confirm `lineUpdate` is supported by the
   store plan (Shopify Plus/development store) and these are one-time purchases.
4. Verify the published Function's appKey is our client ID, its handle is
   cart-grouped-merge, and record its current function ID. No store mutation has
   been executed by Codex.
5. Test intended bundles, quantity changes, repeated variants, ordinary carts,
   forged properties, and the interaction with the two retained transforms on a
   development store before the production switch.

## Verification performed

- 80 Function unit cases passed (authorization, overlaps, quantities, malformed
  configuration, independent sets and unsupported subscription lines).
- The new input query validated against the 2026-07 Cart Transform schema.
- The complete Shopify app build passed.
- Local compiled WASM runs returned three zero-price child operations for an
  authorized fixture, no parent operation, and no operations for an unauthorized
  child-product fixture. Synthetic IDs only; these runs did not contact a cart or
  execute a store mutation.

## Future controlled switch — not part of theme testing

Do NOT remove the old registration during this test. The current replacement is
still gated by test configuration, a cart flag, and test-only property names. A
production rollout must arrange the normal theme payload and activation mode
before unregistering the Function serving ordinary customer carts. Passing the
test fixtures alone is not authorization to perform this production cutover.

Save the old registration's function ID, blockOnFailure value, and any accessible
metafield configuration for rollback. Use appropriately authorized Admin API
access. Registration by handle must run in our app's API context, not a different
app that happens to have the same Function handle.

Remove only the selected old registration:

```graphql
mutation RemoveOldCartTransform {
  cartTransformDelete(id: "gid://shopify/CartTransform/40894836") {
    deletedId
    userErrors { field message }
  }
}
```

Require deletedId to match and userErrors to be empty. This removes the active
registration; it does not uninstall the owning app or delete deployed Function
code. If ownership/permissions prevent removal, use the owning app's authorized
management path rather than assuming our app can manage its registrations.

Register the replacement through Freetheroots Checkout Events. The handle is
scoped to the calling app; do not assume a separate GraphiQL app can use this
handle to create our registration:

```graphql
mutation ActivateOurCartTransform {
  cartTransformCreate(functionHandle: "cart-grouped-merge", blockOnFailure: false) {
    cartTransform { id functionId }
    userErrors { field message }
  }
}
```

Require no userErrors and verify the returned functionId against our app's
published function. These mutations are schema-validated for 2026-07; neither has
been executed. They are separate operations, not an atomic transaction. Have the
old app's reactivation path ready if replacement registration fails.

Finally rerun cartTransforms. The old registration must be absent, our function
must be present, and the two retained registrations must remain. Refresh existing
cart sessions and test bundle quantity changes, parent removal, normal products,
and checkout totals. Unregistering a transform stops its future processing; it
does not retroactively edit existing orders. Recheck registrations if an old app
is reconfigured or reinstalled, as it could register a transform again.

## Sources

- https://shopify.dev/docs/api/functions/2026-07/cart-transform
- https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/cartTransformCreate
- https://shopify.dev/docs/api/admin-graphql/latest/mutations/cartTransformDelete

If a separate GraphiQL client is used, the 2026-07 API also supports the deprecated
`functionId` argument for identifying a specific published function. App ownership
and permission checks still apply. Use our verified function ID and report any
userErrors; do not substitute another app’s identically named function.
