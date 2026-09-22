// Independent catalog contract shared by Node validation and the native browser smoke.
export const POWER_CATALOG = {
  iec: ["../Thumbnails/C13.png", "../Thumbnails/C13.png", 5, 45, 45],
  nema: ["NEMA.svg", "NEMA.svg", 10, 24, 24],
  "uk-13a": ["13A-UK.svg", "13A-UK.svg", 20, 55, 55],
  schuko: ["Schuko.svg", "Schuko.svg", 30, 45, 45],
  powercon: ["powerCON_Blue.svg", "powerCON_White.svg", 40, 31, 31],
  "powercon-true1": ["powerCON_True1_Male.svg", "powerCON_True1_Female.svg", 50, 31, 31],
  "16a-1ph-110v": ["16-1ph110v-Male.svg", "16-1ph110v.svg", 60, 66, 66],
  "16a-1ph": ["16-1ph-Male.svg", "16-1ph.svg", 70, 66, 66],
  "16a-cee": ["16-1ph-Male.svg", "16-1ph.svg", 70, 66, 66],
  "32a-1ph-110v": ["32-1ph110vMale.svg", "32-1ph110v.svg", 80, 72, 72],
  "32a-1ph": ["32-1ph-Male.svg", "32-1ph.svg", 90, 72, 72],
  "32a-cee": ["32-1ph-Male.svg", "32-1ph.svg", 90, 72, 72],
  "16a-3ph": ["16-3ph-Male.svg", "16-3ph.svg", 100, 66, 66],
  "32a-3ph": ["32-3ph-Male.svg", "32-3ph.svg", 110, 72, 72],
  "63a-3ph": ["63-3ph-Male.svg", "63-3ph.svg", 120, 100, 100],
  "63a-cee": ["63-3ph-Male.svg", "63-3ph.svg", 120, 100, 100],
  "125a-3ph": ["125-3ph-Male.svg", "125-3ph.svg", 130, 120, 120],
  "125a-cee": ["125-3ph-Male.svg", "125-3ph.svg", 130, 120, 120],
  socapex: ["SocapexMale.svg", "SocapexFemale.svg", 140, 56, 56],
  harting: ["HartingMale.svg", "HartingFemale.svg", 150, 111, 27],
  powerlock: ["Powelock drain.svg", "Powelock source.svg", 500, 300, 44]
};

export const POWER_ALIASES = {
  "16a-cee": "16a-1ph", "32a-cee": "32a-1ph",
  "63a-cee": "63a-3ph", "125a-cee": "125a-3ph"
};
export const VISIBLE_POWER_TYPES = Object.keys(POWER_CATALOG).filter(id => !POWER_ALIASES[id]);

export function powerConnector(type, direction, index = 0) {
  const side = direction === "input" ? "left" : "right";
  const x = direction === "input" ? 0 : 380;
  const y = 2400 + index * 54;
  return {
    id: `${type}-${direction}`, schemaVersion: 2, type, physicalType: type, connectorType: type,
    direction, signalDirection: direction, displaySide: side, primaryAnchorId: side,
    anchors: [{ id: side, side, x, y, primary: true }], x, y,
    label: `${type} ${direction}`, nameText: `${type} ${direction}`, customText: "catalog override",
    powerPlug: { manual: false, x: 0, y: 0 }
  };
}

export function powerTemplate(types = Object.keys(POWER_CATALOG)) {
  const normal = types.filter(type => type !== "powerlock");
  const normalHeight = normal.reduce((sum, type) => sum + POWER_CATALOG[type][4], 0) + Math.max(0, normal.length - 1) * 10;
  const lockHeight = types.includes("powerlock") ? 44 * 2 + 10 : 0;
  const faceHeight = Math.max(78, 36 + normalHeight + (normalHeight && lockHeight ? 18 : 0) + lockHeight);
  const startY = 38 + faceHeight + 36;
  const connectors = types.flatMap((type, index) => ["input", "output"].map(side => {
    const connector = powerConnector(type, side, index);
    connector.y = startY + index * 54;
    connector.anchors[0].y = connector.y;
    return connector;
  }));
  return {
    id: "power-catalog", schemaVersion: 2, name: "Power Catalog", category: "Power Distros",
    isPowerDistro: true, width: 380, height: startY + types.length * 54 + 28,
    connectors,
    cardSlots: [], cardTypes: [], connectorRelationships: []
  };
}

export function powerCatalogProject(types) {
  const template = powerTemplate(types);
  return {
    version: 2, projectName: "Power Distro Catalog", deviceLibrary: [template],
    devices: [{ instanceId: "power-catalog-instance", templateId: template.id, x: 0, y: 0, name: template.name }],
    connections: [], nodeLibrary: []
  };
}
