/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useMemo, useState} from 'preact/hooks';

export default async () => {
  render(<Extension />, document.body);
};

const VARIANT_QUERY = `
  query UpsellVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        availableForSale
        price {
          amount
          currencyCode
        }
        image {
          url
          altText
        }
        product {
          id
          title
          featuredImage {
            url
            altText
          }
        }
      }
    }
  }
`;

function Extension() {
  const [addingId, setAddingId] = useState(null);
  const [error, setError] = useState('');
  const [variantMap, setVariantMap] = useState(new Map());
  const [loading, setLoading] = useState(false);

  const lines = shopify.lines.value || [];
  const settings = shopify.settings.value || {};
  const instructions = shopify.instructions?.value || shopify.instructions?.current;

  const cartVariantIds = useMemo(
    () => new Set(lines.map((line) => line.merchandise?.id).filter(Boolean)),
    [lines],
  );

  const cartProductIds = useMemo(
    () => new Set(lines.map((line) => line.merchandise?.product?.id).filter(Boolean)),
    [lines],
  );

  const configuredIds = useMemo(() => {
    return unique(
      [
        settings.fixed_product,
        settings.fixed_product_2,
        settings.fixed_product_3,
        settings.rule_1_trigger,
        settings.rule_1_offer,
        settings.rule_2_trigger,
        settings.rule_2_offer,
        settings.rule_3_trigger,
        settings.rule_3_offer,
      ].filter(Boolean),
    );
  }, [
    settings.fixed_product,
    settings.fixed_product_2,
    settings.fixed_product_3,
    settings.rule_1_trigger,
    settings.rule_1_offer,
    settings.rule_2_trigger,
    settings.rule_2_offer,
    settings.rule_3_trigger,
    settings.rule_3_offer,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadVariants() {
      if (!configuredIds.length) {
        setVariantMap(new Map());
        return;
      }

      setLoading(true);
      setError('');

      try {
        const {data, errors} = await shopify.query(VARIANT_QUERY, {
          variables: {ids: configuredIds},
          version: '2026-07',
        });

        if (errors?.length) {
          throw new Error(errors.map((item) => item.message).join(', '));
        }

        const nextMap = new Map();
        for (const node of data?.nodes || []) {
          if (node?.id) nextMap.set(node.id, node);
        }

        if (!cancelled) setVariantMap(nextMap);
      } catch (err) {
        if (!cancelled) {
          setVariantMap(new Map());
          setError(err?.message || 'Unable to load upsell products.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadVariants();

    return () => {
      cancelled = true;
    };
  }, [configuredIds.join('|')]);

  const offers = useMemo(() => {
    const result = [];

    const addOffer = (variantId, source) => {
      if (!variantId || cartVariantIds.has(variantId)) return;

      const variant = variantMap.get(variantId);
      if (!variant || variant.availableForSale === false) return;
      if (result.some((item) => item.variantId === variantId)) return;

      result.push(normalizeVariant(variant, source));
    };

    // Fixed offers are always eligible unless the exact variant is already in checkout.
    addOffer(settings.fixed_product, 'fixed');
    addOffer(settings.fixed_product_2, 'fixed');
    addOffer(settings.fixed_product_3, 'fixed');

    const rules = [
      [settings.rule_1_trigger, settings.rule_1_offer],
      [settings.rule_2_trigger, settings.rule_2_offer],
      [settings.rule_3_trigger, settings.rule_3_offer],
    ];

    for (const [triggerId, offerId] of rules) {
      if (!triggerId || !offerId) continue;

      const triggerVariant = variantMap.get(triggerId);
      const triggerProductId = triggerVariant?.product?.id;

      // Match either the exact configured variant or any variant belonging to
      // the same product. This makes the rule behave like a product-based rule.
      const matchesCart =
        cartVariantIds.has(triggerId) ||
        (triggerProductId ? cartProductIds.has(triggerProductId) : false);

      if (matchesCart) addOffer(offerId, 'conditional');
    }

    return result;
  }, [
    variantMap,
    cartVariantIds,
    cartProductIds,
    settings.fixed_product,
    settings.fixed_product_2,
    settings.fixed_product_3,
    settings.rule_1_trigger,
    settings.rule_1_offer,
    settings.rule_2_trigger,
    settings.rule_2_offer,
    settings.rule_3_trigger,
    settings.rule_3_offer,
  ]);

  const canAddCartLine = instructions?.lines?.canAddCartLine !== false;

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

  if (!configuredIds.length) return null;
  if (loading && !variantMap.size) return null;
  if (!offers.length && !error) return null;

  return (
    <s-stack gap="base">
      {offers.length ? (
        <s-heading>{settings.heading || 'ELEVATE YOUR ROUTINE'}</s-heading>
      ) : null}

      {offers.map((product) => (
        <s-box
          key={product.variantId}
          border="base"
          borderRadius="base"
          padding="base"
        >
          <s-stack direction="inline" gap="base" alignItems="center">
            {product.image ? (
              <s-image
                src={product.image}
                alt={product.imageAlt || product.title}
                accessibilityDescription={product.imageAlt || product.title}
              />
            ) : null}

            <s-stack gap="small-200">
              <s-text emphasis="bold">{product.title}</s-text>
              {product.variantTitle && product.variantTitle !== 'Default Title' ? (
                <s-text tone="subdued">{product.variantTitle}</s-text>
              ) : null}
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
      ))}

      {!canAddCartLine && offers.length ? (
        <s-banner tone="warning">This checkout cannot be modified.</s-banner>
      ) : null}

      {error ? <s-banner tone="critical">{error}</s-banner> : null}
    </s-stack>
  );
}

function normalizeVariant(variant, source) {
  return {
    source,
    variantId: variant.id,
    title: variant.product?.title || variant.title || 'Recommended product',
    variantTitle: variant.title || '',
    image: variant.image?.url || variant.product?.featuredImage?.url || null,
    imageAlt:
      variant.image?.altText ||
      variant.product?.featuredImage?.altText ||
      variant.product?.title ||
      variant.title ||
      'Recommended product',
    price: formatMoney(variant.price?.amount, variant.price?.currencyCode),
  };
}

function unique(values) {
  return [...new Set(values)];
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
