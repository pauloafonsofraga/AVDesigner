import { layerVisible, layerEditable } from "./projectLayers.js";
import { wirePolylineFromPoints } from "./wirePath.js";
import { QSFP_BREAKOUT_VERSION, breakoutId, breakoutList as list, qsfpBreakoutMode, uniquelyIdentifiedQsfpBreakouts } from "./qsfpBreakoutModel.js";
import { validateQsfpBreakoutTransition } from "./qsfpBreakoutValidation.js";

const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);
export const qsfpBreakoutDeviceId = device => device?.instanceId || device?.id || device?.deviceId;
export const qsfpBreakoutEndpoint = hit => hit?.device && hit?.connector && hit.anchorId
  ? { deviceId: hit.device.sourceId || hit.device.id, connectorId: hit.connector.id, anchorId: hit.anchorId } : null;

export function qsfpBreakoutEdit(root, edit, deviceId = null) {
  if (Object.hasOwn(root, "breakoutAssemblies") && !Array.isArray(root.breakoutAssemblies)) {
    return { error: "The imported breakout collection cannot be edited." };
  }
  const previousDevice = deviceId && root.devices.find(device => qsfpBreakoutDeviceId(device) === deviceId);
  if (deviceId && !previousDevice) return { error: "The breakout host is no longer in the project." };
  const before = {
    assemblies: Object.hasOwn(root, "breakoutAssemblies") ? structuredClone(root.breakoutAssemblies) : undefined,
    modes: previousDevice ? structuredClone(previousDevice.breakoutPortModes) : undefined
  };
  const after = { assemblies: structuredClone(before.assemblies || []), modes: structuredClone(before.modes) };
  if (edit(after) === false || JSON.stringify(before) === JSON.stringify(after)) return {};
  const afterRoot = { ...root, breakoutAssemblies: after.assemblies };
  if (previousDevice) {
    afterRoot.devices = root.devices.map(device => {
      if (device !== previousDevice) return device;
      const copy = { ...device };
      if (after.modes?.length) copy.breakoutPortModes = after.modes;
      else delete copy.breakoutPortModes;
      return copy;
    });
  }
  const diagnostics = validateQsfpBreakoutTransition(root, afterRoot);
  return diagnostics.length ? { error: diagnostics[0].message, diagnostics } : { before, after };
}

export function setQsfpBreakoutBranch(assemblies, assemblyId, branchId, destination) {
  const assembly = assemblies.find(item => item?.id === assemblyId);
  const branch = list(assembly?.branches).find(item => item?.id === branchId);
  const channel = list(assembly?.channels).find(item => item?.id === branch?.channelId);
  if (!branch || !channel || (channel.state === "disabled" && destination)
    || JSON.stringify(destination) === JSON.stringify(branch.destination)) return false;
  branch.destination = destination;
  if (channel.state !== "disabled") channel.state = destination ? "connected" : "disconnected";
  return true;
}

export function qsfpBreakoutAfterDeviceDeletion(assemblies, deviceIds) {
  let changed = false;
  const next = list(assemblies).flatMap(assembly => {
    if (assembly?.schemaVersion !== QSFP_BREAKOUT_VERSION) return [assembly];
    if (deviceIds.has(assembly?.source?.deviceId)) { changed = true; return []; }
    const attached = list(assembly?.branches).filter(branch => deviceIds.has(branch?.destination?.deviceId));
    if (!attached.length) return [assembly];
    // Do not infer channel identity for a malformed or newer record.
    if (!attached.every(branch => breakoutId(branch.id)
      && list(assembly.branches).filter(item => item?.id === branch.id).length === 1
      && list(assembly.channels).filter(channel => channel?.id === branch.channelId).length === 1)) return [assembly];
    changed = true;
    const copy = structuredClone(assembly);
    for (const branch of attached) setQsfpBreakoutBranch([copy], copy.id, branch.id, null);
    return [copy];
  });
  return changed ? next : assemblies;
}

function endpointPoint(scene, endpoint, offsets) {
  if (!breakoutId(endpoint?.deviceId) || !breakoutId(endpoint?.connectorId) || !breakoutId(endpoint?.anchorId)) return null;
  const device = scene.getDevice(endpoint.deviceId);
  const connector = device && scene.getConnector(device.id, endpoint.connectorId);
  if (!connector || !layerVisible(device) || !list(connector.anchors).some(anchor => anchor.id === endpoint.anchorId)) return null;
  const point = scene.connectorAnchorWorldPoint(device, connector, endpoint.anchorId);
  const offset = offsets?.get(device.id);
  return { point: { x: point.x + (offset?.dx || 0), y: point.y + (offset?.dy || 0) }, device, connector,
    side: connector.anchors.find(anchor => anchor.id === endpoint.anchorId)?.side || connector.side,
    color: connector.color };
}

const samePoint = (a, b) => a.x === b.x && a.y === b.y;

export function projectQsfpBreakouts(scene, assemblies, { offsets, gesture, diagnostics = [] } = {}) {
  const plans = [];
  for (const assembly of uniquelyIdentifiedQsfpBreakouts(assemblies)) {
    if (assembly.schemaVersion !== QSFP_BREAKOUT_VERSION) continue;
    const issues = diagnostics.filter(issue => issue.assemblyId === assembly.id);
    if (issues.some(issue => issue.code === "assembly-id-conflict")) continue;
    const conflict = issues.filter(issue => issue.code === "port-occupied");
    const sourceConflict = conflict.some(issue => !issue.branchId);
    const mode = qsfpBreakoutMode(assembly.modeId);
    const source = endpointPoint(scene, assembly.source, offsets);
    if (!source || !mode) continue;
    const direction = source.side === "left" ? -1 : 1;
    const origin = source.point;
    const move = gesture?.assemblyId === assembly.id ? gesture : null;
    const cageIndex = source.device.connectors.filter(connector => connector.physicalType === "qsfp-cage"
      && connector.anchors.some(anchor => anchor.side === source.side)).indexOf(source.connector);
    const offset = finitePoint(assembly.fanoutOffset) ? assembly.fanoutOffset
      : { x: (125 + Math.max(0, cageIndex) * 60) * direction, y: 0 };
    const hub = move?.kind === "hub" ? move.cursor : { x: origin.x + offset.x, y: origin.y + offset.y };
    const route = list(assembly.routePoints).filter(finitePoint);
    const corners = route.map((point, index) => move?.kind === "corner" && move.index === index ? move.cursor : point);
    if (move?.kind === "add-point") corners.push(move.cursor);
    const points = [origin, ...corners, hub].filter((point, i, all) => !i || !samePoint(point, all[i - 1]));
    const trunk = wirePolylineFromPoints({ routeStyle: assembly.routeStyle, routePoints: corners, manualRoute: true }, points);
    const branches = [];
    for (const branch of list(assembly.branches)) {
      if (!breakoutId(branch?.id) || assembly.branches.filter(b => b?.id === branch.id).length !== 1) continue;
      const channels = list(assembly.channels).filter(channel => channel?.id === branch.channelId);
      const channel = channels.length === 1 ? channels[0] : null;
      const lane = list(channel?.lanes).length === 1 ? channel.lanes[0] : null;
      if (!mode.lanes.includes(lane) || list(assembly.channels).filter(c => list(c?.lanes).includes(lane)).length !== 1) continue;
      const tip = { x: hub.x + 80 * direction, y: hub.y + (mode.lanes.indexOf(lane) - (mode.lanes.length - 1) / 2) * 25 };
      const destination = endpointPoint(scene, branch.destination, offsets);
      // A hidden or unresolved attached endpoint is not an unplugged end.
      if (branch.destination && !destination) continue;
      const target = move?.kind === "branch" && move.branchId === branch.id && move.cursor
        ? move.targetPoint || move.cursor : destination?.point;
      const tail = wirePolylineFromPoints({}, [hub, tip], { bezierSteps: 14 });
      const outward = { x: direction, y: 0 };
      const extension = target ? wirePolylineFromPoints({}, [tip, target], { fromDirection: outward }) : [];
      const branchConflict = sourceConflict || conflict.some(issue => issue.branchId === branch.id);
      branches.push({ id: branch.id, channelId: branch.channelId, lane, state: channel.state, tip, target,
        destination: branch.destination || null,
        points: [...tail, ...extension.slice(1)], editable: layerEditable(source.device) && (!destination || layerEditable(destination.device)),
        color: branchConflict || (move?.kind === "branch" && move.branchId === branch.id && move.targetError) ? "#ed716e"
          : channel.state === "disabled" ? "#76838f" : destination?.color || "#60cee7" });
    }
    plans.push({ id: assembly.id, source: assembly.source, layerId: source.device.layerId, origin, hub, trunk, corners, branches,
      ...(sourceConflict ? { color: "#ed716e" } : {}),
      editable: layerEditable(source.device) });
  }
  return plans;
}

export { hitTestQsfpBreakout } from "./qsfpBreakoutHitTest.js";
