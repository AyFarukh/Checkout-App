# Test-only bundle properties in a theme preview

## What this change isolates

Our Function now reads these line properties only:

| Purpose | Legacy property (remove on test lines) | Test property |
| --- | --- | --- |
| Parent marker | `_parent` | `_ftr_test_parent` |
| Set grouping | `_set` | `_ftr_test_set` |
| Parent variant reference on children | `_parent_product_id` | `_ftr_test_parent_variant_id` |
| Optional duplicate group ID | `_bundleId` | `_ftr_test_bundle_id` (not required) |

Use these exact names, not extra underscores on the old names. Our Function ignores
legacy-only lines and rejects test sets containing any of the four legacy keys.
These properties identify selections; they never replace Shopify product checks.

This prevents the old Function from recognizing test bundles IF it relies on the
legacy keys. Its source and the two other registered apps' source are unavailable,
so this is not proof that every other Function skips these lines. Inspect fresh
cart prices and our Function runs. Stop if another Function still changes the
renamed lines. Do not delete an existing registration just to diagnose it.

**Compatibility blocker:** the current validator still requires exactly one
allowed choice from each of three parent-product lists. The merchant's real
example has four children and variable block counts. It must produce NO operations
from our Function until the actual theme selection rules are implemented. This
change isolates test properties; it does not claim the real bundle is supported.
Do not place a paid order to test this incomplete compatibility.

## 1. Publish the updated app when ready

From the repository:

```sh
git pull --ff-only origin feature/rewards-admin-v1
npx shopify app build --config checkout-upsell-app
npx shopify app deploy --config checkout-upsell-app
```

Verify the CLI names `Freetheroots Checkout Events`. Our existing registration is
`gid://shopify/CartTransform/138019188`, Function
`01a144b1-43fc-759c-be7e-f6efaf9fa299`. Publishing this Function update does not
require deleting/recreating that registration. Keep every other registration.
Codex has not deployed these changes or changed the store.

## 2. Change only the test theme's add-to-cart builder

Duplicate the theme and edit that unpublished copy. Locate the code that builds
the `items` array sent to `cart/add.js`. The theme code is not in this app repository,
so this app update cannot modify it automatically.

Add this helper in that builder's JavaScript scope:

```javascript
function toFtrTestItems(items) {
  return items.map(item => {
    const properties = {...(item.properties || {})};
    if (!properties._set) {
      throw new Error('Expected a bundle set before converting test items');
    }

    properties._ftr_test_set = String(properties._set);
    if (String(properties._parent) === 'true') {
      properties._ftr_test_parent = 'true';
    }
    if (properties._parent_product_id != null) {
      properties._ftr_test_parent_variant_id =
        String(properties._parent_product_id);
    }

    delete properties._parent;
    delete properties._set;
    delete properties._parent_product_id;
    delete properties._bundleId;

    return {...item, properties};
  });
}
```

For that test theme's bundle add request, change:

```javascript
body: JSON.stringify({items})
```

to:

```javascript
body: JSON.stringify({items: toFtrTestItems(items)})
```

This applies only to the bundle items array, not unrelated normal-product add
requests. It preserves variant IDs, quantities and the parent `content` property.
Keep any other existing top-level request options when editing the real request.
Do not put this conversion in the published theme yet. If the request is built
with FormData or a different shape, share its source instead of pasting this at
an arbitrary location. No cart tokens or app access tokens are needed.

## 3. Use a fresh cart and mark it for testing

Open the test theme preview in a new incognito session. A preview theme does not
isolate shop-level Functions. Start with an empty cart; previously transformed
lines can obscure what happened. Add the bundle through the modified test builder.

In the storefront browser console, flag that cart:

```javascript
const testResponse = await fetch(window.Shopify.routes.root + 'cart/update.js', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({attributes: {_ftr_bundle_pricing_test: 'true'}})
});
if (!testResponse.ok) throw new Error('Could not mark the test cart');
const testCart = await testResponse.json();
console.log('Test flag:', testCart.attributes._ftr_bundle_pricing_test);
console.table(testCart.items.map(item => ({
  variant: item.variant_id,
  quantity: item.quantity,
  properties: JSON.stringify(item.properties),
  unitPriceMinorUnits: item.final_price
})));
```

Verify the three new names and absence of ALL four legacy names on test lines.
The set value must match on parent and children. The child parent reference is
the paid parent's numeric variant ID, not its product ID.

## 4. Enable our trusted test configuration only when compatibility is ready

The cart flag alone cannot enable pricing. Our registration also needs the
app-owned JSON metafield `bundle-test-rollout` with `{"testEnabled":true}` in our
app's `$app` namespace. The last successful registration mutation did NOT set it.
See [CART-TRANSFORM-SWITCH.md](CART-TRANSFORM-SWITCH.md) for the configuration
mutation; use owner `gid://shopify/CartTransform/138019188`.

Set it through `Freetheroots Checkout Events`' authenticated API context. Using
`$app` from the separate GraphiQL app resolves to that other app's namespace and
will not enable our Function. Do not infer enablement from a successful mutation
in a different namespace. If that API context is unavailable, leave it disabled
and arrange the configuration through our backend; never share access tokens.

Until actual variable rules are implemented, use local Function fixtures to test
positive pricing. Your four-child real bundle is presently a rejection case, even
with test mode on. Keep the old registration and inspect Function operations to
distinguish our no-op from changes made by other apps.

## Stop testing

Opt this cart out with:

```javascript
await fetch(window.Shopify.routes.root + 'cart/update.js', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({attributes: {_ftr_bundle_pricing_test: ''}})
});
```

For the global kill switch, set our app-owned JSON value to
`{"testEnabled":false}`. Restore the test theme builder if discarding this
experiment. Do not convert the published theme or unregister the old Function
until the real bundle rules and separate test outcomes are verified.

## Verification

57 unit/contract tests cover original product validation, default-off controls,
test-key mapping, legacy-only isolation, mixed-key rejection, an optional bundle
ID mismatch, and rejection of the four-child unsupported case. The actual input
query bindings are used when projecting raw storefront properties in the contract
tests. Local compiled checks also inspect enabled, disabled and mixed-key fixtures.

Source: https://shopify.dev/docs/api/functions/2026-07/cart-transform
