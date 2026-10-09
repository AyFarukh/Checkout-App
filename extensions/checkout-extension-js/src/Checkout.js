import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

export default function extension() {
  render(<DeliveryDate />, document.body);
}

function DeliveryDate() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    async function refresh() {
      const groups = shopify.deliveryGroups?.value || [];
      const selected = groups.map((group) =>
        (group.deliveryOptions || []).find((option) => option.handle === group.selectedDeliveryOption?.handle)
      ).find(Boolean);
      if (!selected) { if (active) setMessage(''); return; }
      const settings = shopify.settings?.value || {};
      const fulfillment = Math.max(0, Number(settings.fulfillment_days) || 0);
      const transitSeconds = Number(selected.deliveryEstimate?.timeInTransit?.lower) || 0;
      const date = new Date();
      date.setDate(date.getDate() + Math.ceil(fulfillment + transitSeconds / 86400));
      const next = 'Expected Delivery on ' + date.toDateString() + '.';
      if (active) setMessage(next);
      if (shopify.attributes?.value?.find((attribute) => attribute.key === 'deliveryTime')?.value !== next) {
        await shopify.applyAttributeChange({type: 'updateAttribute', key: 'deliveryTime', value: next});
      }
    }
    refresh();
    const unsubscribe = shopify.deliveryGroups?.subscribe(refresh);
    return () => { active = false; unsubscribe?.(); };
  }, []);
  return message ? <s-text>{message}</s-text> : null;
}
