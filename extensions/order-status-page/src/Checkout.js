import { extension, Banner, Heading,  } from "@shopify/ui-extensions/checkout";

export default extension("purchase.thank-you.block.render", (root, api) => {
  const { extension, i18n, deliveryGroups } = api;
  let settings =  api.settings;


  console.log(api.note.current);
  console.log(api.attributes.current);

  
  let attributes = api.attributes.current;
  if(attributes.length > 0){
    
    attributes.forEach(attribute=>{
      
      if(attribute.key == "deliveryTime"){
        
        let heading = root.createComponent(Heading,undefined, attribute.value);
        return root.appendChild(heading);
      }
    })
  }
  // let notes = api.note.current;
  // if(notes){
  //   let heading = root.createComponent(Heading,undefined, notes);
  //   return root.appendChild(heading);
  // }



});