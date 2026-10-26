# Token hardening and controlled rollout

Changes are prepared on `feature/rewards-admin-v1`; nothing is deployed by this work.

## Behavior

Offline access and refresh fields now contain randomized AES-256-GCM envelopes.
The authenticated data binds ciphertext to the shop and token field. A dedicated
base64-encoded 32-byte `SHOPIFY_TOKEN_ENCRYPTION_KEY` is required for writes and
encrypted reads. Missing keys and authentication failures fail closed without
logging token data. Plaintext records migrate on use; the batch script covers
inactive stores. Migration preserves credential generation, so it does not
invalidate an in-flight refresh write. Actual rotations change the generation.

The HMAC-verified `/webhooks/app-uninstalled` route binds the shop header to the
signed payload and requires a valid event timestamp. It clears both credentials
and keeps an uninstall marker to prevent environment fallbacks. Delayed events
cannot overwrite a newer acquisition, and in-flight exchanges/refreshes cannot
resurrect cleared credentials. Because the timestamp header is not HMAC-signed,
the handler also checks current credentials with Shopify before clearing them:
an active installation is preserved, a 401 permits revocation, and inconclusive
provider/network errors fail for retry. No discount or other Shopify data is
changed by this read. If Shopify still accepts credentials briefly after a real
uninstall, the marker is not written on that delivery; subsequent API rejections
still require reauthorization. Shopify revocation remains the access boundary.

The subscription is declared only in the configuration for the Rewards app,
`shopify.app.checkout-upsell-app.toml`. Reward/customer history is retained.
Welcome verification treats an uninstall marker as unauthorized.

## Operator steps, only after rollout approval

1. Generate a cryptographically random 32-byte key, base64 encode it, and save it
   in your secure secret manager. Do not use the Shopify API secret as this key.
   Make a recoverable secure backup; losing it requires reauthorizing all stores.
2. Stage `SHOPIFY_TOKEN_ENCRYPTION_KEY` as a Fly secret for
   `freetheroots-rewards-system` without printing it or placing it in source control.
   Keep the same key across all machines and deployments. Do not replace it as a
   routine deploy step. Key rotation requires a separate decrypt/re-encrypt plan.
3. Deploy this backend. Existing plaintext credentials migrate on first use.
   The missing key is an explicit authorization failure, not a plaintext fallback.
4. Run the batch migration inside the configured app environment:

   ```sh
   flyctl ssh console --app freetheroots-rewards-system -C 'node scripts/encrypt-shopify-tokens.js'
   ```

   The command reports counts only. It is safe to rerun, uses conditional writes,
   and does not overwrite concurrent token changes. Encrypted records are also
   authenticated with the configured key. Confirm no plaintext token fields remain
   using a metadata/count-only query. Old database backups still contain plaintext;
   secure their access and apply your backup retention policy.
5. Publish the Shopify configuration with the new uninstall subscription:

   ```sh
   shopify app deploy --config checkout-upsell-app
   ```

   This is a separate deployment and was not executed here. Review the app version
   changes before publishing; backend deployment alone does not install the webhook.
6. Open the app in a test store, redeem, and confirm the successful order commits
   the reward. Uninstall/reinstall only on an authorized disposable test store.
   Verify credentials are cleared after uninstall and renewed after app opening.
   Check field presence, prefix, expiry and timestamps only; never dump records.

## Automated verification

New crypto tests cover randomized encryption, key validation, tampering, wrong
keys, shop isolation and field isolation. MongoDB lifecycle tests cover migration,
uninstall duplication, late delivery, a replayed timestamp, migration during
refresh, and an in-flight exchange completing after uninstall. HTTP acceptance
checks exercise the real router and HMAC verification with mocked Shopify reads.
CI runs the lifecycle and HTTP tests in the existing MongoDB acceptance job.

Final local verification on Node 22: 79 passed, 4 skipped, 0 failed. An independent
code review identified unsigned-timestamp replay and migration/refresh contention;
both have regression tests observed failing before their fixes and passing after.

Local tests use isolated MongoDB on port 27127, a local backend on port 3117,
fabricated credentials, and mocked Shopify responses for the new tests. Live
Shopify synchronization tests remain opt-in. Four existing business-replay checks
skip on an empty test database because they require historical transactions.

Rollback must retain encryption-aware code and the same key. A pre-encryption
backend cannot read encrypted fields; do not simply roll back the binary after
migration. Use a reviewed recovery plan or reauthorize stores on a compatible build.
