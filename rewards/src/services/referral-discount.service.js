import { shopifyAdminGraphql, validateShopifyAdminConfiguration, assertNoUserErrors } from "./shopify-admin.service.js";

// Deterministic code + opaque title allow safe recovery if Shopify creates the
// discount but the response or subsequent MongoDB write is lost.
export async function createReferralDiscount({ shop, code, reference, customerId, config, expiresAt }) {
  const title = `FTR referral ${reference}`;
  const existing = await findReferralDiscount({ shop, code, reference });
  if (existing) return { ...existing, code };
  const { functionId } = await validateShopifyAdminConfiguration(shop);
  const data = await shopifyAdminGraphql(shop, `mutation ReferralDiscountCreate($input: DiscountCodeAppInput!) {
    discountCodeAppCreate(codeAppDiscount: $input) { codeAppDiscount { discountId } userErrors { field message } }
  }`, { input: { title, code, functionId, discountClasses: [config.referralGift ? "PRODUCT" : "ORDER"],
    context: { customers: { add: [customerId] } }, startsAt: new Date().toISOString(), endsAt: expiresAt.toISOString(), usageLimit: 1, appliesOncePerCustomer: true,
    combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
    metafields: [{ namespace: "freetheroot_rewards", key: "function-configuration", type: "json", value: JSON.stringify({ schemaVersion: 2, ...config, shopifyCustomerId: customerId }) }] } });
  const payload = assertNoUserErrors(data?.discountCodeAppCreate);
  if (!payload?.codeAppDiscount?.discountId) throw new Error("Referral discount creation returned no ID");
  return { discountId: payload.codeAppDiscount.discountId, code };
}

export async function findReferralDiscount({ shop, code, reference }) {
  const title = `FTR referral ${reference}`;
  const found = await shopifyAdminGraphql(shop, `query ReferralDiscountRecovery($code: String!) {
    codeDiscountNodeByCode(code: $code) { id codeDiscount { ... on DiscountCodeApp { title } } }
  }`, { code });
  if (found?.codeDiscountNodeByCode) {
    if (found.codeDiscountNodeByCode.codeDiscount?.title !== title) throw Object.assign(new Error("Referral code collision"), { permanent: true });
    return { discountId: found.codeDiscountNodeByCode.id, code };
  }
  return null;
}

export async function setReferralDiscountActive(shop, id, active) {
  const mutation = active ? "discountCodeActivate" : "discountCodeDeactivate";
  const result = await shopifyAdminGraphql(shop, `mutation ReferralDiscountState($id: ID!) {
    ${mutation}(id: $id) { codeDiscountNode { id } userErrors { field message } }
  }`, { id });
  assertNoUserErrors(result?.[mutation]);
}
