import mongoose from "mongoose";

// Persisted operation ledger. A unique key prevents two workers from claiming
// the same request. A timeout is NOT proof of failure; unknown outcomes must
// be reconciled with Loop before any retry.
const schema=new mongoose.Schema({
  shop:{type:String,required:true},
  customerId:{type:String,required:true},
  subscriptionId:{type:String,required:true},
  action:{type:String,required:true},
  requestKey:{type:String,required:true},
  requestHash:{type:String,required:true},
  lockKey:{type:String},
  payload:{type:mongoose.Schema.Types.Mixed,select:false},
  context:{type:mongoose.Schema.Types.Mixed,select:false},
  status:{type:String,enum:["reserved","in_flight","applied","rejected","unknown"],default:"reserved"},
  startedAt:{type:Date,default:Date.now},
  completedAt:{type:Date,default:null},
  verifiedAt:{type:Date,default:null},
  errorCode:{type:String,default:null},
  providerHttpStatus:{type:Number,default:null},
  operatorResolution:{type:mongoose.Schema.Types.Mixed,select:false},
  providerFailureKind:{type:String,enum:['HTTP_ERROR','BUSINESS_REJECTION','UNEXPECTED_RESPONSE','TRANSPORT_OR_PRE_DISPATCH',null],default:null}
},{timestamps:true});
schema.index({shop:1,customerId:1,requestKey:1},{unique:true});
// No TTL: deleting an ambiguous attempt could allow a duplicate charge.
schema.index({lockKey:1},{unique:true,sparse:true});
schema.index({status:1,updatedAt:1});
export const LoopActionAttempt=mongoose.models.LoopActionAttempt||
  mongoose.model("LoopActionAttempt",schema);

