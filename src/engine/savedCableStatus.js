import { engineCompatibilitySummary, engineConnectorCompatibilityType, engineConnectorForSavedCableValidation,
  engineSyntheticCableEndDirection, isEngineCageConnector } from "./connectorCompatibility.js";
import { connectorVisualAnchors, exclusiveConnectionRejectionReason } from "./deviceDefinitionV2.js";
import { jumpCompatibleHitForDeviceWire } from "./jumpNodeModel.js";
import { integratedCableWireValidation, isIntegratedCableType, isDacCableType } from "./transceiverModules.js";
import { projectWireEndpoint as endpoint } from "./projectWireEndpoint.js";
import { hasPhysicalConnectorMetadata } from "./physicalConnectorMetadata.js";

const list = value => Array.isArray(value) ? value : [];
export const connectionStatusText = status => status
  ? [status.label, status.messages.join(" ")].filter(Boolean).join(": ") : "";

export function savedCableChecks(raw, wire, scene, nodeDefinitions = new Map(), deviceIds = null) {
  const issues = [], warnings = [];
  const add = (code, message) => issues.push({ code, message });
  for(const key of ['routePoints','orthogonalRoutePoints','loomEntryRoutePoints','loomExitRoutePoints'])if(raw[key]!==undefined) {
    if(!Array.isArray(raw[key]))add(key,'Route control points must be an ordered array.');
    for(const point of list(raw[key]))if(!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))add(key,'Route control point has invalid coordinates.');
  }
  if (!wire) { add('endpoint','Cable could not resolve both endpoints.'); return { issues, warnings }; }
  const hits = ['from','to'].map(end=>{
    const device = scene.getDevice(wire[`${end}DeviceId`] || wire[`${end}SurfaceId`]);
    const connector = scene.getConnector(wire[`${end}DeviceId`],wire[`${end}ConnectorId`]);
    return {device,connector};
  });
  const refs = ['from','to'].map(end => endpoint(raw, end));
  for (let i=0;i<2;i++) {
    const end = i ? 'to' : 'from', ref = refs[i], hit = hits[i];
    if(ref?.deviceId && (deviceIds ? deviceIds.has(ref.deviceId) : scene.getDevice(ref.deviceId)) && (typeof ref.connectorId!=='string' || !ref.connectorId))add(`${end}-identity`,'Physical endpoint requires a stable connector identity.');
    if ((!raw[end] && !ref.deviceId && !ref.surfaceId) || !hit.device || (!wire[`${end}SurfaceId`] && !hit.connector)) add(`${end}-endpoint`,'Missing object or connector.');
    if (ref?.anchorId && hit.connector && !connectorVisualAnchors(hit.connector,hit.device).some(a=>a.id===ref.anchorId)) add(`${end}-anchor`,'Missing connector anchor.');
    if (!hit.connector || !hit.device || wire[`${end}SurfaceId`]) continue;
    const multiple = hit.connector.adapterMultipleExternalConnections || hit.device.visual?.adapterMapping?.multipleExternalConnections;
    const integrated = isIntegratedCableType(engineConnectorCompatibilityType(hit.connector));
    if ((!multiple || integrated) && scene.connectorExternalWireIds(hit.device.id,hit.connector.id).size>1) add(`${end}-occupied`,'Connector has multiple external cables.');
    const exclusive = exclusiveConnectionRejectionReason(scene,hit,wire.id);
    if (exclusive) add(`${end}-exclusive`,exclusive);
  }
  if (isIntegratedCableType(raw.cableType) || raw.cableAssembly) {
    const assembly = integratedCableWireValidation(raw,hits[0].connector,hits[1].connector);
    if (!assembly.valid) add(isDacCableType(raw.cableType)?'dac':'assembly',assembly.reason);
    else warnings.push(...(assembly.warnings || []));
  }
  if (hits.some(h=>!h.connector) || refs.some(ref => ref.multiCoreId) || wire.fromSurfaceId || wire.toSurfaceId) return { issues, warnings };
  let [a,b] = hits;
  if (a.device.kind==='jump' && b.device.kind!=='jump') a = jumpCompatibleHitForDeviceWire(a,b);
  if (b.device.kind==='jump' && a.device.kind!=='jump') b = jumpCompatibleHitForDeviceWire(b,a);
  const check = engineCompatibilitySummary(a,b);
  if (!check.valid) add('compatibility',check.reason);
  else warnings.push(...check.warnings);
  if (raw.cableType && !isIntegratedCableType(raw.cableType) && hits.every(h=>h.device.kind!=='jump')) {
    const transceiverLink = raw.cableType==='sdi' || hits.some(hit=>isEngineCageConnector(hit.connector));
    for (const [index,hit] of hits.entries()) {
      const node = nodeDefinitions.get(raw.cableType);
      const cable = {device:{id:`cable:${raw.id}`},connector:{id:'cable-end',type:raw.cableType,compatibilityType:node?.compatibilityType,
        direction:engineSyntheticCableEndDirection(hit.connector,index?'to':'from',transceiverLink),fiberMode:raw.fiberMode || ''}};
      const connector = engineConnectorForSavedCableValidation(hit.connector, hits[1-index].connector, raw.fiberMode);
      const saved = engineCompatibilitySummary({...hit,connector},cable);
      if (!saved.valid) add('cable-type',saved.reason);
    }
  }
  return { issues, warnings };
}

// Shared operational gate for transceivers and opt-in multifunction declarations.
// Untagged historical connectors retain their existing rules.
export function collectSavedTransceiverStatuses(project, scene, breakoutValidation) {
  const statuses = new Map();
  const wires = new Map(scene.wires.map(wire => [wire.sourceId || wire.id, wire]));
  const nodes = new Map(list(project.nodeLibrary).map(node => [node.id, node]));
  const occupied = new Set((breakoutValidation?.diagnostics || [])
    .flatMap(issue => issue.code === "port-occupied" ? issue.conflictingWires || [] : []));
  for (const raw of list(project.connections)) {
    if (!raw?.id) continue;
    const wire = wires.get(raw.id);
    const touchesCage = ["from", "to"].some(end => {
      const ref = endpoint(raw, end);
      return isEngineCageConnector(scene.getConnector(wire?.[`${end}DeviceId`] || ref.deviceId, wire?.[`${end}ConnectorId`] || ref.connectorId));
    });
    const touchesDeclaredMpo = ["from", "to"].some(end => {
      const ref = endpoint(raw, end);
      const port = scene.getConnector(wire?.[`${end}DeviceId`] || ref.deviceId, wire?.[`${end}ConnectorId`] || ref.connectorId);
      return engineConnectorCompatibilityType(port) === "fiber-mpo" && port?.mpoPhysical != null;
    });
    const touchesPhysicalDeclaration = ["from", "to"].some(end => {
      const ref = endpoint(raw, end);
      const port = scene.getConnector(wire?.[`${end}DeviceId`] || ref.deviceId, wire?.[`${end}ConnectorId`] || ref.connectorId);
      return hasPhysicalConnectorMetadata(port, engineConnectorCompatibilityType(port));
    });
    if (!touchesCage && !touchesDeclaredMpo && !touchesPhysicalDeclaration && !isIntegratedCableType(raw.cableType) && !raw.cableAssembly && !occupied.has(raw.id)) continue;
    const { issues, warnings } = savedCableChecks(raw, wire, scene, nodes);
    if (occupied.has(raw.id)) issues.push({ code: "port-occupied", message: "A physical port is already occupied by a QSFP breakout end." });
    const status = issues.length ? "incompatible" : warnings.length ? "unverified" : "compatible";
    statuses.set(raw.id, { status, label: status === "incompatible" ? "Incompatible" : status === "unverified" ? "Unverified" : "Compatible",
      messages: [...new Set(issues.length ? issues.map(issue => issue.message) : warnings)] });
  }
  return statuses;
}
