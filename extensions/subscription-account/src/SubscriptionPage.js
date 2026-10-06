import '@shopify/ui-extensions/preact';
import {createElement as e,render} from 'preact';

export default function extension(){
  render(e(SubscriptionPage),document.body);
}

function SubscriptionPage(){
  const settings=shopify.settings?.value||{};
  const title=settings.page_title||'My subscription';
  return e('s-page',{heading:title},
    e('s-stack',{direction:'block',gap:'base'},
      e('s-banner',{tone:'info'},
        e('s-stack',{direction:'block',gap:'small'},
          e('s-heading',null,'Subscription portal preview'),
          e('s-text',null,'This portal is currently read-only while the Loop connection is being verified. No subscription changes can be made from this page.')
        )
      )
    )
  );
}
