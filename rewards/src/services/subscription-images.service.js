import { shopifyAdminGraphql } from "./shopify-admin.service.js";

const gid = (value, kind) => {
  const match = String(value ?? "").match(/(?:^|\/)\d+$/);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, "");
  return digits ? `gid://shopify/${kind}/${digits}` : null;
};
const keys = ["lines", "lineItems", "subscriptionLines", "items", "products", "subscriptionProducts"];
const group = (subscription) => keys.find(key => Array.isArray(subscription?.[key]));
const ids = line => ({
  variant: gid(line.variantId || line.shopifyVariantId || line.shopify_variant_id || line.variant?.id, "ProductVariant"),
  product: gid(line.productId || line.shopifyProductId || line.shopify_product_id || line.product?.id, "Product"),
});

export async function enrichSubscriptionImages(shop, subscriptions) {
  const all = new Set();
  for (const subscription of subscriptions) {
    for (const line of subscription[group(subscription)] || []) {
      const { variant, product } = ids(line);
      if (variant) all.add(variant);
      if (product) all.add(product);
    }
  }
  const requested = [...all].slice(0, 100);
  
  let nodes;
  try {
    const result = requested.length ? await shopifyAdminGraphql(shop, `query SubscriptionProductImages($ids:[ID!]!){nodes(ids:$ids){... on Product{id title featuredImage{url}} ... on ProductVariant{id image{url} product{id title featuredImage{url}}}}}`, { ids: requested }) : { nodes: [] };
    nodes = new Map((result?.nodes || []).filter(Boolean).map(node => [node.id, node]));
  } catch (error) {
    console.warn("[Subscription images] Shopify lookup failed:", error.message);
    return subscriptions;
  }
  const titles = [...new Set(subscriptions.flatMap(subscription => (subscription[group(subscription)] || []).map(line => String(line.productTitle || line.title || line.name || "").trim()).filter(Boolean)))].slice(0, 20);
  const titleImages = new Map();
  for (const title of titles) {
    try {
      const response = await shopifyAdminGraphql(shop, `query SubscriptionTitleImage($query:String!){products(first:5,query:$query){nodes{title featuredImage{url}}}}`, { query: `title:${JSON.stringify(title)}` });
      const match = response?.products?.nodes?.find(p => p.title?.trim().toLowerCase() === title.toLowerCase());
      if (match?.featuredImage?.url) titleImages.set(title.toLowerCase(), match.featuredImage.url);
    } catch (error) { console.warn("[Subscription images] Title lookup unavailable:", error.message); break; }
  }
  return subscriptions.map(subscription => {
    const key = group(subscription);
    if (!key) return subscription;
    return { ...subscription, [key]: subscription[key].map(line => {
      const { variant, product } = ids(line);
      const v = nodes.get(variant);
      const p = nodes.get(product) || v?.product;
      const imageUrl = v?.image?.url || p?.featuredImage?.url || titleImages.get(String(line.productTitle || line.title || line.name || "").trim().toLowerCase());
      return { ...line, ...(imageUrl ? { imageUrl } : {}), ...(!line.title && !line.productTitle && p?.title ? { productTitle: p.title } : {}) };
    }) };
  });
}
