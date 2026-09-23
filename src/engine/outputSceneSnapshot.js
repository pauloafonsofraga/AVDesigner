import { normalizeAvDesignerProject } from "./projectAdapter.js";
import { SceneGraph, deviceBounds } from "./sceneGraph.js";
import { connectorDisplayAnchors, SHARED_BUS_NODE_LINE_INSET } from "./connectorDisplayLayout.js";
import { sharedBusOrthogonalSegments } from "./sharedBusRendering.js";
import { calculateCableHops, applyCableHopsToPolyline } from "./cableHops.js";
import { jumpNodeCenter, jumpLinkBezierPolyline } from "./jumpNodeModel.js";

import { OUTPUT_SCENE_VERSION, OUTPUT_SCENE_SOURCE, OUTPUT_SCENE_SCHEMA_FINGERPRINT } from "./outputSceneContract.js";
export { OUTPUT_SCENE_VERSION, OUTPUT_SCENE_SOURCE, OUTPUT_SCENE_SCHEMA_FINGERPRINT } from "./outputSceneContract.js";

// Reject non-data values rather than silently retaining runtime resources.
function plainData(value) {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value ?? null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite Engine output scene number");
    return value;
  }
  if (Array.isArray(value)) return value.map(plainData);
  if (typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError("Engine output scenes require plain serializable data");
  }
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, plainData(item)]));
}

function freezeData(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeData);
    Object.freeze(value);
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

// A versioned, non-cryptographic parity fingerprint. Array order is significant.
export function outputSceneSignature(data) {
  const { signature, ...content } = data;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(stableJson(content))) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `engine-scene-v${OUTPUT_SCENE_VERSION}-${hash.toString(16).padStart(16, "0")}`;
}

function geometryBounds(rects, points) {
  const all = [...points, ...rects.flatMap(rect => [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }
  ])];
  if (!all.length) return null;
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of all) {
    x = Math.min(x, point.x); y = Math.min(y, point.y);
    right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
  }
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** Serialize a detached Engine graph; never serialize its Maps or runtime indexes. */
export function buildEngineOutputScene(projectSnapshot = {}) {
  const project = plainData(projectSnapshot);
  const root = project.state || project.project || project;
  const scene = new SceneGraph();
  // The interactive adapter supplies a demo graph for an empty document. An
  // output contract must describe the empty document, not that demonstration.
  const empty = !["devices", "areas", "imageObjects", "images", "jumpNodes", "ledSurfaces", "titleBlocks", "comments"]
    .some(key => Array.isArray(root[key]) && root[key].length);
  const normalized = empty ? null : normalizeAvDesignerProject(project);
  scene.setData(empty ? { meta: { cableHops: root.cableHops !== false } } : normalized);
  const devices = scene.devices.map(({ connectorsById, ...device }) => device);
  const connectors = scene.devices.flatMap(device => device.connectors.map((connector, index) => ({
    deviceId: device.id, connectorId: connector.id, index,
    worldPoint: scene.connectorWorldPoint(device, connector),
    anchors: connectorDisplayAnchors(device, connector, scene.connectorDisplayLayoutForDevice(device)).map(anchor => ({
      ...anchor, worldPoint: scene.connectorAnchorWorldPoint(device, connector, anchor.id)
    })),
    visible: scene.isConnectorVisibleOnCanvas(device, connector),
    selectable: scene.isConnectorSelectableOnCanvas(device, connector)
  })));
  const hopResult = calculateCableHops(scene, { enabled: scene.meta.cableHops !== false });
  const wires = scene.wires.map(wire => {
    const polyline = scene.wireRenderPolyline(wire);
    const cableHops = hopResult.hopsByWireId.get(wire.id) || [];
    return { ...wire, endpoints: { from: scene.endpointForWire(wire, "from"), to: scene.endpointForWire(wire, "to") },
      points: scene.wirePoints(wire), polyline, cableHops, renderPolyline: applyCableHopsToPolyline(polyline, cableHops) };
  });
  const sharedBuses = scene.devices.flatMap(device => scene.connectorDisplayLayoutForDevice(device).groups.map(group => {
    const cardSlotId = group.points[0]?.connector?.cardSlotId || "";
    const body = device.visual.visualCards.find(card => card.id === cardSlotId) || { x: 0, width: device.width };
    return { deviceId: device.id, relationshipId: group.relationshipId, cardSlotId, side: group.side,
      connectorIds: group.members.map(connector => connector.id),
      fieldJunction: { x: device.x + group.fieldJunctionX, y: device.y + group.centerY },
      segments: sharedBusOrthogonalSegments(group, body, {
        nodeInset: SHARED_BUS_NODE_LINE_INSET, offsetX: device.x, offsetY: device.y
      }) };
  }));
  const jumpLinks = scene.jumpLinks.map(link => {
    const from = jumpNodeCenter(scene.getDevice(link.outputJumpId));
    const to = jumpNodeCenter(scene.getDevice(link.inputJumpId));
    return { ...link, from, to, polyline: jumpLinkBezierPolyline(from, to) };
  });
  const ledSurfaces = scene.devices.filter(device => device.kind === "led-surface").map(device => ({
    id: device.id, wireIds: scene.orderedLedSurfaceWires(device.id).map(wire => wire.id)
  }));
  const cards = scene.devices.flatMap(device => device.visual.visualCards.map(card => ({ deviceId: device.id, ...card })));
  const rackExposure = scene.racks.map(rack => scene.rackConnectorDiagnostics(rack.id));
  const { calcMs, ...hopDiagnostics } = hopResult.stats;
  const warnings = empty ? [] : [...(scene.meta.jumpLinkWarnings || []), ...(scene.meta.jumpLinkIndexWarnings || [])];
  const skippedWires = empty ? (root.connections || []).length : normalized.meta.skippedWires || 0;
  if (skippedWires) warnings.push(`${skippedWires} project wires could not be normalized.`);
  if (!empty && normalized.wires.length !== scene.wires.length) warnings.push("SceneGraph rejected normalized wire endpoints.");
  const data = plainData({
    version: OUTPUT_SCENE_VERSION, schemaFingerprint: OUTPUT_SCENE_SCHEMA_FINGERPRINT, sceneDataSource: OUTPUT_SCENE_SOURCE,
    coordinateSpace: "engine-world", devices, connectors, wires, racks: scene.racks,
    jumpLinks, ledSurfaces, cards, sharedBuses, rackExposure,
    sceneBounds: scene.bounds(),
    bounds: geometryBounds([...scene.devices.map(deviceBounds), ...scene.racks.map(rack => rack.bounds)],
      [...wires.flatMap(wire => wire.renderPolyline), ...jumpLinks.flatMap(link => link.polyline),
        ...connectors.flatMap(connector => connector.anchors.map(anchor => anchor.worldPoint))]),
    diagnostics: { counts: { objects: devices.length, connectors: connectors.length, wires: wires.length,
      racks: scene.racks.length, cards: cards.length, sharedBuses: sharedBuses.length,
      jumpLinks: jumpLinks.length, ledSurfaces: ledSurfaces.length },
      adapter: scene.adapterStats(),
      skippedWires, cableHops: hopDiagnostics, warnings }
  });
  data.signature = outputSceneSignature(data);
  return freezeData(data);
}
