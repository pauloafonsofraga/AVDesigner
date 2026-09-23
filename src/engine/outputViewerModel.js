import { SceneGraph } from "./sceneGraph.js";
import { resolvePlayableSignalPath, jumpNodeRoleLabel } from "./jumpNodeModel.js";

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function createOutputViewerModel(snapshot) {
  const start = performance.now();
  const source = snapshot?.engineScene || snapshot;
  if (source?.version !== 1 || source.coordinateSpace !== "engine-world"
    || ![source.devices, source.wires, source.racks, source.jumpLinks].every(Array.isArray)) {
    throw new TypeError("Expected a version 1 canonical Engine output scene.");
  }
  const contract = freeze(JSON.parse(JSON.stringify(source)));
  const scene = new SceneGraph();
  scene.setData({ devices: contract.devices, wires: contract.wires, racks: contract.racks,
    jumpLinks: contract.jumpLinks, meta: { cableHops: contract.diagnostics?.cableHops?.enabled !== false } });
  return { contract, scene, normalizationMs: performance.now() - start };
}

export function outputSelectionDetails(scene, selection) {
  if (!selection) return { title: "Inspector", rows: [], wireIds: [] };
  if (selection.type === "wire") {
    const wire = scene.getWire(selection.id);
    if (!wire) return outputSelectionDetails(scene, null);
    return { title: wire.label || wire.id, rows: [["Cable", wire.cableType], ["ID", wire.id],
      ["From", wire.fromDeviceId || wire.fromSurfaceId], ["To", wire.toDeviceId || wire.toSurfaceId],
      ["Length", wire.length], ["Notes", wire.notes]], wireIds: [wire.id] };
  }
  if (selection.type === "jump-link") {
    const link = scene.getJumpLink(selection.id);
    return { title: "Jump Link", rows: link ? [["ID", link.id], ["Output", link.outputJumpId], ["Input", link.inputJumpId]] : [], wireIds: [] };
  }
  if (selection.type === "rack") {
    const rack = scene.getRack(selection.id);
    return { title: rack?.name || "Rack", rows: [["ID", rack?.id], ["Devices", rack?.childDeviceIds.length],
      ["Exposed ports", rack?.exposedPorts.length]], wireIds: scene.wires.filter(w => w.rackId === selection.id).map(w => w.id) };
  }
  const device = scene.getDevice(selection.deviceId || selection.id);
  if (!device) return outputSelectionDetails(scene, null);
  const connector = selection.type === "connector" ? scene.getConnector(device.id, selection.id) : null;
  const rows = connector ? [["Device", device.label], ["ID", connector.id], ["Type", connector.type],
    [connector.nameTextCaption || "Name", connector.nameText],
    [connector.resolutionFrameRateCaption || "Resolution", connector.resolutionFrameRate],
    [connector.customTextCaption || "Custom", connector.customText], ["Status", connector.operationalStatus]]
    : [["ID", device.id], ["Brand", device.brand], ["Model", device.model], ["Category", device.category],
      ["Type", device.kind], ["Notes", device.notes], ["Text", device.visual.text]];
  if (device.kind === "jump") rows.push(["Role", jumpNodeRoleLabel(scene.jumpNodeRole(device.id).role)],
    ["Base role", jumpNodeRoleLabel(scene.jumpNodeRole(device.id).baseRole)]);
  const wireIds = scene.wires.filter(w => ["from", "to"].some(end =>
    (w[`${end}DeviceId`] === device.id || w[`${end}SurfaceId`] === device.id)
    && (!connector || w[`${end}ConnectorId`] === connector.id))).map(w => w.id);
  return { title: connector?.nameText || connector?.label || device.label, rows, wireIds };
}

export function outputCableTrace(model, selection) {
  if (!selection) return [];
  const link = selection.type === "jump-link" ? model.contract.jumpLinks.find(l => l.id === selection.id)
    : selection.type === "device" ? model.contract.jumpLinks.find(l => l.inputJumpId === selection.id || l.outputJumpId === selection.id) : null;
  if (link) return [{ id: link.id, type: "jump-link", points: link.polyline, color: "#32b6ff" }];
  const wire = model.scene.getWire(selection.id);
  if (selection.type !== "wire" || !wire) return [];
  // Adapt only endpoint identity for the existing semantic tracer. All geometry
  // comes directly from the immutable contract, never a production project.
  const endpoint = (w, end) => {
    const deviceId = w[`${end}DeviceId`];
    return model.scene.getDevice(deviceId)?.kind === "jump" ? { jumpNodeId: deviceId }
      : { deviceId, surfaceId: w[`${end}SurfaceId`], connectorId: w[`${end}ConnectorId`] };
  };
  const project = { jumpLinks: model.contract.jumpLinks,
    jumpNodes: model.contract.devices.filter(d => d.kind === "jump"),
    connections: model.contract.wires.map(w => ({ ...w, from: endpoint(w, "from"), to: endpoint(w, "to") })) };
  const steps = resolvePlayableSignalPath({ startingWireId: wire.id, project,
    getConnector: end => model.scene.getConnector(end.deviceId, end.connectorId) });
  return steps.flatMap(step => {
    const item = step.type === "teleport" ? model.contract.jumpLinks.find(l => l.id === step.jumpLinkId)
      : model.contract.wires.find(w => w.id === step.wireId);
    if (!item) return [];
    const points = item.renderPolyline || item.polyline;
    return [{ id: item.id, type: step.type === "teleport" ? "jump-link" : "wire",
      points: step.reverse ? [...points].reverse() : points, color: item.color || "#32b6ff" }];
  });
}
