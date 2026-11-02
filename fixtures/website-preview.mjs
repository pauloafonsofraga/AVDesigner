// Synthetic product imagery only; no customer projects or factory data are modified.
export function websitePreviewFixture(){
  const specs=[['playback','Media playback',0,20,[],['hdmi','sdi']],
    ['switcher','Presentation switcher',430,100,['hdmi','sdi'],['hdmi','sdi']],
    ['display','Main display',860,20,['hdmi','sdi'],[]]];
  return {projectName:'Main stage / synthetic AV',wireMode:'bezier',devices:specs.map(([id,name,x,y,inputs,outputs])=>{
    const connectors=[...inputs.map((type,i)=>({id:`in-${i}`,type,nameText:`IN ${i+1}`,label:type.toUpperCase(),direction:'input',signalDirection:'input',displaySide:'left',x:0,y:160+i*90})),
      ...outputs.map((type,i)=>({id:`out-${i}`,type,nameText:`OUT ${i+1}`,label:type.toUpperCase(),direction:'output',signalDirection:'output',displaySide:'right',x:260,y:160+i*90}))];
    return {instanceId:id,templateId:`preview-${id}`,name,x,y,templateOverride:{id:`preview-${id}`,name,category:'Custom',schemaVersion:2,deviceDefinitionVersion:2,width:260,height:380,connectors}};
  }),connections:[...['hdmi','sdi'].map((cableType,i)=>({id:`preview-input-${i}`,cableType,length:'15m',from:{deviceId:'playback',connectorId:`out-${i}`},to:{deviceId:'switcher',connectorId:`in-${i}`}})),
    ...['hdmi','sdi'].map((cableType,i)=>({id:`preview-output-${i}`,cableType,length:'25m',from:{deviceId:'switcher',connectorId:`out-${i}`},to:{deviceId:'display',connectorId:`in-${i}`}}))]};
}
