/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useMemo, useState} from 'preact/hooks';

export default async () => {
  render(<Extension />, document.body);
};

const VARIANT_FIELDS = `
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
`;

const VARIANT_QUERY = `
  query UpsellVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        ${VARIANT_FIELDS}
      }
    }
  }
`;

const CART_VARIANT_METAFIELD_QUERY = `
  query CartVariantMetafieldUpsells(
    $ids: [ID!]!
    $namespace: String!
    $key: String!
  ) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        product {
          id
          metafield(namespace: $namespace, key: $key) {
            type
            value
            reference {
              ... on ProductVariant {
                ${VARIANT_FIELDS}
              }
            }
            references(first: 50) {
              nodes {
                ... on ProductVariant {
                  ${VARIANT_FIELDS}
                }
              }
            }
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
  const [metafieldVariants, setMetafieldVariants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [metafieldLoading, setMetafieldLoading] = useState(false);

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

  const metafieldNamespace = String(settings.metafield_namespace || 'custom').trim();
  const metafieldKey = String(settings.metafield_key || 'checkout_upsell_variant').trim();
  const metafieldUpsellsEnabled = settings.enable_metafield_upsells !== false;

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

        if (errors?.length) throw new Error(errors.map((item) => item.message).join(', '));

        const nextMap = new Map();
        for (const node of data?.nodes || []) {
          if (node?.id) nextMap.set(node.id, node);
        }

        if (!cancelled) setVariantMap(nextMap);
      } catch (err) {
        if (!cancelled) {
          setVariantMap(new Map());
          setError(err?.message || 'Unable to load configured upsell products.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadVariants();
    return () => { cancelled = true; };
  }, [configuredIds.join('|')]);

  useEffect(() => {
    let cancelled = false;

    async function loadMetafieldUpsells() {
      const checkoutVariantIds = [...cartVariantIds];

      if (!metafieldUpsellsEnabled || !checkoutVariantIds.length || !metafieldNamespace || !metafieldKey) {
        setMetafieldVariants([]);
        return;
      }

      setMetafieldLoading(true);
      setError('');

      try {
        const {data, errors} = await shopify.query(CART_VARIANT_METAFIELD_QUERY, {
          variables: {
            ids: checkoutVariantIds,
            namespace: metafieldNamespace,
            key: metafieldKey,
          },
          version: '2026-07',
        });

        if (errors?.length) throw new Error(errors.map((item) => item.message).join(', '));

        const nextVariants = [];
        const fallbackIds = [];
        const processedProductIds = new Set();

        for (const cartVariant of data?.nodes || []) {
          const product = cartVariant?.product;
          if (!product?.id || processedProductIds.has(product.id)) continue;
          processedProductIds.add(product.id);

          const metafield = product.metafield;
          if (!metafield) continue;

          for (const reference of metafield.references?.nodes || []) {
            if (reference?.id && reference.availableForSale !== false) nextVariants.push(reference);
          }

          const singleReference = metafield.reference;
          if (singleReference?.id && singleReference.availableForSale !== false) {
            nextVariants.push(singleReference);
          }

          for (const id of extractVariantIdsFromMetafieldValue(metafield.value)) fallbackIds.push(id);
        }

        if (fallbackIds.length) {
          const fallbackVariants = await loadVariantsByIds(unique(fallbackIds));
          for (const variant of fallbackVariants) {
            if (variant?.id && variant.availableForSale !== false) nextVariants.push(variant);
          }
        }

        if (!cancelled) {
          const deduped = [];
          const seen = new Set();
          for (const variant of nextVariants) {
            if (!variant?.id || seen.has(variant.id)) continue;
            seen.add(variant.id);
            deduped.push(variant);
          }
          setMetafieldVariants(deduped);
        }
      } catch (err) {
        if (!cancelled) {
          setMetafieldVariants([]);
          setError(err?.message || 'Unable to load product metafield upsells.');
        }
      } finally {
        if (!cancelled) setMetafieldLoading(false);
      }
    }

    async function loadVariantsByIds(ids) {
      if (!ids.length) return [];
      const {data, errors} = await shopify.query(VARIANT_QUERY, {
        variables: {ids},
        version: '2026-07',
      });
      if (errors?.length) throw new Error(errors.map((item) => item.message).join(', '));
      return (data?.nodes || []).filter(Boolean);
    }

    loadMetafieldUpsells();
    return () => { cancelled = true; };
  }, [[...cartVariantIds].join('|'), metafieldUpsellsEnabled, metafieldNamespace, metafieldKey]);

  const offers = useMemo(() => {
    const result = [];

    const addVariantOffer = (variant, source) => {
      if (!variant?.id || cartVariantIds.has(variant.id)) return;
      if (variant.availableForSale === false) return;
      if (result.some((item) => item.variantId === variant.id)) return;
      result.push(normalizeVariant(variant, source));
    };

    const addOffer = (variantId, source) => {
      if (!variantId || cartVariantIds.has(variantId)) return;
      const variant = variantMap.get(variantId);
      if (!variant) return;
      addVariantOffer(variant, source);
    };

    for (const variant of metafieldVariants) addVariantOffer(variant, 'metafield');

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
      const matchesCart = cartVariantIds.has(triggerId) || (triggerProductId ? cartProductIds.has(triggerProductId) : false);
      if (matchesCart) addOffer(offerId, 'conditional');
    }

    return result;
  }, [variantMap, metafieldVariants, cartVariantIds, cartProductIds, settings.fixed_product, settings.fixed_product_2, settings.fixed_product_3, settings.rule_1_trigger, settings.rule_1_offer, settings.rule_2_trigger, settings.rule_2_offer, settings.rule_3_trigger, settings.rule_3_offer]);

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
      if (result.type === 'error') setError(result.message || 'Unable to add this item.');
    } catch (err) {
      setError(err?.message || 'Unable to add this item.');
    } finally {
      setAddingId(null);
    }
  }

  const hasAnyConfiguration = configuredIds.length > 0 || (metafieldUpsellsEnabled && cartVariantIds.size > 0);

  if (!hasAnyConfiguration) return null;
  if ((loading || metafieldLoading) && !offers.length && !error) return null;
  if (!offers.length && !error) return null;

  return (
    <s-stack gap="base">
      {offers.length ? (
        <s-stack alignItems="center">
          <s-heading>{settings.heading || 'ELEVATE YOUR ROUTINE'}</s-heading>
        </s-stack>
      ) : null}

      {offers.map((product) => (
        <s-box
          key={product.variantId}
          border="base"
          borderRadius="large"
          padding="base"
        >
          <s-grid
            gridTemplateColumns="64px minmax(0, 1fr) auto"
            gap="base"
            alignItems="center"
          >
            <s-box
              inlineSize="64px"
              blockSize="64px"
              borderRadius="large"
              overflow="hidden"
            >
              {product.image ? (
                <s-image
                  src={product.image}
                  alt={product.imageAlt || product.title}
                  accessibilityDescription={product.imageAlt || product.title}
                  fit="cover"
                />
              ) : null}
            </s-box>

            <s-stack gap="small-100">
              <s-text emphasis="bold">{product.title}</s-text>
              {product.variantTitle && product.variantTitle !== 'Default Title' ? (
                <s-text tone="subdued">{product.variantTitle}</s-text>
              ) : null}
              {product.price ? (
                <s-text tone="accent">{product.price}</s-text>
              ) : null}
            </s-stack>

            <s-button
              variant="secondary"
              loading={addingId === product.variantId}
              disabled={Boolean(addingId) || !canAddCartLine}
              onClick={() => addVariant(product.variantId)}
            >
              Add
            </s-button>
          </s-grid>
        </s-box>
      ))}

      {!canAddCartLine && offers.length ? (
        <s-banner tone="warning">This checkout cannot be modified.</s-banner>
      ) : null}

      {error ? <s-banner tone="critical">{error}</s-banner> : null}
    </s-stack>
  );
}

function extractVariantIdsFromMetafieldValue(value) {
  if (!value || typeof value !== 'string') return [];
  if (value.startsWith('gid://shopify/ProductVariant/')) return [value];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === 'string' && id.startsWith('gid://shopify/ProductVariant/'));
  } catch {
    return [];
  }
}

function normalizeVariant(variant, source) {
  return {
    source,
    variantId: variant.id,
    title: variant.product?.title || variant.title || 'Recommended product',
    variantTitle: variant.title || '',
    image: variant.image?.url || variant.product?.featuredImage?.url || null,
    imageAlt: variant.image?.altText || variant.product?.featuredImage?.altText || variant.product?.title || variant.title || 'Recommended product',
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
