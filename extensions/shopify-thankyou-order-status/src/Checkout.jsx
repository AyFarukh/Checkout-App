/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';

function EstimatedArrival() {
  const arrival = new Date();
  arrival.setDate(arrival.getDate() + 3);
  return <s-text>Estimated arrival: {arrival.toLocaleDateString()}</s-text>;
}

export function thankYouBlock() {
  render(<EstimatedArrival />, document.body);
}

export function orderDetailsBlock() {
  render(<EstimatedArrival />, document.body);
}
