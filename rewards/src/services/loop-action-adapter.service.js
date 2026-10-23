// Documented Loop Admin 2026-04 actions. No endpoint here is called unless
// the caller explicitly invokes executeLoopAdminAction. Keep this server-only.
import {loopAdminRequest} from "./loop-subscriptions.service.js";

const OPERATIONS=Object.freeze({
  skip:{method:"POST",suffix:"skipNext",body:()=>undefined},
  "order-now":{method:"POST",suffix:"placeOrder",body:p=>({preponeFutureOrder:p.preponeFutureOrder===true})},
  frequency:{method:"PUT",suffix:"frequency",body:p=>({
    billingPolicy:{interval:p.interval,intervalCount:p.intervalCount},
    deliveryPolicy:{interval:p.interval,intervalCount:p.intervalCount},
    discountType:"OLD"
  })},
});

export function prepareLoopAdminAction(action,subscriptionId,payload={}) {
  const operation=OPERATIONS[action];
  if(!operation) throw new Error("This action does not have a verified Admin API adapter");
  if(!/^\d+$/.test(String(subscriptionId))) throw new Error("Invalid Loop subscription ID");
  if(action==="frequency"&&(!["WEEK","MONTH"].includes(payload.interval)||
      ![1,2,3,4,6].includes(Number(payload.intervalCount))))
    throw new Error("Invalid billing frequency");
  if(action==="order-now"&&payload.preponeFutureOrder!==true)
    throw new Error("Immediate order requires explicit preponeFutureOrder confirmation");
  return {method:operation.method,pathname:`subscription/${subscriptionId}/${operation.suffix}`,
    body:operation.body(payload)};
}

export async function executeLoopAdminAction(action,subscriptionId,payload,{signal}={}) {
  const request=prepareLoopAdminAction(action,subscriptionId,payload);
  return loopAdminRequest(request.pathname,{...request,signal});
}
