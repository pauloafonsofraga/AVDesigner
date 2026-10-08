function oppositeSide(side) {
  return side === "sideA" ? "sideB" : side === "sideB" ? "sideA" : "";
}

function reversePoints(points = []) {
  return [...points].reverse().map(point => ({ x: Number(point.x), y: Number(point.y) }));
}

export function canonicalLoomWireRouting({
  reversed = false,
  entrySide = "",
  entryRoutePoints = [],
  exitRoutePoints = []
} = {}) {
  if (!reversed) return {
    loomEntrySide: entrySide,
    loomEntryRoutePoints: entryRoutePoints.map(point => ({ ...point })),
    loomExitRoutePoints: exitRoutePoints.map(point => ({ ...point }))
  };
  return {
    loomEntrySide: oppositeSide(entrySide),
    loomEntryRoutePoints: reversePoints(exitRoutePoints),
    loomExitRoutePoints: reversePoints(entryRoutePoints)
  };
}
