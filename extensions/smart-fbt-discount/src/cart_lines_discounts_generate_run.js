const EMPTY_RESULT = { operations: [] };
const REQUIRED_BUNDLE_LINES = 3;
const PRODUCT_DISCOUNT_CLASS = "PRODUCT";
const ALL_SELECTION_STRATEGY = "ALL";

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function parsePercentage(value) {
  const number = Number(clean(value));
  return Number.isFinite(number) && number > 0 && number <= 100 ? number : null;
}

function isBundleLine(line) {
  return clean(line?.fbtBundle?.value).toLowerCase() === "true" &&
    Boolean(clean(line?.fbtBundleId?.value)) &&
    Number(line?.quantity || 0) > 0;
}

function merchandiseId(line) {
  return clean(line?.merchandise?.id);
}

export function cartLinesDiscountsGenerateRun(input) {
  const discountClasses = input?.discount?.discountClasses || [];
  if (!discountClasses.includes(PRODUCT_DISCOUNT_CLASS)) return EMPTY_RESULT;

  const groups = new Map();

  for (const line of input?.cart?.lines || []) {
    if (!isBundleLine(line)) continue;

    const bundleId = clean(line.fbtBundleId.value);
    const percentage = parsePercentage(line?.fbtDiscountPercentage?.value);
    if (percentage == null) continue;

    if (!groups.has(bundleId)) groups.set(bundleId, []);
    groups.get(bundleId).push({ line, percentage });
  }

  const candidates = [];

  for (const entries of groups.values()) {
    if (entries.length < REQUIRED_BUNDLE_LINES) continue;

    const percentages = new Set(entries.map((entry) => entry.percentage));
    if (percentages.size !== 1) continue;

    const distinctVariantIds = new Set(
      entries.map((entry) => merchandiseId(entry.line)).filter(Boolean),
    );
    if (distinctVariantIds.size < REQUIRED_BUNDLE_LINES) continue;

    const percentage = entries[0].percentage;
    const targets = entries.map((entry) => ({
      cartLine: {
        id: entry.line.id,
        quantity: 1,
      },
    }));

    candidates.push({
      message: `Bundle ${percentage}% off`,
      targets,
      value: {
        percentage: {
          value: percentage,
        },
      },
    });
  }

  if (!candidates.length) return EMPTY_RESULT;

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ALL_SELECTION_STRATEGY,
        },
      },
    ],
  };
}
