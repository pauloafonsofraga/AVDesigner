import {MULTIBAND_SIGNALS} from "../src/engine/multibandSignals.js";

export function multibandFixture() {
  const deviceLibrary=[],devices=[],connections=[];
  for(const [index,type] of ["powerlock","component-video","rgbhv"].entries()) {
    const y=index*500,profile=MULTIBAND_SIGNALS[type];
    for(const side of ["from","to"]) {
      const id=`${type}-${side}`,direction=side==="from"?"output":"input";
      const template={id,name:`${profile.label || "PowerLock"} ${side}`,width:180,height:410,faceplateDeleted:true,
        connectors:["straight","routed"].map((name,i)=>({id:name,type,physicalType:type,connectorType:type,direction,
          x:direction==="output"?180:0,y:100+i*200,nameText:name,
          ...(type==="component-video"?{coaxConnectorFamily:side==="from"?"bnc":"rca"}:{})}))};
      deviceLibrary.push(template);devices.push({instanceId:id,templateId:id,x:side==="from"?0:900,y,templateOverride:structuredClone(template)});
    }
    for(const route of ["straight","routed"])connections.push({id:`${type}-${route}`,cableType:type,
      from:{deviceId:`${type}-from`,connectorId:route},to:{deviceId:`${type}-to`,connectorId:route},
      ...(route==="routed"?{manualRoute:true,manualRouteStyle:"orthogonal",routePoints:[{x:350,y:y+300},{x:350,y:y+210},{x:650,y:y+210},{x:650,y:y+300}]}:{})});
  }
  return {projectName:"Multiband signal acceptance",wireMode:"orthogonal",deviceLibrary,devices,connections};
}
