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

export function cartLinesDiscountsGenerateRun(input) {
  const cfg = config(input);
  if (!cfg || !eligible(input, cfg)) return EMPTY;

  const classes = input?.discount?.discountClasses || [];
  const type = String(cfg.type || "");
  if (type === "FREE_SHIPPING") return EMPTY;

  // Collection-scoped rewards need a dedicated eligibility source. Fail closed rather
  // than accidentally applying a collection reward store-wide.
  if (cfg.collectionId) return EMPTY;

  if (type === "FREE_PRODUCT") {
    if (!classes.includes("PRODUCT") || !cfg.productId) return EMPTY;
    const targets = productTargets(input, cfg.productId);
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
