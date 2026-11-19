import { standaloneConnectorDefinitions } from "../src/engine/standaloneConnectors.js";
import { nodeDefinitionConnectorPatch } from "../src/engine/transceiverModules.js";

export function standaloneFiberFixture(catalogue) {
  const defaults = standaloneConnectorDefinitions(catalogue.nodeTypes);
  const types = { ...catalogue.nodeTypes, ...Object.fromEntries(defaults.map(n => [n.id,n])) };
  const kinds = ["fiber-lc-duplex","fiber-sc-duplex","fiber-st-duplex","fiber-lc","fiber-mpo","dac-sfp-plus","aoc-sfp-plus"];
  const devices = ["source","sink"].map((id,i) => {
    const template = { id:id+"-template",name:"Standalone "+id,category:"Custom",schemaVersion:2,deviceDefinitionVersion:2,
      width:260,height:650,connectors:kinds.map((type,index) => ({ id:"port-"+index,type,
        ...nodeDefinitionConnectorPatch(types[type]), label:types[type].label, nameText:"Port "+(index+1),
        direction:i ? "input":"output",signalDirection:i ? "input":"output",displaySide:i ? "left":"right",
        x:i ? 0:260,y:170+index*64,...(type.startsWith("fiber-") ? {fiberMode:"om4"} : {}) })) };
    return {instanceId:id,templateId:template.id,templateOverride:template,name:template.name,x:i*780,y:0};
  });
  return {projectName:"Standalone fibre and integrated cable ends",wireMode:"bezier",devices,connections:[]};
}
