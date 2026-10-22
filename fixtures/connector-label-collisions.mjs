import {orthogonalSharedBusFixture} from './orthogonal-shared-bus.mjs';
export function connectorLabelCollisionFixture(side='left') {
  const t=orthogonalSharedBusFixture(2,side,580,170);
  const after=t.connectors.find(c=>c.id==='after');after.y=after.anchors[0].y=234;
  t.connectors.forEach(c=>{c.nameText=`Port ${c.id}`;c.resolutionFrameRate='2160p';});
  t.connectors.filter(c=>c.id.startsWith('bus-')).forEach(c=>{c.type='hdmi';c.label='HDMI';});
  return {projectName:'Dense annotation acceptance',deviceLibrary:[t],
    devices:[{instanceId:'dense',templateId:t.id,x:100,y:100}],connections:[]};
}
