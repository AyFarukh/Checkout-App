import {Router} from 'express';
import {subscriptionProxyAuth} from '../middleware/subscriptionProxyAuth.js';
import {loopActionService} from '../services/loop-action-executor.service.js';

const messages={GIFT_API_UNAVAILABLE:'Gift orders need a verified Loop API contract. Please use the Loop customer portal.',TEST_ONLY:'Only the configured test customer and subscription can use these actions.',LOOP_MUTATIONS_DISABLED:'Subscription changes are disabled.',SUBSCRIPTION_ACTION_PENDING:'A previous change is pending verification. Check its status before making another change.',STALE_PREVIEW:'Your subscription changed. Reload and validate again.',PREVIEW_EXPIRED:'Your preview expired. Validate the details again.',ACTION_NOT_FOUND:'No request was found with that key.',INVALID_PREVIEW:'Validate the action again before confirming.',SUBSCRIPTION_NOT_ACTIVE:'This subscription is not active.',LINE_NOT_OWNED:'The selected product does not belong to this subscription.',BUNDLE_REQUIRES_LOOP_EDITOR:'Edit this bundle in the Loop customer portal.'};
export function subscriptionActionFailure(res,error) {
  const status=Number.isInteger(error.statusCode)&&error.statusCode>=400&&error.statusCode<=599?error.statusCode:503;
  const code=/^[A-Z][A-Z0-9_]+$/.test(error.code||'')?error.code:'SUBSCRIPTION_SERVICE_UNAVAILABLE';
  return res.status(status).json({ok:false,applied:false,code,retrySafe:error.dispatched===false,message:messages[code]||(status===400?'Check the action details and validate again.':'The action could not be verified. Check its status before submitting again.')});
}
export function createSubscriptionActionRouter({service=loopActionService,authenticate=subscriptionProxyAuth}={}) {
  const router=Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.use(authenticate);
  for(const [path,method] of [['action-preview','preview'],['action-execute','execute'],['action-status','status'],['action-catalog','catalog'],['reschedule','execute']]) {
    router.post('/'+path,async(req,res)=>{
      try {
        const body=path==='reschedule'?{...req.body,action:'reschedule',payload:{date:req.body?.date}}:req.body;
        const result=await service[method](req.subscriptionIdentity,body);
        res.status(result.code==='ACTION_OUTCOME_UNKNOWN'?202:200).json(result);
      }catch(error){subscriptionActionFailure(res,error);}
    });
  }
  return router;
}
