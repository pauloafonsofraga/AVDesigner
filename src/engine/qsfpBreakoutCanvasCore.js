import { distanceToSegment } from "./hitTest.js";
import { layerVisible, layerEditable } from "./projectLayers.js";
import { wirePolylineFromPoints } from "./wirePath.js";
import { QSFP_BREAKOUT_VERSION, breakoutId, breakoutList as list, qsfpBreakoutMode } from "./qsfpBreakoutModel.js";
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
  if (!endpoint?.anchorId) return null;
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

export function projectQsfpBreakouts(scene, assemblies, { offsets, gesture } = {}) {
  const plans = [];
  const ids = new Set();
  const ambiguous = new Set();
  for (const assembly of list(assemblies)) {
    if (ids.has(assembly?.id)) ambiguous.add(assembly.id);
    ids.add(assembly?.id);
  }
  for (const assembly of list(assemblies)) {
    if (assembly?.schemaVersion !== QSFP_BREAKOUT_VERSION || !breakoutId(assembly.id) || ambiguous.has(assembly.id)) continue;
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
      const lane = channel?.lanes?.length === 1 ? channel.lanes[0] : null;
      if (!mode.lanes.includes(lane) || assembly.channels.filter(c => list(c?.lanes).includes(lane)).length !== 1) continue;
      const tip = { x: hub.x + 80 * direction, y: hub.y + (mode.lanes.indexOf(lane) - (mode.lanes.length - 1) / 2) * 25 };
      const destination = endpointPoint(scene, branch.destination, offsets);
      // A hidden or unresolved attached endpoint is not an unplugged end.
      if (branch.destination && !destination) continue;
      const target = move?.kind === "branch" && move.branchId === branch.id && move.cursor
        ? move.targetPoint || move.cursor : destination?.point;
      const tail = wirePolylineFromPoints({}, [hub, tip], { bezierSteps: 14 });
      const outward = { x: direction, y: 0 };
      const extension = target ? wirePolylineFromPoints({}, [tip, target], { fromDirection: outward }) : [];
      branches.push({ id: branch.id, channelId: branch.channelId, lane, state: channel.state, tip, target,
        points: [...tail, ...extension.slice(1)], editable: layerEditable(source.device) && (!destination || layerEditable(destination.device)),
        color: move?.kind === "branch" && move.branchId === branch.id && move.targetError ? "#ed716e"
          : channel.state === "disabled" ? "#76838f" : destination?.color || "#60cee7" });
    }
    plans.push({ id: assembly.id, layerId: source.device.layerId, origin, hub, trunk, corners, branches,
      editable: layerEditable(source.device) });
  }
  return plans;
}

export function hitTestQsfpBreakout(plans, point, tolerance, selected) {
  const at = (target, radius = tolerance) => Math.hypot(point.x - target.x, point.y - target.y) <= radius;
  for (const plan of [...plans].reverse()) {
    if (!plan.editable) continue;
    if (selected?.assemblyId === plan.id && !selected.branchId) {
      const index = plan.corners.findIndex(corner => at(corner));
      if (index !== -1) return { assemblyId: plan.id, kind: "corner", index };
      if (at(plan.hub)) return { assemblyId: plan.id, kind: "hub" };
    }
    const branch = plan.branches.filter(item => item.editable && at(item.tip))
      .sort((a, b) => Math.hypot(point.x-a.tip.x, point.y-a.tip.y)-Math.hypot(point.x-b.tip.x, point.y-b.tip.y))[0];
    if (branch) return { assemblyId: plan.id, branchId: branch.id, kind: "tip" };
  }
  let best = null, min = tolerance;
  for (const plan of plans) {
    if (!plan.editable) continue;
    for (const [points, branchId] of [[plan.trunk, null], ...plan.branches.filter(b => b.editable).map(b => [b.points, b.id])]) {
      for (let i = 1; i < points.length; i++) {
        const { distance } = distanceToSegment(point, points[i - 1], points[i]);
        if (distance <= min) {
          min = distance;
          best = { assemblyId: plan.id, branchId, kind: branchId ? "branch" : "trunk" };
        }
      }
    }
  }
  return best;
}
