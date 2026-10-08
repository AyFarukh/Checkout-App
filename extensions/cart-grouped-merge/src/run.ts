// import type {
//   RunInput,
//   FunctionRunResult,
//   CartLine,
//   CartOperation,
// } from "../generated/api";
// export function run(input: RunInput): FunctionRunResult {
//   const groupedItems: Record<string, Pick<CartLine, "id" | "quantity">[]> = {};
//   input.cart.lines.forEach((line) => {
//     const bundleId = line.bundleId;
//     if (bundleId && bundleId.value) {
//       if (!groupedItems[bundleId.value]) {
//         groupedItems[bundleId.value] = [];
//       }
//       groupedItems[bundleId.value].push(line);
//     }
//   });

//   return {
//     operations: [
//       ...Object.values(groupedItems).map((group, index) => {
//         console.log(index);
//         // const parentLine = group.find((line) => line.merchandise?.id); // ✅ Safe check
//         // if (!parentLine) continue; // 🚫 Skip if no valid parent
//         // console.log(parentLine);

//         const mergeOperation: CartOperation = {
//           merge: {
//             cartLines: group.map((line) => ({
//               cartLineId: line.id,
//               quantity: line.quantity,
//             })),
//             parentVariantId: "gid://shopify/ProductVariant/47041625391387", // Replace with your actual bundle variant
//           },
//         };
//         return mergeOperation;
//       }),
//     ],
//   };
// }

import type {
  RunInput,
  FunctionRunResult,
  CartLine,
  CartOperation,
} from "../generated/api";
export function run(input: RunInput): FunctionRunResult {
  const groupedItems: Record<string, Pick<CartLine, "id" | "quantity">[]> = {};
  input.cart.lines.forEach((line) => {
    const bundleId = line.bundleId;
    if (bundleId && bundleId.value) {
      if (!groupedItems[bundleId.value]) {
        groupedItems[bundleId.value] = [];
      }
      groupedItems[bundleId.value].push(line);
    }
  });

  return {
    operations: [
      ...Object.values(groupedItems).map((group, index) => {
        console.log(index);
        // const parentLine = group.find((line) => line.merchandise?.id); // ✅ Safe check
        // if (!parentLine) continue; // 🚫 Skip if no valid parent
        // console.log(parentLine);

        const mergeOperation: CartOperation = {
          merge: {
            cartLines: group.map((line) => ({
              cartLineId: line.id,
              quantity: line.quantity,
            })),
            parentVariantId: "gid://shopify/ProductVariant/cd ..", // Replace with your actual bundle variant
          },
        };
        return mergeOperation;
      }),
    ],
  };
}
