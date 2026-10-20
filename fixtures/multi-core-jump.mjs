import { connectedMultiCoreProject } from "./multi-core-connectivity.mjs";
import { attachMultiCoreJump } from "../src/engine/multiCoreJumpRouting.js";

export function multiCoreJumpProject({ paired = true, style = "bezier" } = {}) {
  const project = connectedMultiCoreProject();
  project.jumpNodes = [{ id: "gateway-a", label: "Gateway A", x: 500, y: 1000 },
    { id: "gateway-b", label: "Gateway B", x: 1500, y: 1000 }];
  project.jumpLinks = paired ? [{ id: "gateway-pair", outputJumpId: "gateway-a", inputJumpId: "gateway-b", deviceIndependent: true }] : [];
  const mc = project.multiCores[0];
  Object.assign(mc.ends.A, { x: 100, y: 400 }); Object.assign(mc.ends.B, { x: 1700, y: 400 });
  mc.trunk.routeStyle = style;
  mc.trunk.routePoints = [{ id: "authored-a", x: 300, y: 800 }];
  project.multiCores[0] = attachMultiCoreJump(mc, "gateway-a");
  project.multiCores[0].trunk.routePoints.push({ id: "authored-b", x: 1700, y: 800 });
  project.multiCores[0].trunk.jumpRouting.sections.B.pointIds.push("authored-b");
  return project;
}
