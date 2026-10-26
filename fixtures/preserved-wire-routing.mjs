import {cableTypeSelectionFixture} from './cable-type-selection.mjs';
export function preservedWireRoutingFixture(){
  const project=cableTypeSelectionFixture();project.wireMode='bezier';
  Object.assign(project.connections[0],{manualRoute:true,manualRouteStyle:'bezier',routePoints:[{x:380,y:320},{x:600,y:400}]});
  Object.assign(project.connections[1],{manualRoute:true,manualRouteStyle:'orthogonal',routePoints:[{x:400,y:240},{x:400,y:430},{x:640,y:430}]});
  Object.assign(project.connections[2],{manualRoute:false,orthogonalRoutePoints:[{x:450,y:300},{x:450,y:480},{x:660,y:480}]});
  Object.assign(project.connections[3],{manualRoute:false,routeAutomatic:true});
  return project;
}
