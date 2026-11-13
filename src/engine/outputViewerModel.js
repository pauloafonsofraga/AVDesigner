import { SceneGraph } from "./sceneGraph.js";
import {formatCableNumber} from "./cableNumbering.js";
import {cableFamily} from "./cableScheduleCore.js";
import { deviceHeaderLabel } from "./deviceDisplayName.js";
import {sharedBusTypeLabels} from './sharedBusLabels.js';
import { resolvePlayableSignalPath, jumpNodeRoleLabel } from "./jumpNodeModel.js";
import { resolveOutputDeviceAssets } from "./outputViewerAssets.js";
import { assertOutputSceneContract } from "./outputSceneContract.js";
import { engineCompatibilitySummary, engineConnectorTypeDisplayName, engineConnectorUserFacingTypeLabel } from "./connectorCompatibility.js";
import { normalizeRackShell, rackShellStyle } from "./rackShell.js";
import { multiCorePortReference } from "./multiCoreProjection.js";
import { integratedCableWireValidation, isDacCableType, isIntegratedCableType, isTransceiverCage, transceiverModulePresentation } from "./transceiverModules.js";
import { stageboxSignalPath } from "./stageboxSignalPath.js";
import { qsfpBreakoutChannels, qsfpBreakoutMode, qsfpBreakoutModeLabel, qsfpBreakoutCableLabel, qsfpBreakoutLengthLabel } from "./qsfpBreakoutModel.js";
import { qsfpBreakoutPlaybackStep } from "./qsfpBreakoutPlayback.js";

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
  scene.readOnly=true;
  scene.qsfpBreakouts = contract.qsfpBreakouts;
  const racks = contract.racks.map(rack => {
    const shell = normalizeRackShell(rack.rackShell);
    const source = rackShellStyle(shell).src;
    return { ...rack, rackShell: shell, rackShellImage: assets?.[source] || source };
  });
  scene.setData({ devices: contract.devices.map(d => resolveOutputDeviceAssets(d, assets)), wires: contract.wires, racks,
    jumpLinks: contract.jumpLinks, looms: contract.looms, loomPlans: contract.loomPlans,
    projectData: contract.layers ? {...(contract.modelData ? {multiCores:contract.modelData.multiCores} : {}), layers:contract.layers,
      looms:contract.looms, connections:contract.wires, racks:contract.racks, jumpLinks:contract.jumpLinks}
      : contract.modelData ? { multiCores: contract.modelData.multiCores } : null,
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
  if (selection.type === "qsfp-breakout") {
    const assembly = scene.qsfpBreakouts?.assemblies.find(item => item?.id === selection.id);
    if (!assembly) return outputSelectionDetails(scene, null);
    const mode = qsfpBreakoutMode(assembly.modeId), cable = qsfpBreakoutCableLabel(assembly.cableType);
    const portLabel = ref => {
      const device = scene.getDevice(ref?.deviceId), connector = scene.getConnector(ref?.deviceId, ref?.connectorId);
      return ref ? `${device?.label || ref.deviceId} / ${connector ? connectedPortName(connector, device) : ref.connectorId}` : "None";
    };
    const channels = qsfpBreakoutChannels(assembly);
    const selected = channels.find(channel => selection.branchId && channel.branchId === selection.branchId);
    const lane = channel => `Lane ${channel.lanes.join(", ") || "?"}`;
    return { title: selected ? `${cable} / ${lane(selected)}` : cable, wireIds: [], breakoutChannels: channels,
      rows: [["Assembly ID", assembly.id], ["Mode", qsfpBreakoutModeLabel(mode)],
        ["Source", portLabel(assembly.source)], ["Physical Length", qsfpBreakoutLengthLabel(assembly.length)],
        ...(selected ? [["Channel ID", selected.channelId], ["Rate", mode?.branchRate], ["State", selected.state],
          ["Destination", portLabel(selected.destination)]] : channels.map(channel => [
          lane(channel), `${channel.state || "unverified"} / ${portLabel(channel.destination)}`
        ]))] };
  }
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
    if (wire.stageboxAssemblyId) return { title: scene.getDevice(wire.stageboxAssemblyId)?.label || "Stagebox / Snake", rows: [["Part", "Internal trunk"]], wireIds: [] };
    if (wire.multiCoreIdentity) return { title: wire.label, rows: [["Part", "Multi-Core trunk"], ["Length", wire.length], ["Route style", wire.routeStyle]], wireIds: [] };
    const endpointLabel = end => {
      const deviceId = wire[`${end}DeviceId`] || wire[`${end}SurfaceId`];
      const device = scene.getDevice(deviceId);
      const connector = scene.getConnector(deviceId, wire[`${end}ConnectorId`]);
      const port = connector?.nameText || engineConnectorUserFacingTypeLabel(connector);
      return [device?.label || deviceId || "Unknown device", port].filter(Boolean).join(" / ");
    };
    const readableType = cableTypeName(wire.cableType);
    const cableNumber = formatCableNumber(wire.cableNumber, cableFamily(wire.cableType));
    const title = wire.label && wire.label !== wire.cableType && wire.label !== wire.id
      ? wire.label : cableNumber || readableType;
    const assemblyRows = [];
    if (isIntegratedCableType(wire.cableType)) {
      const hit = end => ({ device: scene.getDevice(wire[`${end}DeviceId`]),
        connector: scene.getConnector(wire[`${end}DeviceId`], wire[`${end}ConnectorId`]) });
      const from = hit("from"), to = hit("to");
      const pairing = engineCompatibilitySummary(from, to);
      const check = pairing.valid ? integratedCableWireValidation(wire, from.connector, to.connector) : pairing;
      const status = !check.valid ? "Incompatible" : check.warnings?.length ? "Unverified" : "Compatible";
      const details = check.valid ? check.warnings?.join(" ") : check.reason;
      assemblyRows.push(["Assembly", isDacCableType(wire.cableType) ? "Integrated direct-attach copper (DAC)" : "Integrated active optical cable (AOC)"],
        ["Supported rates", Array.isArray(wire.cableAssembly?.supportedRates) && wire.cableAssembly.supportedRates.join(", ") || "Unverified"],
        ["Compatibility", details ? `${status}: ${details}` : status]);
    }
    return { title, rows: [
      ["Cable", readableType],
      ["Cable ID", cableNumber],
      ["From", endpointLabel("from")], ["To", endpointLabel("to")],
      ["Length", wire.length], ["Notes", wire.notes],
      ...assemblyRows
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
  const rows = connector ? [["Device", deviceHeaderLabel(device)], ["ID", connector.id], ["Type", engineConnectorUserFacingTypeLabel(connector)],
    [connector.nameTextCaption || "Name", connector.nameText],
    [connector.resolutionFrameRateCaption || "Resolution", connector.resolutionFrameRate],
    [connector.customTextCaption || "Custom", connector.customText], ["Status", connector.operationalStatus]]
    : [["Brand", device.brand], ["Model", device.model], ["Category", device.category],
      ["Notes", device.notes], ["Text", device.visual.text]];
  if (device.kind === "jump") rows.push(["Role", jumpNodeRoleLabel(scene.jumpNodeRole(device.id).role)],
    ["Base role", jumpNodeRoleLabel(scene.jumpNodeRole(device.id).baseRole)]);
  if (connector && isTransceiverCage(connector)) rows.push(["Installed Module", transceiverModulePresentation(connector)]);
  const bus=connector && scene.connectorDisplayLayoutForDevice(device).byConnectorId.get(connector.id)?.layout;
  if(bus)rows.push(['Shared Bus Types',sharedBusTypeLabels(bus.members).join(' / ')],
    ...bus.members.map(c=>[c.nameText||c.label||c.id,engineConnectorUserFacingTypeLabel(c)]));
  const wireIds = scene.wires.filter(w => !w.multiCoreIdentity && !w.stageboxAssemblyId && ["from", "to"].some(end =>
    (w[`${end}DeviceId`] === device.id || w[`${end}SurfaceId`] === device.id)
    && (!connector || w[`${end}ConnectorId`] === connector.id))).map(w => w.id);
  return { title: connector?.nameText || (connector ? engineConnectorUserFacingTypeLabel(connector) : deviceHeaderLabel(device)), rows, wireIds };
}

export function outputCableTrace(model, selection) {
  if (!selection) return [];
  if (selection.type === "qsfp-breakout") {
    const section = model.contract.qsfpBreakouts;
    const step = section && qsfpBreakoutPlaybackStep(section.plans, section.links, selection.id, selection.branchId);
    return step ? [step] : [];
  }
  const link = selection.type === "jump-link" ? model.contract.jumpLinks.find(l => l.id === selection.id)
    : selection.type === "device" ? model.contract.jumpLinks.find(l => l.inputJumpId === selection.id || l.outputJumpId === selection.id) : null;
  if (link) return [{ id: link.id, type: "jump-link", points: link.polyline, color: "#32b6ff" }];
  const wire = model.scene.getWire(selection.id);
  if (selection.type !== "wire" || !wire || wire.multiCoreIdentity || wire.stageboxAssemblyId) return [];
  const byId = new Map(model.contract.wires.map(wire => [wire.id, wire]));
  const stagebox = stageboxSignalPath(model.scene, { wire, polyline: wire => byId.get(wire.id)?.renderPolyline || [] });
  if (stagebox.length) return stagebox.map(step => ({ ...step, id: step.wireId || step.trunkId }));
  // Adapt only endpoint identity for the existing semantic tracer. All geometry
  // comes directly from the immutable contract, never a production project.
  const endpoint = (w, end) => {
    const deviceId = w[`${end}DeviceId`];
    const device = model.scene.getDevice(deviceId);
    if (device?.multiCoreIdentity) return multiCorePortReference(device, w[`${end}ConnectorId`]);
    return model.scene.getDevice(deviceId)?.kind === "jump" ? { jumpNodeId: deviceId }
      : { deviceId, surfaceId: w[`${end}SurfaceId`], connectorId: w[`${end}ConnectorId`] };
  };
  const project = { jumpLinks: model.contract.jumpLinks,
    jumpNodes: model.contract.devices.filter(d => d.kind === "jump"),
    connections: model.contract.wires.filter(w => !w.multiCoreIdentity && !w.stageboxAssemblyId).map(w => ({ ...w, from: endpoint(w, "from"), to: endpoint(w, "to") })) };
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
