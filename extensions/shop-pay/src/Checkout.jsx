/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

export default function extension() {
  render(<DeliveryEstimate />, document.body);
}

function DeliveryEstimate() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    function refresh() {
      const groups = shopify.deliveryGroups?.value || [];
      const selected = groups.flatMap((group) => group.deliveryOptions || []).find((option) =>
        groups.some((group) => group.selectedDeliveryOption?.handle === option.handle));
      const title = selected?.title;
      const settings = shopify.settings?.value || {};
      const days = title === 'UPS® Ground' ? settings.ups_date :
        title === 'Ground Advantage' ? settings.usps_date :
        title === 'Free Shipping' ? settings.dhlexpress_date : undefined;
      if (days === undefined || !Number.isFinite(Number(days))) {
        setMessage('');
        return;
      }
      const date = new Date();
      date.setDate(date.getDate() + Number(days));
      setMessage('Expected Delivery on ' + date.toDateString() + '.');
    }
    refresh();
    return shopify.deliveryGroups?.subscribe(refresh);
  }, []);
  return message ? <s-text>{message}</s-text> : null;
}
