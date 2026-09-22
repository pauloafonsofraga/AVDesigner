// Self-contained so SVG previews and the offline viewer use the exact same geometry.
export function createSharedBusRenderingAPI() {
  function sharedBusOrthogonalSegments(layout, body, { nodeInset = 10, offsetX = 0, offsetY = 0 } = {}) {
    const points = layout?.points;
    const left = Number(body?.x ?? 0), width = Number(body?.width);
    if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0
      || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))
      || ![nodeInset, offsetX, offsetY].every(Number.isFinite)) return null;
    const right = left + width;
    const averageX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const input = layout.side ? ["input", "left"].includes(layout.side) : averageX <= left + width / 2;
    const direction = input ? 1 : -1;
    const margin = Math.min(4, width / 8);
    const inset = Math.max(0, nodeInset);
    const starts = points.map(point => point.x + direction * inset);
    // Leave two units between the trunk and the field border, and between the
    // trunk and the inset node edge. A body too narrow for that corridor is not drawn.
    const junction = Number.isFinite(layout.fieldJunctionX) ? layout.fieldJunctionX : averageX + direction * 26;
    const fieldLimit = junction - direction * 2;
    const minX = input ? Math.max(left + margin, ...starts.map(x => x + 2)) : Math.max(left + margin, fieldLimit);
    const maxX = input ? Math.min(right - margin, fieldLimit) : Math.min(right - margin, ...starts.map(x => x - 2));
    if (minX > maxX) return null;
    const trunkX = Math.max(minX, Math.min(maxX, fieldLimit)) + offsetX;
    const ys = points.map(point => point.y + offsetY);
    return {
      trunk: { x1: trunkX, y1: Math.min(...ys), x2: trunkX, y2: Math.max(...ys) },
      branches: points.map((point, index) => ({ x1: starts[index] + offsetX, y1: ys[index], x2: trunkX, y2: ys[index] }))
    };
  }

  // The caller supplies resolved display points, never reusable card-local rows.
  function sharedBusLayoutsFromPoints(points, relationships) {
    const byId = new Map(points.map(point => [point.id, point]));
    const consumed = new Set();
    return (relationships || []).flatMap(relationship => {
      if (!["exclusive", "shared-bus", "exclusive-shared-bus", "exclusive-shared"].includes(relationship.type)) return [];
      const ids = relationship.members || relationship.connectorIds || [];
      if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length || ids.some(id => consumed.has(id))) return [];
      const members = ids.map(id => byId.get(id));
      if (members.some(point => !point) || members.some(point => point.side !== members[0].side)) return [];
      ids.forEach(id => consumed.add(id));
      return [{ relationshipId: relationship.id, side: members[0].side, points: members }];
    });
  }
  return { sharedBusOrthogonalSegments, sharedBusLayoutsFromPoints };
}

export const { sharedBusOrthogonalSegments, sharedBusLayoutsFromPoints } = createSharedBusRenderingAPI();
export const sharedBusRenderingRuntimeSource = `(${createSharedBusRenderingAPI.toString()})()`;
