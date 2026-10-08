// import {
//   Banner,
//   useApi,
//   useTranslate,
//   reactExtension,
//   Heading,
//   useExtensionApi,
//   useDeliveryGroups,
// } from '@shopify/ui-extensions-react/checkout';

// export default reactExtension(
//   'purchase.checkout.shipping-option-list.render-after',
//   () => <Extension />,
// );

// function Extension() {
//   const translate = useTranslate();
//   const { extension } = useApi();
//   // const { deliveryGroups } = useExtensionApi();



//   // let deliveryGroups = useDeliveryGroups();

//   // checkForSelectedOption = ()=>{
//   //   let selectedGroup =  deliveryGroups[0].selectedDeliveryOption?.handle;
//   //   console.log(selectedGroup);
//   // }
//   // console.log(useApi());

//   return (
    
//     <Heading>Expected Delivery in 3 days.</Heading>
//     // <Banner title="Custom-message">
//     //   {translate('welcome', {target: extension.target})}
//     // </Banner>
//   );
// }

// // import { useState, useCallback, useMemo } from "react";
// // import {
// //   Heading,
// //   DatePicker,
// //   useApplyMetafieldsChange,
// //   useDeliveryGroups,
// //   useApi,
// //   reactExtension,
// // } from "@shopify/ui-extensions-react/checkout";

// // reactExtension("purchase.checkout.block.render", () => (
// //   <Extension />
// // ));

// // export default function Extension() {
// //   const [selectedDate, setSelectedDate] = useState("");
// //   const [yesterday, setYesterday] = useState("");

// //   const { extension } = useApi();
// //   const { target } = extension;

// //   let deliveryGroups = useDeliveryGroups();

// //   // Set a function to handle updating a metafield
// //   const applyMetafieldsChange = useApplyMetafieldsChange();

// //   // Define the metafield namespace and key
// //   const metafieldNamespace = "yourAppNamespace";
// //   const metafieldKey = "deliverySchedule";

// //   // Sets the selected date to today, unless today is Sunday, then it sets it to tomorrow
// //   useMemo(() => {
// //     let today = new Date();

// //     const yesterday = new Date(today);
// //     yesterday.setDate(today.getDate() - 1);

// //     const tomorrow = new Date(today);
// //     tomorrow.setDate(today.getDate() + 1);

// //     const deliveryDate = today.getDay() === 0 ? tomorrow : today;

// //     setSelectedDate(formatDate(deliveryDate));
// //     setYesterday(formatDate(yesterday));
// //   }, []);

// //   // Set a function to handle the Date Picker component's onChange event
// //   const handleChangeDate = useCallback((selectedDate) => {
// //     setSelectedDate(selectedDate);
// //     // Apply the change to the metafield
// //     applyMetafieldsChange({
// //       type: "updateMetafield",
// //       namespace: metafieldNamespace,
// //       key: metafieldKey,
// //       valueType: "string",
// //       value: selectedDate,
// //     });
// //   }, []);

// //   // Boolean to check if Express is selected
// //   const isExpressSelected = () => {
// //     // if (
// //     //   target !== "purchase.checkout.shipping-option-list.render-after" ||
// //     //   !deliveryGroups
// //     // ) {
// //     //   return false;
// //     // }

    
// //     const expressHandle = deliveryGroups[0].deliveryOptions.find(
// //       (method) => {
// //         method.title === "Standard"
// //         console.log(method);
// //       } 
// //     )?.handle;

    
// //     return expressHandle === deliveryGroups[0].selectedDeliveryOption?.handle
// //       ? true
// //       : false;
// //   };

// //   // Render the extension components if Express is selected
// //   return isExpressSelected() ? (
// //     <>
// //       <Heading>Select a date for delivery</Heading>
// //       <DatePicker
// //         selected={selectedDate}
// //         onChange={handleChangeDate}
// //         disabled={["Sunday", { end: yesterday }]}
// //       />
// //     </>
// //   ) : null;
// // }

// // const formatDate = (date) => {
// //   const year = date.getFullYear();
// //   const month = String(date.getMonth() + 1).padStart(2, "0");
// //   const day = String(date.getDate()).padStart(2, "0");
// //   return `${year}-${month}-${day}`;
// // };

import {
  extension,
  Checkbox,
} from '@shopify/ui-extensions/checkout';

// 1. Choose an extension target
export default extension(
  'purchase.checkout.shipping-option-item.render-after',
  (root, api) => {
    debugger;
    // 2. Render a UI
    root.appendChild(
      root.createComponent(
        Checkbox,
        {
          onChange: onCheckboxChange,
        },
        'I would like to receive a free gift with my order',
      ),
    );

    // 3. Call API methods to modify the checkout
    async function onCheckboxChange(isChecked) {
      const result =
        await api.applyAttributeChange({
          key: 'requestedFreeGift',
          type: 'updateAttribute',
          value: isChecked ? 'yes' : 'no',
        });
      console.log(
        'applyAttributeChange result',
        result,
      );
    }
  },
);
