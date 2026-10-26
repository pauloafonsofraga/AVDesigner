// Unmarked historical route arrays may contain hand-edited geometry. Preserve
// them unless the producer positively identifies them as an automatic cache.
export function projectWireRouting(wire = {}, mode = 'bezier') {
  const curved=Array.isArray(wire.routePoints)?wire.routePoints:[];
  const orthogonal=Array.isArray(wire.orthogonalRoutePoints)?wire.orthogonalRoutePoints:[];
  const manual=Boolean(wire.manualRoute || wire.routeAutomatic!==true && (curved.length||orthogonal.length));
  if(manual){
    const orthogonalStyle=wire.manualRouteStyle==='orthogonal'
      || !wire.manualRouteStyle && !wire.manualRoute && orthogonal.length>0;
    const points=orthogonalStyle && !wire.manualRoute && orthogonal.length?orthogonal:curved;
    return {routeStyle:orthogonalStyle?'orthogonal':points.length?'custom':'bezier',routePoints:points,manualRoute:true,routeAutomatic:false};
  }
  return {routeStyle:mode==='orthogonal'?'orthogonal':'bezier',
    routePoints:mode==='orthogonal'?orthogonal:[],manualRoute:false,routeAutomatic:true};
}

export function hasIndependentWireRoute(wire = {}) {
  return !wire.multiCoreIdentity && !wire.internalRackWire && wire.sourceKind!=='rackInternalConnection';
}

export function markWireRouteAuthored(wire) {
  if(wire && hasIndependentWireRoute(wire)){
    wire.manualRoute=true;
    wire.routeAutomatic=false;
  }
}
