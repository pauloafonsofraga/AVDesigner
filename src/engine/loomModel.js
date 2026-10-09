import { buildCableSchedule, groupedCables } from "./cableSchedule.js";

const rootOf = project => project?.state || project?.project || project || {};
const nameKey = name => String(name || "").trim().toLowerCase();

export const DEFAULT_LOOM_LABEL_TEXT_COLOR = "#ffffff";
export const DEFAULT_LOOM_LABEL_BACKGROUND_COLOR = "#000000";

export function parseLoomRoutePointId(value) {
  if (typeof value !== "string") return null;
  const match = /^lrp-([1-9]\d*)$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
}

export function isCanonicalLoomRoutePointId(value) {
  return parseLoomRoutePointId(value) !== null;
}

function normalizedRoutePointCounter(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const counter = Math.floor(number);
  return Number.isSafeInteger(counter) && counter > 0 ? counter : 0;
}

export function normalizeLoomLabelColor(value, fallback = DEFAULT_LOOM_LABEL_TEXT_COLOR) {
  const normalize = candidate => {
    const source = String(candidate ?? "").trim();
    if (/^#[\da-f]{6}$/i.test(source)) return source.toLowerCase();
    const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(source);
    return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase() : "";
  };
  return normalize(value) || normalize(fallback) || DEFAULT_LOOM_LABEL_TEXT_COLOR;
}

export function loomLabelBackgroundRgba(value, alpha = 0.82) {
  const color = normalizeLoomLabelColor(value, DEFAULT_LOOM_LABEL_BACKGROUND_COLOR);
  const channels = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16));
  const opacity = Math.max(0, Math.min(1, Number.isFinite(Number(alpha)) ? Number(alpha) : 0.82));
  return `rgba(${channels.join(",")},${opacity})`;
}

export function normalizeLoom(value, index = 0) {
  const point = (side, fallback) => side ? ({
    label: String(side?.label || fallback),
    x: Number.isFinite(Number(side?.x)) ? Number(side.x) : 0,
    y: Number.isFinite(Number(side?.y)) ? Number(side.y) : 0
  }) : null;
  const rawRoutePoints = Array.isArray(value?.routePoints) ? value.routePoints
    .filter(p => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y))) : [];
  const routePointIds = new Set();
  let routePointCounter = normalizedRoutePointCounter(value?.routePointCounter);
  for (const routePoint of rawRoutePoints) {
    const id = routePoint?.id;
    const number = parseLoomRoutePointId(id);
    if (number !== null) routePointCounter = Math.max(routePointCounter, number);
  }
  const nextRoutePointId = () => {
    if (routePointCounter >= Number.MAX_SAFE_INTEGER) return "";
    do { routePointCounter += 1; } while (routePointIds.has(`lrp-${routePointCounter}`));
    return `lrp-${routePointCounter}`;
  };
  const routePoints = rawRoutePoints.map(routePoint => {
    let id = routePoint?.id;
    if (!isCanonicalLoomRoutePointId(id) || routePointIds.has(id)) id = nextRoutePointId();
    if (!id) return null;
    routePointIds.add(id);
    return { id, x: Number(routePoint.x), y: Number(routePoint.y) };
  }).filter(Boolean);
  return {
    id: String(value?.id || `loom-${index + 1}`), kind: "loom",
    name: String(value?.name || `LM-${String(index + 1).padStart(3, "0")}`),
    origin: String(value?.origin ?? ""), destination: String(value?.destination ?? ""),
    sideA: point(value?.sideA, "Side A"), sideB: point(value?.sideB, "Side B"),
    labelTextColor: normalizeLoomLabelColor(value?.labelTextColor, DEFAULT_LOOM_LABEL_TEXT_COLOR),
    labelBackgroundColor: normalizeLoomLabelColor(value?.labelBackgroundColor, DEFAULT_LOOM_LABEL_BACKGROUND_COLOR),
    routeStyle: value?.routeStyle === "bezier" ? "bezier" : "orthogonal",
    routePoints, routePointCounter,
    trunkLength: String(value?.trunkLength ?? ""), notes: String(value?.notes ?? "")
  };
}

export function allocateLoomRoutePointId(loom) {
  if (!loom || typeof loom !== "object") return "";
  const points = Array.isArray(loom.routePoints) ? loom.routePoints : [];
  const used = new Set(points.map(point => point?.id).filter(isCanonicalLoomRoutePointId));
  let counter = normalizedRoutePointCounter(loom.routePointCounter);
  for (const id of used) {
    counter = Math.max(counter, parseLoomRoutePointId(id));
  }
  if (counter >= Number.MAX_SAFE_INTEGER) return "";
  do { counter += 1; } while (used.has(`lrp-${counter}`));
  loom.routePointCounter = counter;
  return `lrp-${counter}`;
}

export function addLoomRoutePoint(loom, point) {
  if (!loom || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
  loom.routePoints ||= [];
  const id = allocateLoomRoutePointId(loom);
  if (!id) return null;
  const routePoint = { id, x: point.x, y: point.y };
  loom.routePoints.push(routePoint);
  return routePoint;
}

export function allocateLoomIdentity(project) {
  const root = rootOf(project), looms = root.looms || [];
  const occupiedNames = new Set(looms.map(loom => nameKey(loom.name)));
  const ids = new Set(looms.map(loom => String(loom.id)));
  let counter = Math.max(0, Number(root.loomNumberCounter) || 0);
  for (const loom of looms) {
    const idNumber = /^loom-(\d+)$/.exec(String(loom.id || ""));
    const nameNumber = /^(?:L|LM-)(\d+)$/i.exec(String(loom.name || ""));
    counter = Math.max(counter, Number(idNumber?.[1] || 0), Number(nameNumber?.[1] || 0));
  }
  do { counter++; } while (ids.has(`loom-${counter}`) || occupiedNames.has(nameKey(`LM-${String(counter).padStart(3, "0")}`)));
  root.loomNumberCounter = counter;
  return { id: `loom-${counter}`, name: `LM-${String(counter).padStart(3, "0")}` };
}

export function selectedLoomCableGroups(project, selectedWireIds) {
  const selected = new Set([...selectedWireIds].map(String));
  return groupedCables(rootOf(project)).filter(group => group.wires.some(wire => selected.has(String(wire.id))));
}

export function loomCableGroups(project, loomId) {
  return groupedCables(rootOf(project)).filter(group => group.wires.some(wire => wire.loomId === loomId));
}

export function setLogicalCableLoom(groups, loomId) {
  for (const group of groups) for (const wire of group.wires) {
    if (loomId) wire.loomId = loomId;
    else {
      delete wire.loomId;
      delete wire.loomEntrySide;
      delete wire.loomEntryRoutePoints;
      delete wire.loomExitRoutePoints;
    }
    delete wire.loom;
  }
}

export function loomComposition(project, loomId) {
  const rows = buildCableSchedule(rootOf(project), { assignNumbers: "readOnly" })
    .filter(row => row.loomId === loomId);
  const counts = new Map();
  for (const row of rows) counts.set(row.signal, (counts.get(row.signal) || 0) + 1);
  return { circuits: rows.length, families: [...counts].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count })), rows };
}

export function migrateLegacyLooms(project) {
  const root = rootOf(project), warnings = [];
  root.looms = Array.isArray(root.looms) ? root.looms.map(normalizeLoom) : [];
  const byId = new Map(root.looms.map(loom => [loom.id, loom]));
  const byName = new Map(root.looms.map(loom => [nameKey(loom.name), loom]));
  for (const group of groupedCables(root)) {
    const ids = [...new Set(group.wires.map(wire => String(wire.loomId || "").trim()).filter(Boolean))];
    const names = [...new Set(group.wires.map(wire => String(wire.loom || "").trim()).filter(Boolean))];
    let loom = ids.map(id => byId.get(id)).find(Boolean);
    if (ids.length > 1 || names.length > 1) warnings.push(`Conflicting Loom values on cable ${group.primary.id}; kept ${loom?.name || names[0]}.`);
    if (!loom && names.length) {
      loom = byName.get(nameKey(names[0]));
      if (!loom) {
        loom = normalizeLoom({ ...allocateLoomIdentity(root), name: names[0] }, root.looms.length);
        root.looms.push(loom); byId.set(loom.id, loom); byName.set(nameKey(loom.name), loom);
      }
    }
    if (ids.length && !loom) warnings.push(`Missing Loom ${ids[0]} on cable ${group.primary.id}; membership cleared.`);
    setLogicalCableLoom([group], loom?.id || "");
  }
  return warnings;
}

export function renameLoom(project, loomId, name) {
  const root = rootOf(project), loom = (root.looms || []).find(item => item.id === loomId);
  const next = String(name || "").trim();
  if (!loom || !next || root.looms.some(item => item.id !== loomId && nameKey(item.name) === nameKey(next))) return false;
  loom.name = next;
  return true;
}

export function dissolveLoom(project, loomId) {
  const root = rootOf(project), index = (root.looms || []).findIndex(loom => loom.id === loomId);
  if (index < 0) return false;
  setLogicalCableLoom(loomCableGroups(root, loomId), "");
  root.looms.splice(index, 1);
  return true;
}
