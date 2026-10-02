import { SceneGraph } from "./sceneGraph.js";
import { resolvePlayableSignalPath, jumpNodeRoleLabel } from "./jumpNodeModel.js";
import { resolveOutputDeviceAssets } from "./outputViewerAssets.js";
import { assertOutputSceneContract } from "./outputSceneContract.js";
import { engineConnectorTypeDisplayName, engineConnectorUserFacingTypeLabel } from "./connectorCompatibility.js";

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function createOutputViewerModel(snapshot, { assets } = {}) {
  const start = performance.now();
  const source = snapshot?.engineScene || snapshot;
  assertOutputSceneContract(source);
  const contract = freeze(JSON.parse(JSON.stringify(source)));
  const scene = new SceneGraph();
  scene.setData({ devices: contract.devices.map(d => resolveOutputDeviceAssets(d, assets)), wires: contract.wires, racks: contract.racks,
    jumpLinks: contract.jumpLinks, looms: contract.looms, loomPlans: contract.loomPlans,
    meta: { cableHops: contract.diagnostics?.cableHops?.enabled !== false } });
  return { contract, scene, normalizationMs: performance.now() - start };
}

export function outputJumpLinkOverlays(model, selection, hoveredJumpId = null) {
  // Match the editor's transient reveal rules without changing output geometry.
  return model.contract.jumpLinks.flatMap(link => {
    const contains = id => id === link.outputJumpId || id === link.inputJumpId;
    const mode = selection?.type === "jump-link" && selection.id === link.id ? "link-selected"
      : selection?.type === "device" && contains(selection.id) ? "pair-selected"
      : contains(hoveredJumpId) ? "hover" : null;
    return mode ? [{ ...link, points: link.polyline, mode }] : [];
  });
}

function cableTypeName(type) {
  const fallback = String(type || "").replace(/[-_]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
  return engineConnectorTypeDisplayName(type, fallback || "Cable");
}

function connectedPortName(connector, device) {
  if (device?.kind === "jump") return "Portal";
  if (!connector) return device?.kind === "led-surface" ? "LED Screen" : "Connector";
  return connector.nameText || engineConnectorUserFacingTypeLabel(connector);
}

export function outputConnectedNodeItems(scene, deviceId, connectorId = "") {
  const device = scene.getDevice(deviceId);
  if (!device) return [];
  return scene.wires.flatMap(wire => ["from", "to"].flatMap(side => {
    const localId = wire[`${side}DeviceId`] || wire[`${side}SurfaceId`];
    const localConnectorId = wire[`${side}ConnectorId`];
    if (localId !== deviceId || (connectorId && localConnectorId !== connectorId)) return [];
    const connector = scene.getConnector(deviceId, localConnectorId);
    if (!connector) return [];
    const otherSide = side === "from" ? "to" : "from";
    const otherId = wire[`${otherSide}DeviceId`] || wire[`${otherSide}SurfaceId`];
    const otherDevice = scene.getDevice(otherId);
    const otherConnectorId = wire[`${otherSide}ConnectorId`];
    const otherConnector = scene.getConnector(otherId, otherConnectorId);
    return [{ wireId: wire.id, deviceId, connectorId: localConnectorId,
      otherDeviceId: otherId, otherConnectorId, otherSide,
      port: connectedPortName(connector, device),
      destination: `${side === "from" ? "To" : "From"} ${otherDevice?.label || "Device"} / ${connectedPortName(otherConnector, otherDevice)}`,
      cable: `${cableTypeName(wire.cableType)}${wire.length ? ` · ${wire.length}` : ""}`,
      color: wire.color, colorSegments: wire.colorSegments,
      x: connector.x, y: connector.y }];
  })).sort((a, b) => a.y - b.y || a.x - b.x || a.wireId.localeCompare(b.wireId));
}

export function outputSelectionDetails(scene, selection) {
  if (!selection) return { title: "Inspector", rows: [], wireIds: [] };
  if (selection.type === "multi-wire") return { title: "Cables", rows: [["Selected", selection.ids.length]], wireIds: selection.ids };
  if (selection.type === "loom") {
    const loom = scene.looms.find(item => item.id === selection.id);
    const plan = scene.loomPlans.find(item => item.loomId === selection.id);
    return { title: loom?.name || "Loom", rows: [["Side A", loom?.sideA?.label || "Side A"],
      ["Side B", loom?.sideB?.label || "Side B"], ["Trunk Length", loom?.trunkLength || ""],
      ["Circuits", plan?.circuitCount || 0], ["Notes", loom?.notes || ""]],
      wireIds: [...new Set(plan?.breakouts.map(item => item.wireId) || [])] };
  }
  if (selection.type === "wire") {
    const wire = scene.getWire(selection.id);
    if (!wire) return outputSelectionDetails(scene, null);
    const endpointLabel = end => {
      const deviceId = wire[`${end}DeviceId`] || wire[`${end}SurfaceId`];
      const device = scene.getDevice(deviceId);
      const connector = scene.getConnector(deviceId, wire[`${end}ConnectorId`]);
      const port = connector?.nameText || engineConnectorUserFacingTypeLabel(connector);
      return [device?.label || deviceId || "Unknown device", port].filter(Boolean).join(" / ");
    };
    const readableType = cableTypeName(wire.cableType);
    const title = wire.label && wire.label !== wire.cableType && wire.label !== wire.id
      ? wire.label : wire.cableNumber || readableType;
    return { title, rows: [
      ["Cable", readableType],
      ["Cable ID", wire.cableNumber],
      ["From", endpointLabel("from")], ["To", endpointLabel("to")],
      ["Length", wire.length], ["Notes", wire.notes]
    ], wireIds: [wire.id] };
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
  const rows = connector ? [["Device", device.label], ["ID", connector.id], ["Type", engineConnectorUserFacingTypeLabel(connector)],
    [connector.nameTextCaption || "Name", connector.nameText],
    [connector.resolutionFrameRateCaption || "Resolution", connector.resolutionFrameRate],
    [connector.customTextCaption || "Custom", connector.customText], ["Status", connector.operationalStatus]]
    : [["Brand", device.brand], ["Model", device.model], ["Category", device.category],
      ["Notes", device.notes], ["Text", device.visual.text]];
  if (device.kind === "jump") rows.push(["Role", jumpNodeRoleLabel(scene.jumpNodeRole(device.id).role)],
    ["Base role", jumpNodeRoleLabel(scene.jumpNodeRole(device.id).baseRole)]);
  const wireIds = scene.wires.filter(w => ["from", "to"].some(end =>
    (w[`${end}DeviceId`] === device.id || w[`${end}SurfaceId`] === device.id)
    && (!connector || w[`${end}ConnectorId`] === connector.id))).map(w => w.id);
  return { title: connector?.nameText || (connector ? engineConnectorUserFacingTypeLabel(connector) : device.label), rows, wireIds };
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
