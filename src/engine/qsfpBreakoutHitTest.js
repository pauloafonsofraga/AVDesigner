import { distanceToSegment } from "./hitTest.js";

export function hitTestQsfpBreakout(plans, point, tolerance, selected, { readOnly = false } = {}) {
  const at = (target, radius = tolerance) => Math.hypot(point.x - target.x, point.y - target.y) <= radius;
  for (const plan of [...plans].reverse()) {
    if (!readOnly && !plan.editable) continue;
    if (!readOnly && selected?.assemblyId === plan.id && !selected.branchId) {
      const index = plan.corners.findIndex(corner => at(corner));
      if (index !== -1) return { assemblyId: plan.id, kind: "corner", index };
      if (at(plan.hub)) return { assemblyId: plan.id, kind: "hub" };
    }
    const branch = plan.branches.filter(item => (readOnly || item.editable) && at(item.tip))
      .sort((a, b) => Math.hypot(point.x-a.tip.x, point.y-a.tip.y)-Math.hypot(point.x-b.tip.x, point.y-b.tip.y))[0];
    if (branch) return { assemblyId: plan.id, branchId: branch.id, kind: "tip" };
  }
  let best = null, min = tolerance;
  for (const plan of plans) {
    if (!readOnly && !plan.editable) continue;
    for (const [points, branchId] of [[plan.trunk, null], ...plan.branches.filter(b => readOnly || b.editable).map(b => [b.points, b.id])]) {
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
