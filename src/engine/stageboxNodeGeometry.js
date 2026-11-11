import { stageboxFaceplateLayout } from "./deviceVisualBuilder.js";
import { connectorVisualAnchors } from "./deviceDefinitionV2.js";
import { STAGEBOX_MAX_NODES } from "./stageboxSnake.js";
import {
  LEGACY_CANVAS_DETAIL_MAX_SCALE, legacyCanvasDetailScale, legacyConnectorRadius, legacyConnectorStrokeWidth
} from "./legacyZoomDetail.js";

export const STAGEBOX_TRUNK_COLOR = "#80d4ff";
export const STAGEBOX_NODE_RADIUS = 7;
export const STAGEBOX_NODE_RIM = .625;
const PAD = 13, RING_CLEARANCE = 21;
const BOX_NODE_OUTER_RADIUS = legacyConnectorRadius(1) + legacyConnectorStrokeWidth(1);
const isEnclosed = shape => shape === "rectangle" || shape === "circular";

export function stageboxNodeFillRadius(device) {
  return isEnclosed(device?.visual?.stageboxNodeOnly?.shape)
    ? BOX_NODE_OUTER_RADIUS - STAGEBOX_NODE_RIM * 2 : STAGEBOX_NODE_RADIUS - STAGEBOX_NODE_RIM;
}

// Include the thin white rim and the outer dark outline when budgeting space.
const markerExtent = fillRadius => fillRadius + STAGEBOX_NODE_RIM * 2.4 + .55;
const BOX_MAX_EXTENT = markerExtent(BOX_NODE_OUTER_RADIUS - STAGEBOX_NODE_RIM * 2) * LEGACY_CANVAS_DETAIL_MAX_SCALE;
const GRID_PITCH = Math.ceil(BOX_MAX_EXTENT * 2 + 1);
const BOX_PAD = Math.ceil(BOX_MAX_EXTENT + 1);

export function stageboxNodeDetailScale(device, zoom = 1) {
  const spacing = device?.visual?.stageboxNodeOnly?.nodeSpacing;
  const limit = spacing ? Math.max(1, (spacing - 1) / (2 * markerExtent(stageboxNodeFillRadius(device)))) : Infinity;
  return Math.min(legacyCanvasDetailScale(zoom), limit);
}

export function stageboxNodeHitRadius(device, zoom) {
  return Math.max(11, markerExtent(stageboxNodeFillRadius(device)) * stageboxNodeDetailScale(device, zoom));
}

function compactScale({ nodes, panel }, shape) {
  if (nodes.length < 2) return { x: 1, y: 1 };
  if (shape === "fanout") {
    const pitch = nodes[1].y - nodes[0].y;
    return { x: 1, y: Math.max(1, RING_CLEARANCE / pitch), spacing: Math.max(pitch, RING_CLEARANCE) };
  }
  if (shape === "rectangle") {
    const columns = Math.ceil(Math.sqrt(nodes.length)), rows = Math.ceil(nodes.length / columns);
    return { x: GRID_PITCH * (columns + 1) / panel.width, y: GRID_PITCH * (rows + 1) / panel.height, spacing: GRID_PITCH };
  }
  let nearestSquared = Infinity;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
    nearestSquared = Math.min(nearestSquared, dx * dx + dy * dy);
  }
  const scale = GRID_PITCH / Math.sqrt(nearestSquared);
  return { x: scale, y: scale, spacing: GRID_PITCH };
}

export function projectStageboxEndNodes(device, { keepFrame = false, editorConnectors } = {}) {
  const { visual, connectors } = device;
  const { stageboxRepresentation: shape, stageboxEndId: endId } = visual || {};
  if (!shape || !endId) return device;
  const counts = { input: 0, output: 0 };
  const ports = connectors.map(c => Object.hasOwn(counts, c.direction) && !c.hiddenOnCanvas && !c.empty
    ? { ...c, stageboxNumber: ++counts[c.direction] } : c);
  const live = ports.filter(c => !c.hiddenOnCanvas && !c.empty);
  const liveById = new Map(live.map(c => [c.id, c]));
  const emptySlots = (editorConnectors || []).filter(c => c.empty && !c.hiddenOnCanvas);
  const emptyIds = new Set(emptySlots.map(c => c.id));
  // Use draft order so filling a slot does not change its position or move its neighbours.
  const layoutPorts = editorConnectors ? editorConnectors.flatMap(c => {
    const livePort = liveById.get(c.id);
    return livePort ? [livePort] : emptyIds.has(c.id) ? [{ id: c.id }] : [];
  }) : live;
  // Authored artwork and distinct visual anchors still use their authored geometry.
  if (visual.hasFaceImage || visual.faceImage || layoutPorts.length > STAGEBOX_MAX_NODES || live.some(c => c.anchors?.length > 1)) {
    return { ...device, connectors: ports };
  }
  const layout = stageboxFaceplateLayout(layoutPorts, shape, endId, Math.max(120, device.width), Math.max(80, device.height));
  const scale = compactScale(layout, shape);
  const offsets = layout.nodes.map(node => ({ id: node.port.id,
    x: (node.x - (layout.panel.x + layout.panel.width / 2)) * scale.x,
    y: (node.y - (layout.panel.y + layout.panel.height / 2)) * scale.y }));
  const padding = isEnclosed(shape) ? BOX_PAD : PAD;
  const halfWidth = padding + Math.max(0, ...offsets.map(p => shape === "circular" ? Math.hypot(p.x, p.y) : Math.abs(p.x)));
  const halfHeight = shape === "circular" ? halfWidth : padding + Math.max(0, ...offsets.map(p => Math.abs(p.y)));
  const stem = layout.stem;
  const designWidth = layout.panel.x * 2 + layout.panel.width;
  const stemOffset = stem ? stem.x - designWidth / 2 : 0;
  const rootOffset = stem ? stem.rootX - designWidth / 2 : 0;
  const marginX = Math.max(halfWidth, Math.abs(stemOffset) + 5);
  const width = Math.max(keepFrame ? device.width : 0, marginX * 2);
  const height = Math.max(keepFrame ? device.height : 0, halfHeight * 2);
  const cx = width / 2, cy = height / 2;
  const points = new Map(offsets.map(p => [p.id, { x: cx + p.x, y: cy + p.y }]));
  const trunk = { x: cx + (stem ? stemOffset : endId === "end-a" ? halfWidth : -halfWidth), y: cy };
  return { ...device, width, height,
    visual: { ...visual, stageboxNodeOnly: { shape, cx, cy, halfWidth, halfHeight, trunk,
      ...(scale.spacing ? { nodeSpacing: scale.spacing } : {}),
      ...(stem ? { root: { x: cx + rootOffset, y: cy } } : {}),
      ...(emptySlots.length ? { emptySlots: emptySlots.map(slot => ({
        id: slot.id, direction: slot.direction, anchors: connectorVisualAnchors(slot, device).map(anchor => ({
          ...anchor, ...points.get(slot.id)
        }))
      })) } : {}) } },
    connectors: ports.map(c => {
      const point = points.get(c.id);
      return point ? { ...c, ...point, anchors: (c.anchors || []).map(a => ({ ...a, ...point })) } : c;
    })
  };
}

export function stageboxPreviewBounds(device) {
  const layout = device?.visual?.stageboxNodeOnly;
  if (!layout) return null;
  const { cx, cy, halfWidth, halfHeight, trunk } = layout;
  const left = Math.min(cx - halfWidth, trunk.x), right = Math.max(cx + halfWidth, trunk.x);
  return { x: device.x + left, y: device.y + cy - halfHeight, width: right - left, height: halfHeight * 2 };
}

// Approved prototype arc, mirrored above/below the trunk with a straight level join.
export function stageboxTrunkArc(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dy) < .01) return [from, to];
  const chord = Math.hypot(dx, dy);
  const tangentRise = chord * Math.abs(dy) / (2 * (chord + Math.abs(dx)));
  const rise = Math.min(12, chord * .14, Math.abs(dx) * .18, tangentRise);
  if (rise < .01) return [from, to];
  const centerOffset = chord * chord / (8 * rise) - rise / 2;
  const radius = centerOffset + rise;
  const side = Math.sign(dx * dy);
  return Array.from({ length: 25 }, (_, i) => {
    if (i === 0) return from;
    if (i === 24) return to;
    const t = i / 24, along = chord * (t - .5);
    const offset = (Math.sqrt(radius * radius - along * along) - centerOffset) * side / chord;
    return { x: from.x + t * dx - dy * offset, y: from.y + t * dy + dx * offset };
  });
}

export function stageboxFanoutPath(root, tip) {
  const dx = tip.x - root.x;
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24, u = 1 - t;
    return { x: root.x + dx * (3 * u * u * t * .55 + 3 * u * t * t * .7 + t ** 3),
      y: root.y + (tip.y - root.y) * (3 * u * t * t + t ** 3) };
  });
}
