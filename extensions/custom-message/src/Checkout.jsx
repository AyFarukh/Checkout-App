import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useState} from 'preact/hooks';

export default function extension() {
  render(<GiftRequest />, document.body);
}

function GiftRequest() {
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  async function update(event) {
    const value = event.currentTarget.checked;
    setChecked(value);
    setError('');
    const result = await shopify.applyAttributeChange({
      type: 'updateAttribute',
      key: 'requestedFreeGift',
      value: value ? 'yes' : 'no',
    });
    if (result.type === 'error') {
      setChecked(!value);
      setError(result.message || 'Unable to update gift preference.');
    }
  }
  return <s-stack gap="base">
    <s-checkbox checked={checked} onChange={update}>I would like to receive a free gift with my order</s-checkbox>
    {error && <s-banner tone="critical">{error}</s-banner>}
  </s-stack>;
}
