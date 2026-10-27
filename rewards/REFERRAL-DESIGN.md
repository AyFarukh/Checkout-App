# Custom rewards experience

The primary customer experience is now the storefront page at
`https://YOUR-STORE/apps/ftr-welcome/rewards`. The account extension opens this
page instead of rendering a second rewards interface with Shopify's restricted
native styling.

The custom page includes the existing balance, membership tiers, earning rules,
reward confirmation and redemption, active codes, recent activity, and referral
flow. All action buttons use `#288F5F`; both the account balance card and referral
hero use `#784930` with light text. Referral milestones are list rows, and the
progress bar has an explicit numeric value, including zero. No account branding
change is needed for the custom page. Shopify still controls the appearance of
the single native account button that opens it.

## Authentication

Shopify signs every storefront app proxy request. The server validates the
signature and timestamp and binds API requests to the signed shop and
`logged_in_customer_id`. Customer identity is never accepted from a request body.
Unsigned, tampered, and signed-out API requests are rejected. Mutations require
JSON and reject cross-site fetches. The existing customer account API continues
to require its JWT. Customer responses use private, no-store caching. No access
tokens or customer session tokens are included in the link.

## Release order

From the repository root, on `feature/rewards-admin-v1`:

```sh
git pull --ff-only origin feature/rewards-admin-v1
flyctl deploy --remote-only --app freetheroots-rewards-system
npx shopify app build --config checkout-upsell-app
npx shopify app deploy --config checkout-upsell-app
```

Deploy the backend first so the custom page and destination URL exist before
publishing the account extension. Review the target app before publishing.
No encryption-key change or new Shopify scope is required. These commands are
instructions; this change has not been deployed or merged by Codex.

Add `/apps/ftr-welcome/rewards` to the storefront navigation as **Rewards**, or
open it from **Customer account → Rewards → Open your rewards**.

## Verify on the development store

1. Open the custom URL while signed out: it must request sign-in without exposing
   points or codes. Sign in and reopen the URL if Shopify does not return there.
2. Check the signed-in customer's balance and membership tier against admin.
3. Check the brown balance and referral cards and green buttons on desktop and
   mobile. Zero referrals must show an empty, stationary track.
4. Redeem one eligible reward; confirm the points reservation and usable discount
   code. Apply it at checkout. Repeated clicks/retries must not double-reserve.
5. Verify referral copy/share, friend-code claiming, milestone gift claiming, and
   the existing refund lifecycle using a second eligible test customer.
6. Verify the account link opens this page on the correct development store.

Automated checks: `npm run test:account-ui` at repository root; `npm test` inside
`rewards`. The frontend retry regression preserves keys after uncertain failures,
rejects terminal released reservations, and permits a fresh attempt. Signed proxy
tests check forged identity, signed-out access, shop isolation, and cross-site
writes. Real Shopify login and checkout remain deployment acceptance checks.
