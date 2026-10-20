# FTR welcome verifier — deployment required

This is an **isolated backend prototype**, not deployed and not connected to a live Shopify app. The current Checkout-App repository contains only Shopify UI extensions and **does not contain an existing web server**. Deploy this standalone Node 22 service to a secure HTTPS host before using it.

1. Set SHOPIFY_API_SECRET (Shopify app client secret), SHOPIFY_ADMIN_TOKEN (offline Admin token), SHOPIFY_SHOP_DOMAIN (e.g. example.myshopify.com), and PORT (optional). Never put secrets in the theme.
2. Request Shopify `read_customers` scope and required protected customer data approval; reinstall/re-authorize the app as needed.
3. Configure an **app proxy** with prefix `apps`, subpath `ftr-welcome`, and destination `https://YOUR-BACKEND/apps/ftr-welcome`. Ensure proxy forwarding preserves the Shopify signed query string.
4. Deploy with `node welcome-verifier/server.mjs`. Test valid/invalid signatures, timeout, rate limiting, email with and without orders, and API failures.
5. In theme editor set **Order verification endpoint** to `/apps/ftr-welcome` and configure the shared code `WELCOME25`. Note: the Theme Editor URL setting may require a full storefront URL depending on Shopify validation.
6. **Critical:** the shared code must be restricted to first-time customers at Shopify checkout. Showing a code only after email verification does **not** prevent existing customers from sharing or using it. Do not activate the campaign until checkout eligibility is enforced.
7. The endpoint currently returns a boolean about whether a supplied email has order history. This is subject to enumeration; add stronger abuse protection (durable IP/email rate limits, CAPTCHA and/or email ownership verification) and privacy review before production. In-memory rate limits are not sufficient for distributed deployments.
8. Email marketing consent and Klaviyo integration are separate; submitting an email to this verifier must not silently subscribe a customer.

The service intentionally fails closed if credentials are missing or Shopify errors occur. No discounts are generated, and no order or customer records are modified.
