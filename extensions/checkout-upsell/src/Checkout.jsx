import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useMemo, useState} from 'preact/hooks';

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [addingId, setAddingId] = useState(null);
  const [error, setError] = useState('');

  const lines = shopify.lines.value || [];
  const settings = shopify.settings.value || {};
  const instructions = shopify.instructions?.value || shopify.instructions?.current;

  const cartVariantIds = useMemo(
    () => new Set(lines.map((line) => line.merchandise?.id).filter(Boolean)),
    [lines],
  );

  const fixedProduct = settings.fixed_product;
  const product = normalizeProductReference(fixedProduct);

  const canAddCartLine = instructions?.lines?.canAddCartLine !== false;
  const isAlreadyInCheckout = product?.variantId
    ? cartVariantIds.has(product.variantId)
    : false;

  async function addVariant(variantId) {
    if (!variantId || !canAddCartLine) return;

    setAddingId(variantId);
    setError('');

    try {
      const result = await shopify.applyCartLinesChange({
        type: 'addCartLine',
        merchandiseId: variantId,
        quantity: 1,
      });

      if (result.type === 'error') {
        setError(result.message || 'Unable to add this item.');
      }
    } catch (err) {
      setError(err?.message || 'Unable to add this item.');
    } finally {
      setAddingId(null);
    }
  }

  if (!product || isAlreadyInCheckout) return null;

  return (
    <s-stack gap="base">
      <s-heading>{settings.heading || 'ELEVATE YOUR ROUTINE'}</s-heading>

      <s-box border="base" borderRadius="base" padding="base">
        <s-stack direction="inline" gap="base" alignItems="center">
          {product.image ? (
            <s-image
              src={product.image}
              alt={product.title}
              accessibilityDescription={product.title}
            />
          ) : null}

          <s-stack gap="small-200">
            <s-text emphasis="bold">{product.title}</s-text>
            {product.price ? <s-text>{product.price}</s-text> : null}
          </s-stack>

          <s-button
            variant="secondary"
            loading={addingId === product.variantId}
            disabled={Boolean(addingId) || !canAddCartLine}
            onClick={() => addVariant(product.variantId)}
          >
            Add
          </s-button>
        </s-stack>
      </s-box>

      {!canAddCartLine ? (
        <s-banner tone="warning">This checkout cannot be modified.</s-banner>
      ) : null}

      {error ? <s-banner tone="critical">{error}</s-banner> : null}
    </s-stack>
  );
}

function normalizeProductReference(reference) {
  if (!reference) return null;

  // Shopify product_reference settings may resolve to an object containing the
  // product and variants. We intentionally select the first available variant
  // for the fixed offer. Contextual multi-rule offers will be supplied by the
  // app backend in the next implementation layer.
  const variant =
    reference.variant ||
    reference.selectedOrFirstAvailableVariant ||
    reference.variants?.nodes?.[0] ||
    reference.variants?.[0];

  const variantId = variant?.id;
  if (!variantId) return null;

  const amount = variant?.price?.amount || variant?.price;
  const currency = variant?.price?.currencyCode || reference?.priceRange?.minVariantPrice?.currencyCode;

  return {
    title: reference.title || variant.title || 'Recommended product',
    variantId,
    image: reference.featuredImage?.url || reference.image?.url || reference.image || null,
    price: formatMoney(amount, currency),
  };
}

function formatMoney(amount, currency) {
  if (amount === undefined || amount === null || amount === '') return '';
  const numeric = Number(amount);
  if (Number.isNaN(numeric)) return String(amount);

  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
    }).format(numeric);
  } catch {
    return currency ? `${currency} ${numeric.toFixed(2)}` : numeric.toFixed(2);
  }
}
