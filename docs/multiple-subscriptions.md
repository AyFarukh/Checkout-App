# Customer subscription selection

The dashboard reads subscriptions from the existing signed Shopify proxy. The backend derives the customer ID from Shopify authentication; no customer ID or subscription list is hardcoded in the theme.

Previously, the renderer sorted the returned list and displayed only its first entry. It now offers every subscription in the authenticated response in a labeled selector with its ID, status and product count. A single subscription shows its ID without a redundant selector. Empty responses clear previous details.

Switching changes products, schedule, frequency, address and action targets together. Refresh after a verified action retains the selected subscription when it still exists, otherwise falls back to the first available subscription. Selection is disabled while an action dialog is open. Pending outcomes and request keys remain tied to their original subscription; switching never resubmits a change.

This does not enable mutations for other customers or subscriptions. Existing server ownership checks, test subscription restriction and production mutation block remain unchanged. Gift remains unavailable through Loop's custom-portal API.

Validation on 2026-11-02: 37 browser fixture tests passed, including four new regressions for multi-subscription selection/refresh, pending outcome isolation, single subscription identity and clearing an empty customer response. Companion backend unit tests: 102 passed, two existing Mongo-dependent skips; subscription integration tests: 62 passed, zero skipped. No live subscription writes, production deployment, theme publication or PR merges were performed for this change.

Update assets/ftr-subscription-dashboard.js and assets/ftr-subscription-dashboard.css together in the unpublished development theme from feature/loop-all-actions-confirmation-v1. Reload the signed-in preview and use Choose subscription to select the intended subscription, including authorized test ID 42347174. A different theme preview or cached old script will still show the old behavior. No backend redeployment is needed for this UI fix.
