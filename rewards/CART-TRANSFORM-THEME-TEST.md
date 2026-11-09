# Test the new bundle Cart Transform

This branch adds an opt-in test mode. The published app Function must also be
updated from `feature/rewards-admin-v1`; theme changes alone cannot update WASM.
No Function registration needs deleting or recreating.

## 1. Update the app

From the `Checkout-App` checkout:

```sh
git pull --ff-only origin feature/rewards-admin-v1
npx shopify app build --config checkout-upsell-app
npx shopify app deploy --config checkout-upsell-app
```

Verify the app is **Freetheroots Checkout Events**. Open its Shopify Admin page and
approve any new requested permissions. Our existing registration is
`gid://shopify/CartTransform/138019188`, Function
`01a144b1-43fc-759c-be7e-f6efaf9fa299`. Keep the three other registrations.

## 2. Enable our app-owned test switch

The separate Shopify GraphiQL app cannot set our `$app` namespace correctly by
using its own `$app` namespace. Use the new command from your existing private
backend environment, with the same MongoDB and encryption configuration used by
the rewards app. It uses the stored shop-scoped token; no token belongs in this
command or in a screenshot.

From `Checkout-App/rewards`, replace the store placeholder:

```sh
node scripts/set-bundle-test-rollout.js \
  --shop YOUR-STORE.myshopify.com \
  --transform-id gid://shopify/CartTransform/138019188 \
  --enabled true
```

Continue only if it returns `"verified": true` and `"enabled": true`. It checks
that the API token and selected registration belong to our app before writing,
and verifies the value through a read-back. It does not register/delete a Function
or change another app's configuration. If the token is missing or scopes are
rejected, open/re-authorize our embedded app first; do not substitute another
app's token. If the backend environment is unavailable locally, that is a blocker
to enabling this switch; theme changes still remain off at the Function level.

## 3. Preview this branch and opt in

Open the Shopify theme connected to **FinalUpdatedTheme** in Preview, then open a
bundle product in a **fresh incognito session with an empty cart**. Append this
query parameter to the product preview URL:

```text
ftr_bundle_test=1
```

For example:

```text
https://YOUR-STORE.myshopify.com/products/YOUR-BUNDLE?preview_theme_id=THEME-ID&ftr_bundle_test=1
```

If no query parameters exist yet, use `?ftr_bundle_test=1` instead. Keep the flag
in the product page URL while adding. No console editing or manual property
mapping is necessary. The opt-in is checked when the page loads; reload after
changing it. The existing bundle builders and Loop preparation run normally.
For one-time adds only, the test layer automatically marks the cart and converts
legacy properties before the final Shopify add request:

| Legacy key removed | Test key sent |
| --- | --- |
| `_parent` | `_ftr_test_parent` |
| `_set` | `_ftr_test_set` |
| `_parent_product_id` | `_ftr_test_parent_variant_id` |
| `_bundleId` on legacy one-time sets | removed; redundant ID not required |

Variant IDs, selected quantities, content text, other request options and unrelated
products are preserved. Loop transaction/selling-plan requests are not converted.
The existing opposite-purchase-mode guard supports the new names, so switching
between one-time and subscription removes the entire old group rather than just
its parent. Without the URL opt-in, the test layer does nothing.

A preview theme does not isolate shop-level Functions. The old Function should
ignore test lines if it relies on legacy keys, but its source and the other apps'
source are unavailable; property separation cannot guarantee they all skip the
same cart. Use Function logs to confirm which Function produced operations.

## 4. Test the actual configured selections

The Function now uses the SAME parent-product fields as the theme:

| Allowed products | Required quantity per paid parent unit |
| --- | --- |
| `custom.block_1_products` | `custom.no_of_block_1_free_products` |
| `custom.block_2_products` | `custom.total_block_2_free_products` |
| `custom.block_3_products` | `custom.total_block_3_free_products` |
| `custom.block_4_products` | `custom.total_block_4_free_products` |

Lists must be `list.product_reference`; quantities must be nonnegative
`number_integer` metafields. Missing/zero quantities disable a block. An active
block requires a nonempty valid product list. At least one block must be active.
There is no assumption of one choice per block or a total of three items.
The limit is 50 included units per parent (and 50 cart lines); excessive or
malformed configuration is rejected. If the preselected grid permits a selection
that cannot fill the individual block quantities, the Function rejects it even
if the total count matches. Frontend properties never authorize free products.

Start with one-time bundles:

1. Choose the complete configured bundle, including any block requiring multiple
   picks. Parent remains paid; allowed child quantities become zero-priced.
2. Add the same child in multiple allowed slots; merged quantities are supported.
3. Test another bundle with different counts or a fourth block.
4. Check cart and checkout agree. Change quantities consistently: two paid parent
   units require twice the configured included quantities.
5. Confirm unrelated products remain normally priced. Missing/extra/unauthorized
   picks must not receive free pricing from our Function.
6. Switch from one-time to subscription and back. Check there are no leftover child
   lines, and confirm official Loop pricing is preserved. The Cart Transform itself
   does not price selling-plan lines.

All variants of an allowed product are authorized by these product-level lists;
all positive-priced parent variants share the parent's rules. If premium/sample
variants need separate restrictions, configure explicit variant rules before a
production rollout.

## Stop testing

Use the same command with `--enabled false` to stop OUR test processing globally.
Do not remove the existing Function. To stop theme conversion, remove
`ftr_bundle_test=1` from the product URL and reload. The cart flag and test lines
persist in that browser cart; removing the URL flag alone does not clear them.
Use a fresh cart/session when comparing with normal browsing.

The old Function's production removal and an unrestricted production rollout are
separate steps after test results are verified. This branch does not publish a
theme via CLI, deploy the app, set live configuration, or remove a registration.
If Shopify GitHub integration syncs this branch, preview the connected theme;
do not publish it as the live theme for this test.

## Verification

- 12 theme tests cover opt-in, conversion, flag failures, normal/Loop preservation,
  origin isolation and the real purchase-mode guard in both switch directions.
- 71 Function cases cover the four product lists and quantities, overlap, merged
  quantities, authorization, malformed configuration, legacy-key isolation and
  default-off controls.
- 7 backend switch tests cover ownership, the specific target, errors and read-back.
- Compiled Function checks accepted a four-pick fixture, rejected an unauthorized
  selection and processed 50 included units within the runtime instruction limit.
- Theme check has the same 129 existing errors as the branch baseline; no new
  diagnostics were introduced by this change.

No live checkout result has been claimed. Test in the actual store using the steps
above before placing a paid order or removing an existing Function.
