# Checkout rewards widget

Use the existing purchase.checkout.block.render extension and native Shopify components. Match supplied structure: icon/member/balance header, divider, nearest order-discount threshold, three highest affordable synced order-discount tiles, expandable eligible list, estimated order points. Exact colors and typography remain controlled by checkout branding; do not insert CSS/HTML unsupported by Shopify.

Retain authenticated reservation/apply and reserved-code recovery. Show order discounts as tiles; account rewards continue to offer gifts/shipping. Use store currency metadata for reward amounts and suppress numeric earning estimates when currency/conditional eligibility cannot be established. Refresh on subtotal and buyer changes; never reserve when checkout forbids discount changes. Tests cover collapse/expand, next threshold, eligibility, estimates, reservations and apply failure recovery. Build, review and push feature branch; do not deploy or merge.
