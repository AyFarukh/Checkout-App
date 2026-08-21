# Checkout Upsell App

Shopify Checkout UI Extension for contextual and fixed upsells.

## Goals

- Show upsell products during checkout.
- Support fixed upsell products configured by the merchant.
- Support contextual upsells based on products currently in checkout.
- Add the selected upsell variant directly to the checkout cart when the buyer clicks **Add**.
- Keep the checkout UI close to Shopify's native styling.

## Important Shopify requirement

Checkout UI extensions rendered on the information, shipping, and payment steps require **Shopify Plus**.

## Architecture

This repository is being built as a Shopify app with:

- Shopify app backend/admin
- Checkout UI extension
- Merchant configuration for fixed and product-based upsell rules
- Cart-line mutation from the extension

The extension should use Shopify Checkout UI Extension APIs rather than DOM manipulation.
