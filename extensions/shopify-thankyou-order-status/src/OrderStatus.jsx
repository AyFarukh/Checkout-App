/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';

export default function extension() {
  const arrival = new Date();
  arrival.setDate(arrival.getDate() + 3);
  render(<s-text>Estimated arrival: {arrival.toLocaleDateString()}</s-text>, document.body);
}
