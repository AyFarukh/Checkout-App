/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';

export default function extension() {
  const deliveryTime = shopify.attributes?.value?.find((item) => item.key === 'deliveryTime')?.value;
  render(<s-text>{deliveryTime || 'Thank you for your order.'}</s-text>, document.body);
}
