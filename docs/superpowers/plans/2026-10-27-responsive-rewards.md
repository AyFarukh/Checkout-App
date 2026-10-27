# Responsive rewards polish

Match the supplied Base44 rewards-program mobile reference on the existing custom storefront page. Retain live customer data and all authenticated redemption/referral behavior. Do not copy prototype balances, cart counts, or unconfigured earning methods into production.

Mobile: 65px brand header; 16px page gutters; Nunito Sans type; brown compact balance hero; white tier progress card; vertical tier and earning lists; two-column reward tiles with confirmation; compact referral cards, milestones and pill CTA. Reference colors: brown #784930, green #288F5F, sand #FAF8F5, cream #FBF4E9.

Desktop: 1120px content width with a branded header and anchor navigation, balance and progress side by side, four tier cards, multiple reward columns, and paired referral cards. Keep the mobile ordering when the grid collapses.

Tasks: restructure rewards frontend markup with reusable SVG icons and reward cards; implement responsive CSS shared by referrals; locally serve font/logo assets; verify redemption retries, semantic lists and unavailable reward state; compare browser previews at390/375/320 and desktop1440; run existing checks and request a code review; push feature branch without deploying or merging.
