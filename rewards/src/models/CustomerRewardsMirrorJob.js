import mongoose from "mongoose";

const customerRewardsMirrorJobSchema=new mongoose.Schema({
  shop:{type:String,required:true,index:true,trim:true,lowercase:true},
  shopifyCustomerId:{type:String,required:true,index:true,trim:true},
  status:{type:String,enum:["PENDING","PROCESSING","SYNCED","FAILED"],default:"PENDING",index:true},
  attempts:{type:Number,default:0,min:0},
  nextAttemptAt:{type:Date,default:Date.now,index:true},
  lockedAt:Date,
  lockOwner:String,
  lastError:String,
  lastErrorCode:String,
  completedAt:Date,
},{timestamps:true});
customerRewardsMirrorJobSchema.index({shop:1,shopifyCustomerId:1},{unique:true});
customerRewardsMirrorJobSchema.index({status:1,nextAttemptAt:1});
export const CustomerRewardsMirrorJob=mongoose.models.CustomerRewardsMirrorJob||mongoose.model("CustomerRewardsMirrorJob",customerRewardsMirrorJobSchema);
