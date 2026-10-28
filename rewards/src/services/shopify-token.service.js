import { ShopifyOfflineToken } from "../models/ShopifyOfflineToken.js";
import { randomUUID } from "node:crypto";
import { encryptToken, decryptToken, isEncryptedToken, assertTokenEncryptionConfigured } from "./token-encryption.service.js";

const SKEW = 60_000;

export function shopifyReauthRequired() {
  return Object.assign(new Error("Shopify authorization needs renewal. Open the app in this store's Shopify admin, then retry."), {
    code: "SHOPIFY_REAUTH_REQUIRED", statusCode: 409, permanent: true,
  });
}

function creds() {
  const clientId = String(process.env.SHOPIFY_API_KEY || "").trim();
  const clientSecret = String(process.env.SHOPIFY_API_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error("SHOPIFY_API_KEY and SHOPIFY_API_SECRET are required for Shopify token exchange"), {
      permanent: true,
      code: "SHOPIFY_APP_CREDENTIALS_MISSING",
    });
  }
  return { clientId, clientSecret };
}

async function request(shop, params) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw Object.assign(
      // Do not surface arbitrary provider response text in logs or API errors.
      new Error(`Shopify token endpoint returned HTTP ${response.status}`),
      {
        code: "SHOPIFY_TOKEN_EXCHANGE_FAILED",
        permanent: response.status >= 400 && response.status < 500,
        shopifyStatus: response.status,
      },
    );
  }
  return json;
}

async function persist(shop, payload, { startedAt, previous } = {}) {
  const now = Date.now();
  const filter = previous
    ? { shop, _id: previous._id, credentialVersion: previous.credentialVersion || null, uninstalledAt: null }
    : { shop, acquiredAt: { $not: { $gt: startedAt } }, uninstalledAt: { $not: { $gte: startedAt } } };
  let result;
  try { result = await ShopifyOfflineToken.findOneAndUpdate(
    filter,
    {
      $set: {
        accessToken: encryptToken(payload.access_token, shop, "access"),
        refreshToken: encryptToken(payload.refresh_token || null, shop, "refresh"),
        accessTokenExpiresAt: payload.expires_in ? new Date(now + Number(payload.expires_in) * 1000) : null,
        refreshTokenExpiresAt: payload.refresh_token_expires_in ? new Date(now + Number(payload.refresh_token_expires_in) * 1000) : null,
        scope: payload.scope || "",
        uninstalledAt: null,
        credentialVersion: randomUUID(),
        ...(previous ? { refreshedAt: new Date() } : { acquiredAt: startedAt }),
      },
    },
    { upsert: !previous, new: true, runValidators: true, setDefaultsOnInsert: false },
  ); } catch (error) {
    // The unique shop index rejects stale exchanges that would overwrite a
    // newer installation or an uninstall marker. Never resurrect credentials.
    if (error.code === 11000) throw shopifyReauthRequired();
    throw error;
  }
  if (!result) throw shopifyReauthRequired();
  return result;
}

export async function exchangeOfflineToken({ shop, idToken }) {
  assertTokenEncryptionConfigured();
  const startedAt = new Date();
  const { clientId, clientSecret } = creds();
  console.log(`[Rewards Auth] exchanging Shopify offline token for ${shop}`);
  const payload = await request(shop, {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: idToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    client_id: clientId,
    client_secret: clientSecret,
    expiring: "1",
  });
  await persist(shop, payload, { startedAt });
  console.log(`[Rewards Auth] offline Shopify token stored for ${shop}`);
  return {
    shop,
    expiresIn: payload.expires_in || null,
    refreshTokenExpiresIn: payload.refresh_token_expires_in || null,
  };
}

async function refresh(record) {
  if (!record.refreshToken || (record.refreshTokenExpiresAt && record.refreshTokenExpiresAt.getTime() <= Date.now())) {
    throw shopifyReauthRequired();
  }
  assertTokenEncryptionConfigured();
  const { clientId, clientSecret } = creds();
  let payload;
  try { payload = await request(record.shop, {
    grant_type: "refresh_token",
    refresh_token: decryptToken(record.refreshToken, record.shop, "refresh"),
    client_id: clientId,
    client_secret: clientSecret,
  }); } catch (error) {
    if (error.shopifyStatus === 400 || error.shopifyStatus === 401) throw shopifyReauthRequired();
    throw error;
  }
  return persist(record.shop, payload, { previous: record });
}

export async function revokeOfflineTokenForShop(shop, triggeredAt) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !Number.isFinite(triggeredAt?.getTime())) {
    throw Object.assign(new Error("Invalid Shopify uninstall metadata"), { statusCode: 400 });
  }
  const current = await ShopifyOfflineToken.findOne({ shop });
  if (current?.acquiredAt > triggeredAt || current?.uninstalledAt > triggeredAt) return;
  // Shopify signs the body, not the timestamp header. An old signed payload
  // must not revoke a reinstalled app even if its header timestamp is replaced.
  if (current?.accessToken && !current.uninstalledAt) {
    let token;
    try { token = await storedOfflineTokenForShop(shop); }
    catch (error) { if (error.code !== "SHOPIFY_REAUTH_REQUIRED") throw error; }
    if (token) {
      const response = await fetch(`https://${shop}/admin/api/${process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07"}/graphql.json`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query: "query UninstallAuthorization { shop { id } }" }),
        signal: AbortSignal.timeout(3000),
      });
      if (response.status !== 401) {
        const data = await response.json().catch(() => ({}));
        if (response.ok && data?.data?.shop?.id) return;
        throw Object.assign(new Error("Shopify uninstall authorization verification unavailable"), { retryable: true });
      }
    }
  }
  try {
    await ShopifyOfflineToken.findOneAndUpdate(
      { shop, credentialVersion: current?.credentialVersion || null, acquiredAt: { $not: { $gt: triggeredAt } }, uninstalledAt: { $not: { $gt: triggeredAt } } },
      { $set: { accessToken: null, refreshToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null, scope: "", uninstalledAt: triggeredAt } },
      { upsert: true, setDefaultsOnInsert: false },
    );
  } catch (error) {
    if (error.code !== 11000) throw error; // a newer installation/event wins
  }
}

export async function migrateOfflineTokenRecord(record) {
  if (record.uninstalledAt || !record.accessToken) return;
  const accessToken = decryptToken(record.accessToken, record.shop, "access");
  const refreshToken = decryptToken(record.refreshToken, record.shop, "refresh");
  if (isEncryptedToken(record.accessToken) && (!record.refreshToken || isEncryptedToken(record.refreshToken))) return;
  await ShopifyOfflineToken.updateOne(
    { _id: record._id, accessToken: record.accessToken, refreshToken: record.refreshToken, uninstalledAt: null },
    { $set: {
      accessToken: encryptToken(accessToken, record.shop, "access"),
      refreshToken: encryptToken(refreshToken, record.shop, "refresh"),
    } },
  );
}

export async function storedOfflineTokenForShop(shop) {
  let record = await ShopifyOfflineToken.findOne({ shop });
  if (!record) return null;
  if (record.uninstalledAt || !record.accessToken) throw shopifyReauthRequired();
  if (!record.accessTokenExpiresAt || record.accessTokenExpiresAt.getTime() > Date.now() + SKEW) {
    const token = decryptToken(record.accessToken, shop, "access");
    await migrateOfflineTokenRecord(record);
    return token;
  }
  record = await refresh(record);
  return decryptToken(record.accessToken, shop, "access");
}

export async function ensureOfflineTokenForAdminSession({ shop, idToken }) {
  if (!idToken) {
    throw Object.assign(new Error("A fresh Shopify ID token is required to authorize background reward sync"), {
      statusCode: 401,
      code: "SHOPIFY_ID_TOKEN_REQUIRED",
    });
  }
  // The route verifies this ID token and derives shop from its signed destination.
  // Reinstall revokes tokens before their local expiry. Always acquire from the
  // fresh admin session rather than trusting or refreshing the old installation.
  await exchangeOfflineToken({ shop, idToken });
  const persisted = await storedOfflineTokenForShop(shop);
  if (!persisted) throw new Error("Shopify offline token was not persisted");
  return { shop, status: "authorized" };
}
