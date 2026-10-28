const EMPTY = { operations: [] };

function config(input) {
  const value = input?.discount?.metafield?.jsonValue;
  return value && typeof value === "object" ? value : null;
}

function eligible(input, cfg) {
  const minimum = Number(cfg?.minimumSpend || 0);
  const subtotal = Number(input?.cart?.cost?.subtotalAmount?.amount || 0);
  return Number.isFinite(minimum) && subtotal >= minimum;
}

function productTargets(input, productId) {
  return (input?.cart?.lines || [])
    .filter((line) => line?.merchandise?.product?.id === productId)
    .map((line) => ({ cartLine: { id: line.id } }));
}

function referralConfig(input, cfg) {
  const firstOrder = cfg.referralFirstOrder === true;
  const gift = cfg.referralGift === true;
  if (!firstOrder && !gift) return cfg;
  const identity = input?.cart?.buyerIdentity;
  const customer = identity?.customer;
  if (identity?.isAuthenticated !== true ||
      !/^gid:\/\/shopify\/Customer\/[1-9]\d*$/.test(cfg.shopifyCustomerId || "") ||
      customer?.id !== cfg.shopifyCustomerId) return null;
  if (firstOrder && (gift || cfg.type !== "FIXED_DISCOUNT" ||
      !Number.isInteger(customer.numberOfOrders) || customer.numberOfOrders !== 0)) return null;
  if (gift && (cfg.type !== "FREE_PRODUCT" ||
      !/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(cfg.variantId || "") ||
      !Number.isInteger(cfg.giftQuantity) || cfg.giftQuantity < 1 || cfg.giftQuantity > 10)) return null;
  const rate = Number(input?.presentmentCurrencyRate);
  const minimum = Number(cfg.minimumSpend ?? 0);
  const amount = Number(cfg.discountValue);
  if (!Number.isFinite(rate) || rate <= 0 ||
      !Number.isFinite(minimum) || minimum < 0 ||
      (firstOrder && (!Number.isFinite(amount) || amount <= 0))) return null;
  const minimumSpend = minimum * rate;
  const discountValue = firstOrder ? amount * rate : cfg.discountValue;
  if (!Number.isFinite(minimumSpend) || (firstOrder && !Number.isFinite(discountValue))) return null;
  return { ...cfg, minimumSpend, discountValue };
}

function giftTargets(input, cfg) {
  let remaining = cfg.giftQuantity;
  const targets = [];
  for (const line of input?.cart?.lines || []) {
    if (remaining === 0) break;
    if (line?.merchandise?.id !== cfg.variantId || !Number.isInteger(line.quantity) || line.quantity <= 0) continue;
    const quantity = Math.min(line.quantity, remaining);
    targets.push({ cartLine: { id: line.id, quantity } });
    remaining -= quantity;
  }
  return targets;
}

export function cartLinesDiscountsGenerateRun(input) {
  const rawConfig = config(input);
  const cfg = rawConfig && referralConfig(input, rawConfig);
  if (!cfg || !eligible(input, cfg)) return EMPTY;

  const classes = input?.discount?.discountClasses || [];
  const type = String(cfg.type || "");
  if (type === "FREE_SHIPPING") return EMPTY;

  // Collection-scoped rewards need a dedicated eligibility source. Fail closed rather
  // than accidentally applying a collection reward store-wide.
  if (cfg.collectionId) return EMPTY;

  if (type === "FREE_PRODUCT") {
    if (!classes.includes("PRODUCT") || (cfg.referralGift !== true && !cfg.productId)) return EMPTY;
    const targets = cfg.referralGift === true ? giftTargets(input, cfg) : productTargets(input, cfg.productId);
    if (!targets.length) return EMPTY;
    return { operations: [{ productDiscountsAdd: { candidates: [{ message: "Free reward", targets, value: { percentage: { value: 100 } } }], selectionStrategy: "FIRST" } }] };
  }

  const numericValue = Number(cfg.discountValue || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return EMPTY;
  const value = type === "PERCENTAGE_DISCOUNT"
    ? { percentage: { value: Math.min(100, numericValue) } }
    : type === "FIXED_DISCOUNT"
      ? { fixedAmount: { amount: numericValue } }
      : null;
  if (!value) return EMPTY;

  if (cfg.productId) {
    if (!classes.includes("PRODUCT")) return EMPTY;
    const targets = productTargets(input, cfg.productId);
    if (!targets.length) return EMPTY;
    return { operations: [{ productDiscountsAdd: { candidates: [{ message: "FreeTheRoots reward", targets, value }], selectionStrategy: "FIRST" } }] };
  }

  if (!classes.includes("ORDER")) return EMPTY;
  return { operations: [{ orderDiscountsAdd: { candidates: [{ message: "FreeTheRoots reward", targets: [{ orderSubtotal: { excludedCartLineIds: [] } }], value }], selectionStrategy: "FIRST" } }] };
}
