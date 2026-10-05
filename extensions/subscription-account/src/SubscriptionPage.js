import {
  reactExtension,
  BlockStack,
  Heading,
  Text,
  Banner,
} from "@shopify/ui-extensions-react/customer-account";
import React from "react";

export default reactExtension("customer-account.page.render", () => <SubscriptionPage />);

function SubscriptionPage() {
  return (
    <BlockStack spacing="base">
      <Heading>My subscription</Heading>
      <Banner status="info" title="Subscription portal preview">
        <Text>
          This portal is currently read-only while the Loop connection is being verified. No subscription changes can be made from this page.
        </Text>
      </Banner>
    </BlockStack>
  );
}
