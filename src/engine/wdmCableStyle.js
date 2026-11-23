import { engineCompatibilitySummary, engineConnectorCompatibilityType, engineFiberModesCompatible } from "./connectorCompatibility.js";
import { isTransceiverCage, resolveInstalledModule } from "./transceiverModules.js";
import { opticalWavelengthMode } from "./customTransceiverOptics.js";
import { opticalCableEnds, physicalOpticalCableEnds } from "./opticalCableEndpoints.js";

// World units: identical at 100% in the designer, Viewer and vector export.
export const WDM_CABLE_DASH = Object.freeze([18, 6, 5, 6]);

export function wdmDashPattern(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  // Bound tessellation on unusually large imported coordinates.
  const scale = Number.isFinite(length) ? Math.max(1, length / (35 * 4096)) : 1;
  return scale === 1 ? WDM_CABLE_DASH : WDM_CABLE_DASH.map(size => size * scale);
}

export function isWdmCable(scene, wire) {
  if (!/^fiber-(lc|sc|st|mpo)$/.test(wire?.cableType || "") || wire.cableAssembly
    || wire.multiCoreIdentity || wire.stageboxAssemblyId) return false;
  const ends = opticalCableEnds(scene, wire);
  if (!ends.every(end => end.connector && end.device)) return false;
  const physical = physicalOpticalCableEnds(scene, wire, ends);
  if (!physical.some(({ connector }) => isTransceiverCage(connector)
    && opticalWavelengthMode(resolveInstalledModule(connector).capabilities.optical) === "wdm")) return false;
  if (scene?.savedWireStatuses?.get(wire.sourceId || wire.id)?.status === "incompatible"
    || !physical.every(({connector}) => engineConnectorCompatibilityType(connector) === wire.cableType)
    || physical.length === 2 && !engineCompatibilitySummary(...physical).valid) return false;
  return !wire.fiberMode || physical.every(({connector}) => engineFiberModesCompatible(connector,
    {type: wire.cableType, fiberMode: wire.fiberMode}, wire.cableType, wire.cableType));
}

// Split only the ink, not the route. Carry pattern phase across sample points
// so a bend or a densely sampled curve does not restart the pattern.
export function wdmInkRuns(points) {
  const runs = [];
  const pattern = wdmDashPattern(points);
  let phase = 0, remaining = pattern[0], run = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0) || !Number.isFinite(length)) continue;
    const pointAt = distance => ({ x: a.x + dx * (distance / length), y: a.y + dy * (distance / length) });
    for (let cursor = 0; cursor < length;) {
      const step = Math.min(length - cursor, remaining), end = cursor + step;
      if (phase % 2 === 0) {
        if (!run) { run = [pointAt(cursor)]; runs.push(run); }
        run.push(pointAt(end));
      }
      if (end <= cursor) break;
      cursor = end;
      remaining -= step;
      if (remaining <= 1e-7) {
        phase = (phase + 1) % pattern.length;
        remaining = pattern[phase];
        run = null;
      }
    }
  }
  return runs;
}
