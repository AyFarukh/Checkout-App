import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

export default function extension() {
  render(<AddressVerification />, document.body);
}

function AddressVerification() {
  const [verified, setVerified] = useState(false);
  const [showError, setShowError] = useState(false);
  useEffect(() => {
    let active = true;
    let teardown;
    Promise.resolve(shopify.buyerJourney.intercept(({canBlockProgress}) => {
      if (!canBlockProgress || verified) return {behavior: 'allow'};
      return {
        behavior: 'block',
        reason: 'address-not-verified',
        perform: () => { if (active) setShowError(true); },
      };
    })).then((stop) => {
      if (active) teardown = stop;
      else stop?.();
    });
    return () => { active = false; teardown?.(); };
  }, [verified]);
  return (
    <s-stack gap="base">
      {showError && !verified && <s-banner tone="critical">Please verify your shipping address before continuing.</s-banner>}
      <s-checkbox checked={verified} onChange={(event) => {setVerified(event.currentTarget.checked); setShowError(false);}}>
        I have verified my shipping address
      </s-checkbox>
    </s-stack>
  );
}
