export const QSFP_BREAKOUT_VERSION = 1;

const mode = (id, sourceForm, sourceRate, branchCage, branchForm, branchRate) => Object.freeze({
  id, sourceForm, sourceRate, branchCage, branchForm, branchRate,
  lanes: Object.freeze([1, 2, 3, 4]), lanesPerChannel: 1
});
export const QSFP_BREAKOUT_MODES = Object.freeze([
  mode("qsfp-plus-4x10g", "qsfp-plus", "40G", "sfp-plus-cage", "sfp-plus", "10G"),
  mode("qsfp28-4x25g", "qsfp28", "100G", "sfp28-cage", "sfp28", "25G")
]);
const modes = new Map(QSFP_BREAKOUT_MODES.map(item => [item.id, item]));
const profiles = new Map(QSFP_BREAKOUT_MODES.flatMap(mode => [
  ["dac", "direct-attach-copper"], ["aoc", "active-optical"]
].map(([kind, mediaType]) => {
  const cableType = `breakout-${mode.id}-${kind}`;
  return [cableType, Object.freeze({ cableType, modeId: mode.id, mediaType })];
})));
export const qsfpBreakoutMode = id => modes.get(id);
export const qsfpBreakoutCableProfile = type => profiles.get(type);
export const BREAKOUT_CHANNEL_STATES = Object.freeze(["connected", "disconnected", "unused", "disabled"]);
export const QSFP_BREAKOUT_LENGTH_UNITS = Object.freeze(["mm", "cm", "m", "km", "in", "ft", "yd"]);
export const QSFP_BREAKOUT_MAX_ROUTE_POINTS = 64;

export const breakoutProjectRoot = project => project?.state || project?.project || project || {};
export const breakoutList = value => Array.isArray(value) ? value : [];
export const breakoutId = value => typeof value === "string" && value.length <= 512
  && Boolean(value.trim()) && value === value.trim() && !["__proto__", "constructor", "prototype"].includes(value);
export const breakoutPortKey = ({ deviceId, connectorId }) => JSON.stringify([deviceId, connectorId]);

// Ambiguous or missing identities stay in the project but cannot identify one physical object.
export function uniquelyIdentifiedQsfpBreakouts(assemblies) {
  const byId = new Map();
  for (const assembly of breakoutList(assemblies)) {
    if (breakoutId(assembly?.id)) byId.set(assembly.id, byId.has(assembly.id) ? null : assembly);
  }
  return [...byId.values()].filter(Boolean);
}

// Import/export keeps optional, incomplete and future-version records intact.
// Validation never creates IDs, assigns lanes, or normalizes a destination.
export function breakoutProjectFields(project, { cloneValues = true } = {}) {
  const root = breakoutProjectRoot(project);
  return Object.hasOwn(root, "breakoutAssemblies")
    ? { breakoutAssemblies: cloneValues ? structuredClone(root.breakoutAssemblies) : root.breakoutAssemblies }
    : {};
}

export function breakoutReservations(project) {
  return breakoutList(breakoutProjectRoot(project).breakoutAssemblies).flatMap(assembly =>
    [{ role: "source", endpoint: assembly?.source },
      ...breakoutList(assembly?.branches).map(branch => ({ role: "branch", branchId: branch?.id, endpoint: branch?.destination }))]
      .filter(({ endpoint }) => breakoutId(endpoint?.deviceId) && breakoutId(endpoint?.connectorId))
      .map(entry => ({ ...entry, assemblyId: assembly.id })));
}

export function breakoutPortReserved(project, deviceId, connectorId) {
  return breakoutReservations(project).some(({ endpoint }) => endpoint.deviceId === deviceId && endpoint.connectorId === connectorId);
}

export function breakoutDeviceReserved(project, deviceId) {
  return breakoutReservations(project).some(({ endpoint }) => endpoint.deviceId === deviceId);
}

export const qsfpBreakoutLinkId = (assemblyId, branchId) => JSON.stringify(["qsfp-breakout-lane", assemblyId, branchId]);
export const qsfpBreakoutModeLabel = mode => mode ? `4 x ${mode.branchRate}` : "Unverified";
export const qsfpBreakoutCableLabel = type => {
  const profile = qsfpBreakoutCableProfile(type);
  return profile ? `QSFP Breakout ${profile.mediaType === "active-optical" ? "AOC" : "DAC"}` : "QSFP Breakout";
};
export const qsfpBreakoutLengthLabel = length => Number.isFinite(length?.value) && typeof length.unit === "string"
  ? `${length.value} ${length.unit}` : "";

export function qsfpBreakoutChannels(assembly) {
  if (assembly?.schemaVersion !== QSFP_BREAKOUT_VERSION) return [];
  return breakoutList(assembly.channels).filter(channel => breakoutId(channel?.id)).map(channel => {
    const branches = breakoutList(assembly.branches).filter(branch => branch?.channelId === channel.id);
    const branch = branches.length === 1 ? branches[0] : null;
    const endpoint = branch?.destination;
    return { channelId: channel.id, lanes: breakoutList(channel.lanes).filter(Number.isSafeInteger),
      state: BREAKOUT_CHANNEL_STATES.includes(channel.state) ? channel.state : undefined,
      branchId: breakoutId(branch?.id) ? branch.id : undefined,
      destination: breakoutId(endpoint?.deviceId) && breakoutId(endpoint?.connectorId) ? endpoint : null };
  }).sort((a, b) => (a.lanes[0] ?? Infinity) - (b.lanes[0] ?? Infinity));
}

export function createQsfpBreakoutAssembly({ id, source, modeId, cableType, routeStyle = "bezier" }) {
  const mode = qsfpBreakoutMode(modeId);
  if (!mode || qsfpBreakoutCableProfile(cableType)?.modeId !== modeId) throw new Error("Choose a compatible breakout assembly.");
  return {
    id, schemaVersion: QSFP_BREAKOUT_VERSION, source: { ...source }, modeId, cableType,
    length: null, routeStyle, routePoints: [],
    channels: mode.lanes.map(lane => ({ id: `${id}-channel-${lane}`, lanes: [lane], state: "unused" })),
    branches: mode.lanes.map(lane => ({ id: `${id}-branch-${lane}`, channelId: `${id}-channel-${lane}`, destination: null }))
  };
}
