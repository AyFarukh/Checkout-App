# Referral design and account branding

The customer account extension uses Shopify's native components. It now groups
referrals into an invitation hero, sharing card, compact milestone list with
progress, and a full-width invitation button. Reward amounts and milestones
continue to come from the saved program settings.

## Make account buttons green

1. In Shopify admin, open **Settings → Checkout**.
2. Under **Configurations**, choose **Edit** for the active configuration.
3. In the page selector, choose a customer account page.
4. Open **Sections → Main** and set **Accent** to `#259260`.
5. Set **Background** to `#FAF8F5` if desired, then save.

These settings apply to customer account branding, including native buttons.
The extension cannot assign arbitrary hex colors to individual buttons or boxes.
Its semantic backgrounds and typography follow the merchant's account branding.
The exact brown hero (`#7C4B32`), cream tiles (`#FCF3E7`), and custom typography
remain available on the separate storefront referral page, linked from the
account extension. Shopify's native extension cannot reproduce those details
exactly.

Shopify instructions:
https://help.shopify.com/en/manual/customers/customer-accounts/customize-customer-accounts/customize

## Release and verify

From the repository directory on `feature/rewards-admin-v1`:

```sh
git pull --ff-only origin feature/rewards-admin-v1
npx shopify app build --config checkout-upsell-app
npx shopify app deploy --config checkout-upsell-app
```

Review and confirm the intended app before publishing the extension release.
No backend deployment or token-key change is required for this layout update.
After publishing and setting the account accent, reload the customer account
Rewards page. Check the three sharing tiles, compact milestone rows, progress,
full-width green invitation button, copy actions, and the expandable friend-code
form. Also check a narrow mobile viewport and a customer with an unlocked gift.
