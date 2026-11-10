# Bundle demo: direct __bundle flow

`FinalUpdatedTheme` now sends `__bundle` (exactly two leading underscores) instead
of the old `_set` property on one-time bundle parents and children. There is no
preview URL flag, cart test attribute, runtime test switch, quantity snapshot,
Fly helper upload, or encryption-key setup required for this Cart Transform.
The rewards backend's existing authentication/encryption setup is separate.

## Publish the matching Function update

From your updated `Checkout-App` checkout:

```sh
git pull --ff-only origin feature/rewards-admin-v1
npx shopify app build --config checkout-upsell-app
npx shopify app deploy --config checkout-upsell-app
```

Confirm the app is `Freetheroots Checkout Events`. Keep existing registration
`gid://shopify/CartTransform/138019188` for Function
`01a144b1-43fc-759c-be7e-f6efaf9fa299`. It does not need recreating. No other
Function registration has been removed or disabled by these changes.

## Demo from the theme

1. Open the Shopify theme connected to `FinalUpdatedTheme` in Preview.
2. Start with an empty cart or a fresh incognito session, so previously transformed
   lines using `_set` or the old test properties do not affect the result.
3. Open a bundle product normally. Choose one-time purchase, complete the selection
   blocks, and add it. No query parameters or console commands are necessary.
4. Check cart and checkout: the parent keeps its price; authorized included child
   quantities receive zero prices. Check unrelated products keep their prices.
5. For subscription options, official Loop transaction and selling-plan handling
   stays in place. Switching purchase mode removes the entire opposite group.

## Payload contract

| Property | Parent | Children |
| --- | --- | --- |
| `__bundle` | Same generated `set-...` value | Same value as parent |
| `_parent` | `true` | Absent |
| `_parent_product_id` | Absent | Parent's numeric variant ID, retained for theme/Loop handling |
| `content` | Existing selection summary | Unchanged |

The Function authorizes each group using a single paid parent, its trusted product
identity, and exact live product/quantity rules. The shared `__bundle` value links
children to that parent; the client-supplied `_parent_product_id` is not used to
authorize free products. The Function ignores groups carrying only old `_set` or
old test keys. Old app-owned test configuration and cart flags are no longer read.

All four rule pairs are read live from Shopify:

| Product list | Required included units per paid parent |
| --- | --- |
| `custom.block_1_products` | `custom.no_of_block_1_free_products` |
| `custom.block_2_products` | `custom.total_block_2_free_products` |
| `custom.block_3_products` | `custom.total_block_3_free_products` |
| `custom.block_4_products` | `custom.total_block_4_free_products` |

Product lists must be `list.product_reference`, counts must be nonnegative
`number_integer` values or whole-number numeric text in existing
`single_line_text_field` fields. Empty, fractional, negative, or nonnumeric text
is rejected. Missing/zero counts disable a block. Active blocks need valid
lists. At least one block must be active, with no more than 50 included units per
parent and 50 cart lines. Unauthorized, incomplete, extra, malformed, unpaid,
duplicate-parent, self-product or selling-plan groups receive no price changes.
Overlapping lists and repeated variants merged by Shopify are supported.

The Function input query calculates to 30 points, within Shopify's limit. It reads
selling-plan presence with free `__typename`; unused variant-ID/reference fields
and test switches were removed to fit the budget without caching the rules.

The other registered apps' code is outside this repository. Changing the grouping
property does not unregister them or prove they cannot change a cart; verify the
actual cart/checkout result before the demo.

## Verification

58 Function tests cover authorization, live rules, quantity matching and the exact
`__bundle` input contract. Two theme tests exercise the real purchase-mode guard
in both directions. The Function is built and run locally on valid and invalid
four-selection fixtures. Store deployment and a live checkout remain your steps.


Compatibility fix verified against the reported Complete Care setup: its third
block count is a `single_line_text_field` with value `1`, while the other counts
are integer fields. Numeric text is accepted without changing store metafields.
The Four Pack integer configuration remains supported. Local compiled replays
use the reported product selections and the read-only Shopify rule data; live
checkout verification still requires deploying the updated app version.
