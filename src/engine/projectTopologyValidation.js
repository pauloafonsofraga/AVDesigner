import {normalizeAvDesignerProject} from './projectAdapter.js';
import {SceneGraph} from './sceneGraph.js';
import {engineCompatibilitySummary} from './connectorCompatibility.js';
import {validateConnectorTopology, normalizeConnectorRelationships, exclusiveConnectionRejectionReason, connectorVisualAnchors} from './deviceDefinitionV2.js';
import {validateJumpLinks, jumpCompatibleHitForDeviceWire} from './jumpNodeModel.js';
import {validateModularCardChanges} from './modularCardSafety.js';
import {normalizeLoom} from './loomModel.js';
import {reconcileLoomJumpAssociations, loomJumpAttachmentCompatibility} from './loomJumpAssociation.js';
import {validateMultiCoreEdit, multiCoreEditDiagnosticKey} from './multiCoreEditValidation.js';
import {createMultiCoreConnectivity} from './multiCoreConnectivity.js';
import {multiCoreJumpDiagnostics, multiCoreJumpPeer} from './multiCoreJumpRouting.js';
import {dacWireValidation, isDacCableType} from './transceiverModules.js';

const rootOf = value => value?.state || value?.project || value;
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const list = value => Array.isArray(value) ? value : [];

// Audit raw records before normalization can repair/drop broken references.
export function projectTopologyDiagnostics(input) {
  const root = rootOf(input), diagnostics = [];
  const add = (domain,id,code,message) => diagnostics.push({key:JSON.stringify([domain,id,code,message]),domain,id,code,message});
  const rawDevices=new Map(list(root.devices).map(d=>[d.instanceId || d.id || d.deviceId,d]));
  const nodeDefinitions=new Map(list(root.nodeLibrary).map(n=>[n.id,n]));
  const objectIds=new Set();
  for(const collection of ['devices','jumpNodes','ledSurfaces','imageObjects','areas','comments','titleBlocks'])for(const object of list(root[collection])) {
    const id=collection==='devices'?object.instanceId || object.id || object.deviceId:object.id;
    if(objectIds.has(id))add('identities',id,'duplicate','Canvas object identity is ambiguous.');objectIds.add(id);
    for(const key of ['x','y','width','height','rotation'])if(key in object && (!Number.isFinite(object[key]) || (['width','height'].includes(key)&&object[key]<=0)))add('geometry',id,key,`Invalid ${key}.`);
  }
  const scene = new SceneGraph();
  const hasObjects=['devices','jumpNodes','ledSurfaces','imageObjects','areas','comments','titleBlocks','multiCores','looms'].some(key=>list(root[key]).length);
  scene.setData(hasObjects ? normalizeAvDesignerProject(structuredClone(root)) : {devices:[],wires:[],projectData:root});
  const deviceIds = new Set(list(root.devices).map(d=>d.instanceId || d.id || d.deviceId));
  for (const device of scene.devices) {
    const raw = rawDevices.get(device.sourceId || device.id);
    const template = raw?.templateOverride || list(root.deviceLibrary).find(t=>t.id===raw?.templateId) || raw;
    if (!raw) continue;
    for(const [kind,records] of [['slot',template?.cardSlots],['card',template?.cardTypes],['connector',template?.connectors]]) {
      const ids=new Set();
      for(const record of list(records)) {
        if(!record?.id || ids.has(record.id))add('identities',device.id,kind,`${kind} identity is missing or duplicated.`);
        ids.add(record?.id);
      }
    }
    const relationships = template?.connectorRelationships || template?.connectorTopology?.relationships || [];
    if(normalizeConnectorRelationships(relationships,device.connectors || []).length!==relationships.length)add('connectors',device.id,'relationship-normalization','Connector relationship cannot be resolved without repair.');
    for (const message of validateConnectorTopology(device.connectors || [],relationships).errors) add('connectors',device.id,'relationship',message);
    for (const relationship of relationships) for (const key of ['sourceConnectorId','targetConnectorId']) {
      if (relationship[key] && !(device.connectors || []).some(c=>c.id===relationship[key])) add('connectors',device.id,'relationship-endpoint',`${relationship.id} references missing connector ${relationship[key]}.`);
    }
    for (const slot of list(template?.cardSlots)) if (slot.installedCardTypeId && !list(template.cardTypes).some(c=>c.id===slot.installedCardTypeId)) {
      add('cards',device.id,'missing-card',`Slot ${slot.id} references missing card ${slot.installedCardTypeId}.`);
    }
  }
  for (const node of list(root.jumpNodes)) if (node.attachedDeviceId && !deviceIds.has(node.attachedDeviceId)) {
    add('jumps',node.id,'attachment','Attached device is missing.');
  }
  const jumpValidation = validateJumpLinks(root,{compatibilitySummary:(a,b)=>engineCompatibilitySummary({...a,device:{id:'jump-source'}},{...b,device:{id:'jump-target'}}),
    getConnector:end=>scene.getConnector(end.deviceId,end.connectorId)});
  for (const message of jumpValidation.warnings) add('jumps','links','pair',message);
  const mc = createMultiCoreConnectivity(root);
  for (const d of [...(mc.diagnostics || []),...multiCoreJumpDiagnostics(root)]) if (d.severity==='error') {
    add('multiCores',d.multiCoreId || d.wireId || '',d.code,d.message);
    diagnostics.at(-1).key=multiCoreEditDiagnosticKey(d,root);
  }
  const mcWireIds = new Set(list(root.connections).filter(w=>[w.from,w.to].some(e=>e?.multiCoreId)).map(w=>w.id));
  const sceneWires=new Map(scene.wires.map(w=>[w.sourceId || w.id,w]));
  for (const raw of list(root.connections)) {
    for(const key of ['routePoints','orthogonalRoutePoints','loomEntryRoutePoints','loomExitRoutePoints'])if(raw[key]!==undefined) {
      if(!Array.isArray(raw[key]))add('cables',raw.id,key,'Route control points must be an ordered array.');
      for(const point of list(raw[key]))if(!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))add('cables',raw.id,key,'Route control point has invalid coordinates.');
    }
    const wire = sceneWires.get(raw.id);
    if (!wire) {add('cables',raw.id,'endpoint','Cable could not resolve both endpoints.');continue;}
    const hits = ['from','to'].map(end=>{
      const device = scene.getDevice(wire[`${end}DeviceId`] || wire[`${end}SurfaceId`]);
      const connector = scene.getConnector(wire[`${end}DeviceId`],wire[`${end}ConnectorId`]);
      return {device,connector};
    });
    for (let i=0;i<2;i++) {
      const end = i ? 'to' : 'from', ref = raw[end], hit = hits[i];
      if(ref?.deviceId && deviceIds.has(ref.deviceId) && (typeof ref.connectorId!=='string' || !ref.connectorId))add('cables',raw.id,`${end}-identity`,'Physical endpoint requires a stable connector identity.');
      if (!ref || !hit.device || (!wire[`${end}SurfaceId`] && !hit.connector)) add('cables',raw.id,`${end}-endpoint`,'Missing object or connector.');
      if (ref?.anchorId && hit.connector && !connectorVisualAnchors(hit.connector,hit.device).some(a=>a.id===ref.anchorId)) add('cables',raw.id,`${end}-anchor`,'Missing connector anchor.');
      if (!hit.connector || !hit.device || wire[`${end}SurfaceId`]) continue;
      const multiple = hit.connector.adapterMultipleExternalConnections || hit.device.visual?.adapterMapping?.multipleExternalConnections;
      if (!multiple && scene.connectorExternalWireIds(hit.device.id,hit.connector.id).size>1) add('cables',raw.id,`${end}-occupied`,'Connector has multiple external cables.');
      const exclusive = exclusiveConnectionRejectionReason(scene,hit,wire.id);
      if (exclusive) add('cables',raw.id,`${end}-exclusive`,exclusive);
    }
    if (mcWireIds.has(raw.id) || hits.some(h=>!h.connector) || wire.fromSurfaceId || wire.toSurfaceId) continue;
    let [a,b] = hits;
    if (a.device.kind==='jump' && b.device.kind!=='jump') a = jumpCompatibleHitForDeviceWire(a,b);
    if (b.device.kind==='jump' && a.device.kind!=='jump') b = jumpCompatibleHitForDeviceWire(b,a);
    const check = engineCompatibilitySummary(a,b);
    if (!check.valid) add('cables',raw.id,'compatibility',check.reason);
    if (raw.cableType && !isDacCableType(raw.cableType) && hits.every(h=>h.device.kind!=='jump')) {
      for (const [index,hit] of hits.entries()) {
        const node = nodeDefinitions.get(raw.cableType);
        const cable = {device:{id:`cable:${raw.id}`},connector:{id:'cable-end',type:raw.cableType,compatibilityType:node?.compatibilityType,
          direction:index?'output':'input',fiberMode:raw.fiberMode || ''}};
        const saved = engineCompatibilitySummary(hit,cable);
        if (!saved.valid) add('cables',raw.id,'cable-type',saved.reason);
      }
    }
    if (isDacCableType(raw.cableType)) {
      const dac = dacWireValidation(raw,a.connector,b.connector);
      if (!dac.valid) add('cables',raw.id,'dac',dac.reason);
    }
  }
  const loomIds = new Set(list(root.looms).map(l=>l.id));
  const portalIds=new Set();
  for (const wire of list(root.connections)) if ((wire.loomId || wire.loom) && !loomIds.has(wire.loomId || wire.loom)) add('looms',wire.id,'missing-loom','Cable references a missing Loom.');
  for (const loom of list(root.looms)) {
    const normalized = normalizeLoom(loom);
    if (!same(list(loom.routePoints).map(p=>p.id),normalized.routePoints.map(p=>p.id))
      || list(loom.routePoints).some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))) add('looms',loom.id,'anchors','Loom route points require stable unique IDs and finite positions.');
    if (list(loom.portalPairs).length!==normalized.portalPairs.length) add('looms',loom.id,'portals','Invalid Loom Portal attachment.');
    for(const portal of list(loom.portalPairs)) {
      if(portalIds.has(portal.id))add('looms',loom.id,'portal-identity','Loom Portal identity is already in use.');portalIds.add(portal.id);
    }
    if (loom.jumpRouting && !normalized.jumpRouting) add('looms',loom.id,'jump-anchor','Invalid Loom Jump anchor.');
    if (loom.jumpRouting) {
      if(loom.jumpRouting.exitJumpId && loom.jumpRouting.exitJumpId!==multiCoreJumpPeer(root,loom.jumpRouting.entryJumpId))add('looms',loom.id,'jump-peer','Loom exit Jump does not match its paired entry Jump.');
      const check = loomJumpAttachmentCompatibility(scene,loom.jumpRouting.entryJumpId,loom.id);
      if (!check.valid) add('looms',loom.id,'ownership',check.reason);
    }
  }
  for (const message of reconcileLoomJumpAssociations(structuredClone(root))) add('looms','ownership','association',message);
  return diagnostics;
}

export function validateProjectTopologyTransition(beforeInput, afterInput) {
  const before=rootOf(beforeInput),after=rootOf(afterInput),errors=[];
  const old = new Map();
  for(const d of projectTopologyDiagnostics(before))old.set(d.key,(old.get(d.key) || 0)+1);
  for(const d of projectTopologyDiagnostics(after)) {
    const remaining=old.get(d.key) || 0;if(remaining)old.set(d.key,remaining-1);else errors.push(d);
  }
  // Explicit cable removals are part of the atomic transaction, never implicit cleanup.
  const retained = new Set(list(after.connections).map(w=>w.id));
  const retainedBefore = {...before,connections:list(before.connections).filter(w=>retained.has(w.id)
    && same(w.from,after.connections.find(next=>next.id===w.id)?.from) && same(w.to,after.connections.find(next=>next.id===w.id)?.to))};
  const cards = validateModularCardChanges(retainedBefore,after,{includeConnectorChanges:true});
  for (const message of cards.errors) errors.push({domain:'cards',code:'card-change',message});
  if (!same(before.multiCores,after.multiCores) || !same(before.multiCoreDefinitions,after.multiCoreDefinitions)) {
    const multi = validateMultiCoreEdit({...before,connections:after.connections},after);
    errors.push(...multi.blockingDiagnostics);
  }
  return {valid:errors.length===0,errors};
}
