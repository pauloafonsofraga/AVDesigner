import { isAdapterTemplateLikeForEngine } from "./adapterMapping.js";
import { connectorIsNotWorking, connectorVisualAnchors, normalizeConnectorRelationships } from "./deviceDefinitionV2.js";
import { createConnectorDisplayLayout } from "./connectorDisplayLayout.js";
import { effectiveConnectorTypeForEngine, engineConnectorColor, engineConnectorColorSegments,
  installedModuleDetailsForEngine } from "./connectorCompatibility.js";

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const text = value => String(value ?? "");
const escape = value => text(value).replace(/[\u0000-\u001f]/g, "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function safeColor(value) {
  const color = text(value).trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color.toLowerCase();
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/i.exec(color);
  if (rgb) return `rgba(${rgb.slice(1, 4).map(v => Math.min(255, Number(v))).join(",")},${Math.min(1, Number(rgb[4] ?? 1))})`;
  return "#778492";
}

function topology(definition, nodeColorByType) {
  const seen = new Set();
  const connectors = (definition.connectors || []).filter(c => {
    if (!c?.id || !c.type || c.empty || c.hiddenOnCanvas || seen.has(text(c.id))) return false;
    seen.add(text(c.id)); return true;
  }).map(c => ({
    id: text(c.id), type: text(c.type), effectiveType: effectiveConnectorTypeForEngine(c),
    direction: text(c.signalDirection || c.direction), displaySide: text(c.displaySide), module: installedModuleDetailsForEngine(c),
    color: safeColor(c.color || engineConnectorColor(c, nodeColorByType)),
    colorSegments: (c.colorSegments || engineConnectorColorSegments(c) || []).map(safeColor),
    notWorking: connectorIsNotWorking(c), primaryAnchorId: text(c.primaryAnchorId),
    anchors: connectorVisualAnchors(c, definition).map(a => ({ id: text(a.id), side: a.side === "right" ? "right" : "left", y: finite(a.y) }))
      .sort((a, b) => compare(a.id, b.id))
  })).sort((a, b) => compare(a.id, b.id));
  const relationships = normalizeConnectorRelationships(definition.connectorRelationships || definition.connectorTopology?.relationships, connectors)
    .map(r => ({ id: r.id, type: r.type, members: [...r.members].sort(compare), sourceConnectorId: r.sourceConnectorId, targetConnectorId: r.targetConnectorId }))
    .sort((a, b) => compare(a.id, b.id));
  // Consume resolved Engine mapping data when supplied. The canvas's automatic
  // count-based mapping is intentionally not invoked for an unconnected thumbnail.
  const branches = (definition.visual?.adapterMapping?.branches || []).map(b => ({ inputId: text(b.inputId), outputId: text(b.outputId) }))
    .filter(b => seen.has(b.inputId) && seen.has(b.outputId) && b.inputId !== b.outputId)
    .sort((a, b) => compare(a.inputId, b.inputId) || compare(a.outputId, b.outputId));
  return { connectors, relationships, branches };
}

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function signature(key) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < key.length; i++) { a = Math.imul(a ^ key.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ key.charCodeAt(i); }
  return `adapter-topology-v1-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

function resolveModel(data, key) {
  const nodes = data.connectors.flatMap(c => c.anchors.map(a => ({
    connectorId: c.id, anchorId: a.id, side: a.side, sourceY: a.y,
    color: c.color, colorSegments: [...c.colorSegments], notWorking: c.notWorking
  })));
  const maximum = Math.max(1, ...["left", "right"].map(side => nodes.filter(n => n.side === side).length));
  const radius = Math.min(3.1, 22 / Math.max(1, maximum - 1) * .36);
  for (const side of ["left", "right"]) {
    const lane = nodes.filter(n => n.side === side).sort((a, b) => a.sourceY - b.sourceY || compare(a.connectorId, b.connectorId) || compare(a.anchorId, b.anchorId));
    lane.forEach((n, i) => { n.x = side === "left" ? 7 : 47; n.y = lane.length === 1 ? 19 : 8 + 22 * i / (lane.length - 1); n.radius = radius; delete n.sourceY; });
  }
  const primary = id => {
    const c = data.connectors.find(c => c.id === id);
    return nodes.find(n => n.connectorId === id && n.anchorId === c?.primaryAnchorId) || nodes.find(n => n.connectorId === id);
  };
  const groups = [], pairs = new Map();
  const pair = (a, b) => {
    if (a !== b && primary(a) && primary(b)) pairs.set(JSON.stringify([a, b]), [a, b]);
  };
  data.branches.forEach(b => pair(b.inputId, b.outputId));
  data.relationships.filter(r => r.type === "through").forEach(r => pair(r.sourceConnectorId, r.targetConnectorId));
  const layout = createConnectorDisplayLayout({ width: 54, connectors: data.connectors.map(c => ({ ...c, schemaVersion: 2 })), connectorRelationships: data.relationships });
  layout.groups.forEach(g => groups.push({ kind: "shared-bus", members: g.members.map(c => c.id) }));
  data.relationships.filter(r => r.type === "mirrored").forEach(r => groups.push({ kind: "mirrored", members: r.members }));
  // Group stars, not connected components: a partially connected mapping must
  // never acquire extra logical branches just because two stars share a node.
  for (const endpoint of [0, 1]) {
    const stars = new Map();
    pairs.forEach(p => { const list = stars.get(p[endpoint]) || []; list.push(p); stars.set(p[endpoint], list); });
    stars.forEach(list => {
      if (list.length < 2) return;
      groups.push({ kind: "mapping", members: [...new Set(list.flat())].sort(compare) });
      list.forEach(p => pairs.delete(JSON.stringify(p)));
    });
  }
  pairs.forEach(p => groups.push({ kind: "mapping", members: p }));
  const routes = groups.map((group, index) => {
    const points = group.members.map(primary).filter(Boolean);
    const sides = new Set(points.map(n => n.side));
    const fraction = (index + 1) / (groups.length + 1);
    const x = sides.size > 1 ? 20 + 14 * fraction : points[0]?.side === "right" ? 39 - 5 * fraction : 15 + 5 * fraction;
    const minY = Math.min(...points.map(n => n.y)), maxY = Math.max(...points.map(n => n.y));
    const trunk = { x1: x, y1: minY, x2: x, y2: maxY };
    const segments = [trunk, ...points.map(n => ({ x1: n.x, y1: n.y, x2: x, y2: n.y }))]
      .filter(s => s.x1 !== s.x2 || s.y1 !== s.y2);
    return { ...group, trunk, segments, color: points[0]?.color || "#778492", width: Math.min(.8, radius * .55) };
  }).filter(r => r.members.length > 1);
  return freeze({ viewBox: [0, 0, 54, 38], body: { x: 7, y: maximum > 1 ? 5 : 11, width: 40, height: maximum > 1 ? 28 : 16, radius: 4 },
    nodes, routes, signature: signature(key) });
}

export function buildAdapterThumbnail(definition = {}, { nodeColorByType = new Map() } = {}) {
  const data = topology(definition, nodeColorByType);
  return resolveModel(data, JSON.stringify(data));
}

export function adapterThumbnailSvg(model) {
  const b = model.body;
  const routes = model.routes.map(r => `<path data-route-kind="${escape(r.kind)}" d="${r.segments.map(s => `M${finite(s.x1)} ${finite(s.y1)}H${finite(s.x2)}V${finite(s.y2)}`).join(" ")}" fill="none" stroke="${safeColor(r.color)}" stroke-width="${finite(r.width)}" opacity=".55"/>`).join("");
  const nodes = model.nodes.map(n => {
    const x = finite(n.x), y = finite(n.y), radius = Math.max(0, finite(n.radius));
    const segments = n.colorSegments.length > 1 ? n.colorSegments.map((color, i, colors) => {
      const a = i * 2 * Math.PI / colors.length - Math.PI / 2, z = (i + 1) * 2 * Math.PI / colors.length - Math.PI / 2;
      return `<path d="M${x} ${y}L${x + radius * Math.cos(a)} ${y + radius * Math.sin(a)}A${radius} ${radius} 0 0 1 ${x + radius * Math.cos(z)} ${y + radius * Math.sin(z)}Z" fill="${safeColor(color)}"/>`;
    }).join("") : "";
    const error = n.notWorking ? `<path d="M${x - radius} ${y - radius}L${x + radius} ${y + radius}M${x - radius} ${y + radius}L${x + radius} ${y - radius}" stroke="#ff0000" stroke-width="${Math.min(1.3, radius * .6)}"/>` : "";
    return `<g data-connector-id="${escape(n.connectorId)}" data-anchor-id="${escape(n.anchorId)}" data-side="${escape(n.side)}"><circle cx="${x}" cy="${y}" r="${radius}" fill="${safeColor(n.color)}"/>${segments}<circle cx="${x}" cy="${y}" r="${radius}" fill="none" stroke="#edf2f7" stroke-width="${Math.min(.9, radius * .3)}"/>${error}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" data-adapter-thumbnail="${escape(model.signature)}" viewBox="0 0 54 38" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><rect x="${finite(b.x)}" y="${finite(b.y)}" width="${finite(b.width)}" height="${finite(b.height)}" rx="${finite(b.radius)}" fill="#171d24" stroke="#3297c0" stroke-width=".9"/>${routes}${nodes}</svg>`;
}

export function createAdapterThumbnailCache({ maxEntries = 128 } = {}) {
  const limit = Math.max(1, Math.min(512, Math.floor(Number(maxEntries) || 128))), entries = new Map();
  let builds = 0, hits = 0;
  return Object.freeze({
    get(definition, options = {}) {
      if (!isAdapterTemplateLikeForEngine(definition)) return null;
      const data = topology(definition, options.nodeColorByType || new Map()), key = JSON.stringify(data);
      let result = entries.get(key);
      if (result) { hits++; entries.delete(key); }
      else { const model = resolveModel(data, key); result = Object.freeze({ model, svg: adapterThumbnailSvg(model) }); builds++; }
      entries.set(key, result);
      if (entries.size > limit) entries.delete(entries.keys().next().value);
      return result;
    },
    stats: () => ({ size: entries.size, limit, builds, hits })
  });
}
