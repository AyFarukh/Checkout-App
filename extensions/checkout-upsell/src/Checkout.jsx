import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useMemo, useState} from 'preact/hooks';

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [addingId, setAddingId] = useState(null);
  const [error, setError] = useState('');
  const [products, setProducts] = useState([]);

  const lines = shopify.lines.value;
  const settings = shopify.settings.value;

  const cartProductIds = useMemo(
    () => new Set(lines.map((line) => line.merchandise?.product?.id).filter(Boolean)),
    [lines],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadUpsells() {
      setError('');

      const fixedProductId = settings?.fixed_product;
      const triggerProductIds = [...cartProductIds];

      // The app backend/rules endpoint will replace this placeholder once the
      // Shopify app is linked and its authenticated backend URL is available.
      // Until then the extension safely renders nothing.
      if (!fixedProductId && triggerProductIds.length === 0) {
        setProducts([]);
        return;
      }

      // Fixed product references and contextual rules are resolved in the next
      // implementation step via Storefront API/app-owned configuration.
      if (!cancelled) setProducts([]);
    }

    loadUpsells();
    return () => {
      cancelled = true;
    };
  }, [settings?.fixed_product, lines]);

  async function addVariant(variantId) {
    setAddingId(variantId);
    setError('');

    const result = await shopify.applyCartLinesChange({
      type: 'addCartLine',
      merchandiseId: variantId,
      quantity: 1,
    });

    if (result.type === 'error') {
      setError(result.message || 'Unable to add this item.');
    }

    setAddingId(null);
  }

  if (!products.length) return null;

  return (
    <s-stack gap="base">
      <s-heading>{settings?.heading || 'ELEVATE YOUR ROUTINE'}</s-heading>

      {products.map((product) => (
        <s-box key={product.variantId} border="base" borderRadius="base" padding="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            {product.image ? (
              <s-image src={product.image} alt={product.title} accessibilityDescription={product.title} />
            ) : null}
            <s-stack gap="small-200">
              <s-text emphasis="bold">{product.title}</s-text>
              <s-text>{product.price}</s-text>
            </s-stack>
            <s-button
              variant="secondary"
              loading={addingId === product.variantId}
              disabled={Boolean(addingId)}
              onClick={() => addVariant(product.variantId)}
            >
              Add
            </s-button>
          </s-stack>
        </s-box>
      ))}

      {error ? <s-banner tone="critical">{error}</s-banner> : null}
    </s-stack>
  );
}
