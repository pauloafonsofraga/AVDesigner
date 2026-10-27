export const DEFAULT_LAYER_ID = 'layer-default';
export const LAYER_COLLECTIONS = ['devices','imageObjects','ledSurfaces','areas','comments','titleBlocks','jumpNodes','connections','jumpLinks','looms','racks','multiCores'];

export function projectLayers(root = {}) {
  const result = [], ids = new Set();
  for (const layer of Array.isArray(root.layers) ? root.layers : []) {
    if (!layer || typeof layer.id !== 'string' || !layer.id || ids.has(layer.id)) continue;
    ids.add(layer.id);
    result.push({id:layer.id, name:String(layer.name || 'Layer').slice(0,120), visible:layer.visible !== false, locked:layer.locked === true});
  }
  if (!ids.has(DEFAULT_LAYER_ID)) result.unshift({id:DEFAULT_LAYER_ID,name:'Default',visible:true,locked:false});
  return result;
}

export function layerObjects(root) {
  return LAYER_COLLECTIONS.flatMap(collection => (root[collection] || []).map(object => ({collection,object,id:String(object.instanceId || object.id)})));
}

export function deleteProjectLayer(root, id) {
  if (id === DEFAULT_LAYER_ID) throw new Error('The default layer cannot be deleted.');
  root.layers = projectLayers(root).filter(layer => layer.id !== id);
  for (const {object} of layerObjects(root)) if (object.layerId === id) object.layerId = DEFAULT_LAYER_ID;
  if (root.activeLayerId === id) root.activeLayerId = DEFAULT_LAYER_ID;
}

export function assignNewObjectsToLayer(root, knownIds) {
  const layers=projectLayers(root), active=layers.find(layer=>layer.id===root.activeLayerId && layer.visible && !layer.locked)
    || layers.find(layer=>layer.visible && !layer.locked) || layers.find(layer=>layer.id===DEFAULT_LAYER_ID);
  for (const entry of layerObjects(root)) {
    const key=entry.collection+':'+entry.id;
    const remembered=knownIds.get(key);
    if ((!knownIds.has(key) || remembered) && root.layers?.length && !entry.object.layerId) {
      entry.object.layerId = remembered && layers.some(layer=>layer.id===remembered) ? remembered
        : active.visible && !active.locked ? active.id : DEFAULT_LAYER_ID;
    }
    knownIds.set(key,entry.object.layerId || null);
  }
}

export const layerVisible = item => item?.layerHidden !== true;
export const layerEditable = item => Boolean(item) && layerVisible(item) && item.layerLocked !== true;

export function captureLayerState(root, clone=structuredClone) {
  return {layers:root.layers ? clone(root.layers) : null,activeLayerId:root.activeLayerId || DEFAULT_LAYER_ID,
    assignments:layerObjects(root).map(({collection,id,object})=>({collection,id,layerId:object.layerId || null})),
    imageObjects:Array.isArray(root.imageObjects) ? clone(root.imageObjects) : null};
}

export function restoreLayerState(root, snapshot, clone=structuredClone) {
  if (snapshot.layers) root.layers=clone(snapshot.layers); else delete root.layers;
  root.activeLayerId=snapshot.activeLayerId;
  if (snapshot.imageObjects) root.imageObjects=clone(snapshot.imageObjects); else delete root.imageObjects;
  const assignments=new Map(snapshot.assignments.map(entry=>[entry.collection+':'+entry.id,entry.layerId]));
  for (const {collection,id,object} of layerObjects(root)) {
    const layerId=assignments.get(collection+':'+id);
    if (layerId) object.layerId=layerId; else delete object.layerId;
  }
}

export function applyProjectLayers(scene, root) {
  if (!Array.isArray(root?.layers) || !root.layers.length) return;
  const layers=projectLayers(root), byId=new Map(layers.map((layer,index)=>[layer.id,{...layer,index}]));
  const sources=new Map(layerObjects(root).map(entry=>[entry.collection+':'+entry.id,entry.object]));
  const annotate=(item,collection,id=item.sourceId || item.id)=>{
    const source=sources.get(collection+':'+id);
    const rack=sources.get('racks:'+(source?.rackId || item.rackId));
    const layer=byId.get(source?.layerId || item.layerId || rack?.layerId) || byId.get(DEFAULT_LAYER_ID);
    Object.assign(item,{layerId:layer.id,layerOrder:layer.index,layerHidden:!layer.visible,layerLocked:layer.locked});
  };
  const collections={device:'devices',adapter:'devices','power-distro':'devices',jump:'jumpNodes','image-object':'imageObjects','led-surface':'ledSurfaces',area:'areas',comment:'comments','title-block':'titleBlocks'};
  scene.devices.forEach(item=>item.multiCoreIdentity ? annotate(item,'multiCores',item.multiCoreIdentity.multiCoreId) : annotate(item,collections[item.kind] || 'devices'));
  scene.racks.forEach(item=>annotate(item,'racks'));
  for (const item of scene.compactCanvasDeviceById?.values() || []) {
    const rack=scene.racks.find(r=>r.id===item.rackId);
    if (rack) Object.assign(item,{layerId:rack.layerId,layerOrder:rack.layerOrder,layerHidden:rack.layerHidden,layerLocked:rack.layerLocked});
  }
  scene.wires.forEach(item=>{
    if(item.multiCoreIdentity)annotate(item,'multiCores',item.multiCoreIdentity.multiCoreId);else annotate(item,'connections');
    const ends=[scene.getDevice(scene.wireEndpointObjectId(item,'from')),scene.getDevice(scene.wireEndpointObjectId(item,'to'))];
    item.layerHidden ||= ends.some(end=>end && !layerVisible(end));
    item.layerLocked ||= ends.some(end=>end?.layerLocked);
  });
  scene.looms.forEach(item=>annotate(item,'looms'));
  scene.loomPlans.forEach(item=>{
    const loom=scene.looms.find(l=>l.id===item.loomId);
    if (loom) Object.assign(item,{layerId:loom.layerId,layerOrder:loom.layerOrder,layerHidden:loom.layerHidden,layerLocked:loom.layerLocked});
  });
  scene.jumpLinks.forEach(item=>{
    annotate(item,'jumpLinks');
    item.layerHidden ||= [item.outputJumpId,item.inputJumpId].some(id=>!layerVisible(scene.getDevice(id)));
  });
  scene.meta.projectLayers=layers;
}

// Render-only view: identity maps and the complete topology stay on the original graph.
export function layerSceneView(scene, id) {
  const accepts=item=>layerVisible(item) && (id == null || (item.layerId || DEFAULT_LAYER_ID)===id);
  const view=Object.create(scene);
  view.isProjectLayerView=true;
  for (const key of ['devices','wires','racks','jumpLinks','looms','loomPlans']) view[key]=(scene[key] || []).filter(accepts);
  for (const key of ['spatialIndex','rackIndex','wireIndex','connectorIndex','routePointIndex','loomPortalIndex']) {
    const index=scene[key];
    if (!index) continue;
    view[key]=Object.create(index);
    for (const method of ['queryRect','queryPoint']) if (index[method]) view[key][method]=(...args)=>index[method](...args).filter(hit=>{
      const p=hit.payload || hit;
      return accepts(p.device || p.wire || p.rack || p.plan || p.loom || {});
    });
  }
  view.renderDevices=()=>scene.renderDevices().filter(accepts);
  view.selectedIds=new Set([...scene.selectedIds].filter(key=>accepts(scene.getDevice(key))));
  view.selectedWireIds=new Set([...scene.selectedWireIds].filter(key=>accepts(scene.getWire(key))));
  view.selectedRackIds=new Set([...scene.selectedRackIds].filter(key=>accepts(scene.getRack(key))));
  return view;
}
