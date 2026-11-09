# Cart Transform switch — prepared, not executed

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

The Function now reads the paid parent product's `custom.block_1_products`,
`custom.block_2_products`, and `custom.block_3_products` directly from Shopify.
All three must be nonempty `list.product_reference` metafields. No separate
manual allowlist is needed. Each set requires exactly one selected product from
each block per parent unit. Overlapping product lists are resolved as a complete
one-to-one assignment; membership in the combined lists alone is insufficient.

Shopify can merge repeated selections of an identical variant into one line.
Quantities are therefore counted as selected units per parent quantity. Three
identical picks may be one child line with quantity three. Invalid quantities,
missing/extra/unauthorized children, unpaid parents, ambiguous parents, missing
configuration, and subscription lines produce no price updates for that set.
The parent keeps its catalog price; validated children get a per-unit price of
zero. Invalid sets do not prevent independent valid sets from being processed.

Existing line properties are retained: `_parent=true` on the parent, matching
`_set`/`_bundleId` values of the form `set-...`, and `_parent_product_id` containing
the parent's numeric VARIANT ID on each child. Block names supplied in cart
properties are never trusted as authorization. Eligibility uses Shopify product
identity, not client-supplied product labels or IDs.

Product-level metafields authorize all variants of each listed child product,
and every positive-priced variant of the configured parent product. If the
catalog includes sample/premium variants that should be excluded, add explicit
variant rules before activation. Missing/optional blocks are not currently
supported: all three blocks are required, as specified for this implementation.

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

- 35 Function unit cases passed (authorization, overlaps, quantities, malformed
  configuration, independent sets and unsupported subscription lines).
- The new input query validated against the 2026-07 Cart Transform schema.
- The complete Shopify app build passed.
- Local compiled WASM runs returned three zero-price child operations for an
  authorized fixture, no parent operation, and no operations for an unauthorized
  child-product fixture. Synthetic IDs only; these runs did not contact a cart or
  execute a store mutation.

## Controlled switch, only after the checks above pass

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
