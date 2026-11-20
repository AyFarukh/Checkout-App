import mongoose from 'mongoose';
const schema=new mongoose.Schema({
 shop:{type:String,required:true},customerId:{type:String,required:true},subscriptionId:{type:String,required:true},program:{type:String,required:true},
 seedCount:{type:Number,required:true,min:0,max:5},seedOrderIds:[String],enrolledAt:{type:Date,required:true},completedAt:Date,
 leaseToken:String,leaseUntil:Date,checkedAt:Date,issue:String
},{timestamps:true});
schema.index({shop:1,subscriptionId:1,program:1},{unique:true});
export const SubscriberJourney=mongoose.models.SubscriberJourney||mongoose.model('SubscriberJourney',schema);
const skipSchema=new mongoose.Schema({shop:{type:String,required:true},subscriptionId:{type:String,required:true},key:{type:String,required:true},occurredAt:Date,issue:String},{timestamps:true});
skipSchema.index({shop:1,key:1},{unique:true});
skipSchema.index({shop:1,subscriptionId:1,occurredAt:1});
export const JourneySkip=mongoose.models.JourneySkip||mongoose.model('JourneySkip',skipSchema);
