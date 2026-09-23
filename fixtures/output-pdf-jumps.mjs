// Separated strict and bidirectional pairs, plus an intentionally unpaired node.
export function outputPdfJumpFixture() {
  const device = (id, x, y, direction, side) => ({ instanceId:id, templateId:id, name:id, x, y,
    templateOverride:{ id, name:id, schemaVersion:2, deviceDefinitionVersion:2,
      width:240, height:300, connectors:[{ id:"signal", type:"sdi", nameText:id,
        direction:direction === "bidirectional" ? "io" : direction, signalDirection:direction,
        displaySide:side, primaryAnchorId:"signal", x:side === "left" ? 0 : 240, y:200,
        anchors:[{ id:"signal", side, x:side === "left" ? 0 : 240, y:200 }] }] } });
  const devices = [device("Strict Source",-500,-300,"output","right"),
    device("Strict Destination",1000,400,"input","left"),
    device("Bidirectional A",-500,500,"bidirectional","right"),
    device("Bidirectional B",1000,-300,"bidirectional","left")];
  const jumpNodes = [{ id:"strict-a",x:0,y:-100 },{ id:"strict-b",x:700,y:600 },
    { id:"bidi-a",x:0,y:700 },{ id:"bidi-b",x:700,y:-100 },{ id:"unpaired",x:350,y:300 }];
  const connections = devices.map((device,i) => ({ id:`physical-${i+1}`, cableType:"sdi",
    from:i === 1 ? { jumpNodeId:jumpNodes[i].id } : { deviceId:device.instanceId,connectorId:"signal" },
    to:i === 1 ? { deviceId:device.instanceId,connectorId:"signal" } : { jumpNodeId:jumpNodes[i].id } }));
  return { projectName:"PDF Jump Navigation", devices, connections, jumpNodes,
    jumpLinks:[{ id:"strict-pair",outputJumpId:"strict-a",inputJumpId:"strict-b" },
      { id:"bidirectional-pair",outputJumpId:"bidi-a",inputJumpId:"bidi-b" }] };
}
