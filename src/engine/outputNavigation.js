// PDF navigation is derived from canonical Engine geometry, never print layout.
export const pdfJumpDestinationId = id => `pdf-jump-destination-${Array.from(String(id),
  character => character.codePointAt(0).toString(16)).join("-")}`;

export function buildOutputJumpNavigation(snapshot) {
  const scene = snapshot?.engineScene || snapshot || {};
  const nodes = new Map((scene.devices || []).filter(device => device.kind === "jump")
    .map(device => [String(device.id), device]));
  const jumpNodes = [], used = new Set();
  for (const link of scene.jumpLinks || []) {
    const a = String(link.outputJumpId || ""), b = String(link.inputJumpId || "");
    if (!a || !b || a === b || !nodes.has(a) || !nodes.has(b) || used.has(a) || used.has(b)) continue;
    const first = nodes.get(a), second = nodes.get(b);
    if (![first, second].every(node => [node.x, node.y, node.width, node.height]
      .every(Number.isFinite) && node.width > 0 && node.height > 0)) continue;
    for (const [source, target] of [[first, second], [second, first]]) {
      jumpNodes.push(Object.freeze({ sourceId: source.id, targetId: target.id,
        destinationId: pdfJumpDestinationId(source.id),
        targetDestinationId: pdfJumpDestinationId(target.id),
        bounds: Object.freeze({ x: source.x, y: source.y, width: source.width, height: source.height }) }));
    }
    used.add(a); used.add(b);
  }
  return Object.freeze({ jumpNodes: Object.freeze(jumpNodes) });
}
