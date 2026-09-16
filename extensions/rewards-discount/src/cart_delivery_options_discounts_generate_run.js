const EMPTY = { operations: [] };

export function cartDeliveryOptionsDiscountsGenerateRun(input) {
  const cfg = input?.discount?.metafield?.jsonValue;
  if (!cfg || typeof cfg !== "object" || cfg.type !== "FREE_SHIPPING") return EMPTY;
  if (!(input?.discount?.discountClasses || []).includes("SHIPPING")) return EMPTY;

  const minimum = Number(cfg.minimumSpend || 0);
  const subtotal = Number(input?.cart?.cost?.subtotalAmount?.amount || 0);
  if (!Number.isFinite(minimum) || subtotal < minimum) return EMPTY;

  const targets = (input?.cart?.deliveryGroups || []).map((group) => ({ deliveryGroup: { id: group.id } }));
  if (!targets.length) return EMPTY;

  return {
    operations: [{
      deliveryDiscountsAdd: {
        candidates: [{ message: "FreeTheRoots free shipping reward", targets, value: { percentage: { value: 100 } } }],
        selectionStrategy: "ALL",
      },
    }],
  };
}
