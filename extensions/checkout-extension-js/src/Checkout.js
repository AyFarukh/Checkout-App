import { extension, Banner, Heading,  } from "@shopify/ui-extensions/checkout";

export default extension("purchase.checkout.block.render", (root, api) => {
  const { extension, i18n, deliveryGroups } = api;
  let settings =  api.settings;
  // let deliveryGroups = useDeliveryGroups();

  // console.log(deliveryGroups);
  // <Heading>Expected Delivery in 3 days.</Heading>
  let address = api.shippingAddress?.current;
  let hash = {};
  api.shippingAddress?.subscribe((newAddress) => {
    address = newAddress;
  });
  api.shippingAddress.subscribe(() =>{
    const {countryCode} =
    api.shippingAddress.current;
    hash.country = countryCode;
    // console.log(countryCode);
    
  }
    
  );
  let groupList = [];
  if(deliveryGroups.current[0]){
    groupList = deliveryGroups.current[0].deliveryOptions;
    // console.log(groupList);
  }

  Date.prototype.addDays = function(days) {
    var date = new Date(this.valueOf());
    date.setDate(date.getDate() + days);
    return date;
  }
  Date.prototype.withoutTime = function () {
    var d = new Date(this);
    d.setHours(0, 0, 0, 0);
    return d;
}
  // console.log("APP LOADING START");
  // console.log(groupList);
  
  updateNotes =  (updatedDays)=>{
    let currentDaysAttributes = api.attributes.current;

    let currentDays = null;
    currentDaysAttributes.forEach(attribute=>{
      if(attribute.key == "deliveryTime"){
        currentDays = attribute.value;
      }
    })


    

    console.log(currentDays);
    if(!currentDays || currentDays !=  `Expected Delivery on ${updatedDays.toDateString()}.`){
      // const response__ =  api.applyNoteChange({
      //   "type" : "updateNote",
      //   "note" : `Expected Delivery on ${updatedDays.toDateString()}.`
      // })
      // return response__;

      const result =
        api.applyAttributeChange({
          key: 'deliveryTime',
          type: 'updateAttribute',
          value: `Expected Delivery on ${updatedDays.toDateString()}.`,
      });

      return result;


    }
    else{
      return;
    }
    
  }
  let heading = null;
  let previousSelected = null;
  GenerateTimer = async (days)=>{
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
          if(estDate.getHours() >= 11){

            updatedDays = date.addDays(days + 3);
          }




        }
        else{

          var dt = new Date();
          // console.log("12 Hours rule applies on otherDays")
          dt.setTime(dt.getTime()+dt.getTimezoneOffset()*60*1000);
          var offset = -300; //Timezone offset for EST in minutes.
          var estDate = new Date(dt.getTime() + offset*60*1000);
          if(estDate.getHours() >= 11){
            updatedDays = date.addDays(days + 1);
          }

        }
        





    // console.log(date.addDays(5));
    // const response__ = await api.applyNoteChange({
    //   "type" : "updateNote",
    //   "note" : `Expected Delivery on ${updatedDays.toDateString()}.`
    // })
    
    let notes =  updateNotes(updatedDays);
        console.log(notes);
    
    heading = root.createComponent(Heading,undefined, `Expected Delivery on ${updatedDays.toDateString()}.`);
    root.appendChild(heading);
  }
  // console.log(groupList)
  deliveryGroups.subscribe(group=>{
    let selectedGroup = group[0]?.selectedDeliveryOption?.handle;
    if(deliveryGroups.current[0]){
      groupList = deliveryGroups.current[0].deliveryOptions;
    }

    
    let selectedTitle = null;
    

    let selectedGroupHash = {};
    groupList.forEach(list=>{
      
      if(selectedGroup == list.handle){
        selectedGroupHash = list;
        selectedTitle = list.title;
      }
    })

    var date = new Date();
    

    let expectedDeleveryTime = selectedGroupHash.deliveryEstimate?.timeInTransit?.lower;
    
    if(selectedTitle != "Free Shipping"){

      
      


      let days = settings.current.fulfillment_days;

      let expeectedDate = date.addDays(days);
      if(expeectedDate.getDay == "6"){
        days = days + 2;
      }
      else
        if(expeectedDate.getDay == "0"){
          days = days + 1;
        }
      
      if(expectedDeleveryTime){
        days = days + ( expectedDeleveryTime / 86400);

      }
      GenerateTimer(days);
    }
    else{
      if(group.length > 0){
        group[0].deliveryOptions.forEach(option=>{
          if(option.title == "Ground Advantage"){
            expectedDeleveryTime = option.deliveryEstimate?.timeInTransit?.lower;
            let days = settings.current.fulfillment_days;
            let expeectedDate = date.addDays(days);
            if(expeectedDate.getDay == "6"){
              days = days + 2;
            }
            else
              if(expeectedDate.getDay == "0"){
                days = days + 1;
              }
            if(expectedDeleveryTime){
              days = days + ( expectedDeleveryTime / 86400);

            }
            GenerateTimer(days);
          }
        })
      }
    }



    // if(selectedTitle == "UPS® Ground"){
    //   if(hash.country == "US"){
    //     let days = settings.current.ups_date;
    //     if(expectedDeleveryTime){
    //       days = days + ( expectedDeleveryTime / 86400);
    //     }
    //     GenerateTimer(days);
    //   }
    //   else{
    //     if(heading != null){
      
    //       heading.remove();
    
    //     }
    //   }
      
    // }
    // else
    //   if(selectedTitle == "Ground Advantage"){
    //     if(hash.country == "US"){
    //       let days = settings.current.usps_date;
    //       console.log(days);
    //       if(expectedDeleveryTime){
    //         days = days + ( expectedDeleveryTime / 86400);
    //         console.log(days);
    //       }
    //       GenerateTimer(days);
    //       // GenerateTimer(settings.current.usps_date)
    //     }
    //     else{
    //       if(heading != null){
        
    //         heading.remove();
      
    //       }
    //     }
    //   }
    //   else 
    //     if(selectedTitle == "UPS Next Day Air®"){
    //       if(hash.country == "US"){
    //         let days = settings.current.usps_date_air;
    //         if(expectedDeleveryTime){
    //           days = days + ( expectedDeleveryTime / 86400);
    //         }
    //         GenerateTimer(days);
    //         // GenerateTimer(settings.current.usps_date_air)
    //       }
    //       else{
    //         if(heading != null){
          
    //           heading.remove();
        
    //         }
    //       }
    //     }
    //     else 
    //       if(selectedTitle == "UPS 2nd Day Air®"){
    //         if(hash.country == "US"){
    //           let days = settings.current.usps_second_date_air;
    //           if(expectedDeleveryTime){
    //             days = days + ( expectedDeleveryTime / 86400);
    //           }
    //           GenerateTimer(days);
    //           // GenerateTimer(settings.current.usps_second_date_air)
    //         }
    //         else{
    //           if(heading != null){
            
    //             heading.remove();
          
    //           }
    //         }
    //       }
    //       else
    //         if(selectedTitle == "Free Shipping"){
    //           if(hash.country == "US"){

    //             let days = settings.current.dhlexpress_date;
    //             if(expectedDeleveryTime){
    //               days = days + ( expectedDeleveryTime / 86400);
    //             }
    //             GenerateTimer(days);

    //             // GenerateTimer(settings.current.dhlexpress_date)
    //           }
    //           else{
    //             if(heading != null){
              
    //               heading.remove();
            
    //             }
    //           }
    //         }

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