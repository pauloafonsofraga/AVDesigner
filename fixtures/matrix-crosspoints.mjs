export function matrixCrosspointFixture(size = 48, { longNames = false } = {}) {
  const connectors = ["input", "output"].flatMap(direction => Array.from({ length:size }, (_, index) => {
    const side = direction === "input" ? "left" : "right";
    const x = direction === "input" ? 0 : 320, y = 200 + index * 40;
    return { id:`${direction}-port-${101 + index * 7}`, type:"hdmi", direction,
      nameText:longNames && index === 23 ? `${direction === "input" ? "IN" : "OUT"} 24 - Control room <primary> & backup source with a deliberately long custom connector name`
        : `${direction === "input" ? "IN" : "OUT"} ${index + 1}`,
      includeInMatrix:true, schemaVersion:2, displaySide:side, primaryAnchorId:side,
      x, y, anchors:[{ id:side, side, x, y }] };
  }));
  const template = { id:`crosspoint-${size}`, name:`${size} x ${size} Matrix`, category:"Matrixes",
    isMatrixRouter:true, width:320, height:240 + size * 40, connectors };
  return { devices:[{ instanceId:"crosspoint-matrix", templateId:template.id, templateOverride:template,
    name:template.name, x:0, y:0, matrixRoutes:{} }], connections:[] };
}
