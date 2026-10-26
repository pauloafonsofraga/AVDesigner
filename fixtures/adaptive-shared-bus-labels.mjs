export function adaptiveSharedBusFixture() {
  const types=['hdmi','hdmi','display-port','sdi'];
  const connectors=['left','right'].flatMap(side=>types.map((type,index)=>({id:`${side}-${index}`,type,
    direction:side==='left'?'input':'output',displaySide:side,signalDirection:side==='left'?'input':'output',
    x:side==='left'?0:360,y:170+18*index,nameText:`${side} bus`,resolutionFrameRate:'2160p',customText:'Shared field',
    anchors:[{id:side,side,x:side==='left'?0:360,y:170+18*index}],primaryAnchorId:side})));
  const t={id:'adaptive-bus-device',name:'Dense shared buses',width:360,height:440,faceplateDeleted:true,
    connectors,connectorRelationships:['left','right'].map(side=>({id:`bus-${side}`,type:'exclusive',members:types.map((_,i)=>`${side}-${i}`)})),cardTypes:[],cardSlots:[]};
  return {deviceLibrary:[t],devices:[{instanceId:'adaptive',templateId:t.id,x:100,y:100}],connections:[]};
}
