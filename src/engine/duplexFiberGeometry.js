import { resolveInstalledModule } from "./transceiverModules.js";
import { offsetPolyline } from "./routingPlacement.js";
import { standaloneFiberArrangement } from "./standaloneConnectors.js";
import { physicalOpticalCableEnds } from "./opticalCableEndpoints.js";
import { isWdmCable } from "./wdmCableStyle.js";

// Drawing-only: a pair of strands is still one physical patch cable. Never
// infer duplex from fibre colour, an MPO interface, or an integrated assembly.
export function isDuplexFiberWire(scene, wire) {
  if (!wire || wire.cableAssembly || wire.stageboxAssemblyId || wire.multiCoreIdentity?.kind === "multi-core-trunk"
    || /^(?:dac|aoc)-/.test(wire.cableType || "")) return false;
  const arrangements = physicalOpticalCableEnds(scene, wire).map(({ connector: port }) => {
    const standalone = standaloneFiberArrangement(port);
    if (standalone) return standalone;
    const module = resolveInstalledModule(port);
    if (!/^fiber-(lc|sc|st)$/.test(module.effectiveType || port.type)) return "";
    const optical = module.capabilities.optical || {};
    return optical.arrangement || optical.interface?.split("-")[0] || "";
  });
  return !arrangements.includes("simplex") && arrangements.includes("duplex");
}

export function opticalWireStrokes(scene, wire, points, width) {
  if (isWdmCable(scene, wire)) return [{ points, width, dashed: true }];
  if (!isDuplexFiberWire(scene, wire)) return null;
  return duplexFiberPaths(points, width).map(path => ({ points: path, width: width * .65, dashed: false }));
}

export function duplexFiberPaths(points, width) {
  const path = [];
  for (const p of points || []) if (Number.isFinite(p.x) && Number.isFinite(p.y)
    && (!path.length || Math.hypot(p.x - path.at(-1).x, p.y - path.at(-1).y) > 1e-7)) path.push(p);
  if (path.length < 2 || !(width > 0)) return [];
  const distances = [0];
  for (let i = 1; i < path.length; i++) distances.push(distances.at(-1) + Math.hypot(path[i].x - path[i-1].x, path[i].y - path[i-1].y));
  const length = distances.at(-1), taper = Math.min(length * .08, width * 2);
  const span = Math.min(length * .6, width * 12);
  const start = length - span;
  const transition = Array.from({ length: 17 }, (_, i) => start + span * i / 16);
  const samples = [...new Set([...distances, taper, length - taper, ...transition])].sort((a,b) => a-b);
  let segment = 1;
  const center = samples.map(distance => {
    while (segment < path.length - 1 && distances[segment] < distance) segment++;
    const a = path[segment-1], b = path[segment], t = (distance - distances[segment-1]) / (distances[segment] - distances[segment-1]);
    return { x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t };
  });
  const normal = offsetPolyline(center, 1);
  return [-1,1].map(sign => center.map((p,i) => {
    const distance = samples[i], t = Math.min(1, Math.max(0, (distance - start) / span));
    const offset = sign * width * .85 * Math.cos(Math.PI * t)
      * Math.min(1, distance / taper, (length - distance) / taper);
    return { x: p.x + (normal[i].x-p.x)*offset, y: p.y + (normal[i].y-p.y)*offset };
  }));
}
