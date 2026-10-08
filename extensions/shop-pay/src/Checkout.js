
import { extension, Banner, Heading,  } from "@shopify/ui-extensions/checkout";

export default extension("purchase.checkout.delivery-address.render-after", (root, api) => {
  const { extension, i18n, deliveryGroups } = api;
  let settings =  api.settings;
  // let deliveryGroups = useDeliveryGroups();

  // console.log(deliveryGroups);
  // <Heading>Expected Delivery in 3 days.</Heading>
  let groupList = [];
  if(deliveryGroups.current[0]){
    groupList = deliveryGroups.current[0].deliveryOptions;
  }

  Date.prototype.addDays = function(days) {
    var date = new Date(this.valueOf());
    date.setDate(date.getDate() + days);
    return date;
  }
  console.log("APP LOADING START");
  // console.log(groupList);
  updateNotes =  (updatedDays)=>{
    let currentDays = api.note.current;
    console.log(currentDays);
    if(!currentDays || currentDays !=  `Expected Delivery on ${updatedDays.toDateString()}.`){
      const response__ =  api.applyNoteChange({
        "type" : "updateNote",
        "note" : `Expected Delivery on ${updatedDays.toDateString()}.`
      })
      return response__;
    }
    else{
      return;
    }
    
  }
  let heading = null;
  GenerateTimer = (days)=>{
    if(heading != null){
      
      heading.remove();

    }
    var date = new Date();

    // console.log(date);
    let updatedDays = date.addDays(days);
    if(date.getDay() == 0){
      //If toDay is sunday
      updatedDays = date.addDays(days +1);
    }
    else 
      if(date.getDay() == 6){
        //If toDay is saturday
        updatedDays = date.addDays(days + 2);
      }
      else
        if(date.getDay() ==  5){


          var dt = new Date();
          
          dt.setTime(dt.getTime()+dt.getTimezoneOffset()*60*1000);
          var offset = -300; //Timezone offset for EST in minutes.
          var estDate = new Date(dt.getTime() + offset*60*1000);
          if(estDate.getHours() >= 12){
            console.log("12 Hours rule applies on Friday");
            console.log("Days added " + days);
            updatedDays = date.addDays(days + 3);
          }




        }
        else{

          var dt = new Date();
          console.log("12 Hours rule applies on otherDays")
          dt.setTime(dt.getTime()+dt.getTimezoneOffset()*60*1000);
          var offset = -300; //Timezone offset for EST in minutes.
          var estDate = new Date(dt.getTime() + offset*60*1000);
          if(estDate.getHours() >= 12){
            updatedDays = date.addDays(days + 1);
          }

        }
        




        let notes =  updateNotes(updatedDays);
        console.log(notes);

    console.log(date.addDays(5));
    heading = root.createComponent(Heading,undefined, `Expected Delivery on ${updatedDays.toDateString()}.`);
    root.appendChild(heading);
  }
  // console.log(groupList)
  deliveryGroups.subscribe(group=>{
    let selectedGroup = group[0].selectedDeliveryOption?.handle;
    if(deliveryGroups.current[0]){
      groupList = deliveryGroups.current[0].deliveryOptions;
    }
    
    // console.log(group);

    // console.log(selectedGroup);
    // console.log(group);
    
    let selectedTitle = null;
    // console.log(selectedGroup);

    groupList.forEach(list=>{
      // console.log(list);
      if(selectedGroup == list.handle){
        
        selectedTitle = list.title;
      }
    })

    console.log(selectedTitle);
    if(selectedTitle == "UPS® Ground"){
      GenerateTimer(settings.current.ups_date)
    }
    else
      if(selectedTitle == "Ground Advantage"){
        GenerateTimer(settings.current.usps_date)
      }
      else
        if(selectedTitle == "Free Shipping"){
          GenerateTimer(settings.current.dhlexpress_date)
        }

    // console.log(selectedTitle);
  })
  

  // CheckSelectedGroup = ()=>{
  //   let selectedGroup =  deliveryGroups[0].selectedDeliveryOption?.handle;
  //   console.log(selectedGroup);
  //   setTimeout(CheckSelectedGroup, 100);
  // }
  // CheckSelectedGroup = ()=>{

  //   setTimeout(CheckSelectedGroup, 100);
  // }
  // CheckSelectedGroup();
  // GenerateTimer(4);

  // root.appendChild(
  //   root.createComponent(
  //     Banner,
  //     { title: "checkout-extension-js" },
  //     i18n.translate('welcome', {target: extension.target})
  //   )
  // );
});