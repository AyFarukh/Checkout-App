import {
  reactExtension,
  Banner,
  BlockStack,
  Checkbox,
  Text,
  useApi,
  useApplyAttributeChange,
  useBuyerJourneyIntercept,
  useExtensionApi,
  useInstructions,
  Modal,
  Button,
  TextBlock,
  useTranslate,
} from "@shopify/ui-extensions-react/checkout";
import { useState, useCallback, useMemo } from "react";

// 1. Choose an extension target
export default reactExtension("purchase.checkout.block.render", () => (
  <Extension />
));

function Extension() {
  const translate = useTranslate();
  const { extension } = useApi();
  const { buyerJourney, ui } = useApi();
  const [hasVerified, setHasVerified] = useState(false);
  const [showReminder, setShowReminder] = useState(false);

  useBuyerJourneyIntercept(({ canBlockProgress }) =>
    canBlockProgress && !hasVerified
      ? {
          behavior: "block",
          reason: "address-not-verified",
          perform: () => {
            debugger;
            setShowReminder(true);
            // open our modal reminder
            // ui.overlay.open("address-reminder");
          },
        }
      : {
          behavior: "allow",
          perform: () => {
            console.log(canBlockProgress);
            // debugger;

            // ensure modal is closed if they somehow revisit
            // ui.overlay.close("address-reminder");
          },
        }
  );

  // 3️⃣ Inline reminder panel
  if (showReminder && !hasVerified) {
    return (
      // <Modal
      //   id="address-reminder"
      //   title="Please Verify Your Address"
      //   primaryAction={
      //     <Button
      //       onPress={() => {
      //         setHasVerified(true);
      //         ui.overlay.close("address-reminder");
      //       }}
      //     >
      //       I’ve Verified
      //     </Button>
      //   }
      //   secondaryActions={
      //     <Button onPress={() => ui.overlay.close("address-reminder")}>
      //       Go Back
      //     </Button>
      //   }
      //   // add padding around content
      //   padding
      // >
      //   <TextBlock>
      //     “Please verify your shipping address to avoid any delivery issues.”
      //   </TextBlock>
      // </Modal>
      <BlockStack spacing="loose">
        <TextBlock size="base">
          “Please verify your shipping address to avoid any delivery issues.”
        </TextBlock>
        <Button
          onPress={() => {
            setHasVerified(true);
            setShowReminder(false);
          }}
        >
          I’ve Verified
        </Button>
      </BlockStack>
    );
  }

  // return (
  //   <Modal
  //     id="address-reminder"
  //     title="Please Verify Your Address"
  //     primaryAction={
  //       <Button
  //         onPress={() => {
  //           setHasVerified(true);
  //           ui.overlay.close("address-reminder");
  //         }}
  //       >
  //         I’ve Verified
  //       </Button>
  //     }
  //     secondaryActions={
  //       <Button onPress={() => ui.overlay.close("address-reminder")}>
  //         Go Back
  //       </Button>
  //     }
  //     // add padding around content
  //     padding
  //   >
  //     <TextBlock>
  //       “Please verify your shipping address to avoid any delivery issues.”
  //     </TextBlock>
  //   </Modal>
  // );
}
