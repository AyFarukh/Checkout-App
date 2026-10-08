# FreeTheRoots extension consolidation

Branch: `feature/consolidate-ftr-extensions`

## Migrated from AyFarukh/Free-The-Root
- cart-grouped-merge — Cart Transform Function
- checkout-extension-js — checkout UI
- custom-message — checkout UI
- custom-popup-checkout — checkout UI
- order-status-page — thank-you UI
- shop-pay — checkout UI
- shopify-thankyou-order-status — thank-you + customer account order-status UI

## Existing Checkout-App extensions retained
- checkout-upsell
- smart-fbt-discount

## Intentionally not activated/copied
- checkout-test-ui — test-oriented extension; keep out of production consolidation unless explicitly required.
- discount-bundle — overlaps discount-function responsibility already present in smart-fbt-discount; requires logic comparison before any merge.

## Safety
- main was not modified.
- Existing extension source/handles/targets were preserved during the initial migration.
- No live Shopify deployment is performed by this branch creation.
- Generated/dist artifacts from the source repository were not migrated; they should be rebuilt from source.

## Follow-up validation before deployment
1. Install dependencies.
2. Run Shopify CLI validation/build.
3. Verify all extension targets against the selected app configuration.
4. Test checkout UI blocks individually.
5. Test cart transform with real `_parent`, `_parent_product_id`, and `_set` payloads.
6. Test discount interaction with smart-fbt-discount.
7. Test thank-you and customer-account order-status surfaces.
8. Deploy only after validation passes.
