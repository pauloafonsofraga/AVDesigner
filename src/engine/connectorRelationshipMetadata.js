import { normalizeLegacyDirection, normalizeSignalDirection } from "./deviceDefinitionV2.js";

// The same pure runtime is embedded in offline viewers and used by the classic editor.
function createRelationshipMetadataRuntime(normalizeSignalDirection, normalizeLegacyDirection) {
  const fields = Object.freeze(["nameText", "resolutionFrameRate", "customText",
    "nameTextCaption", "resolutionFrameRateCaption", "customTextCaption"]);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const unique = values => [...new Set((Array.isArray(values) ? values : []).filter(value => value != null).map(String).filter(Boolean))];

  function graphFor(device, options) {
    const connectors = (Array.isArray(device?.connectors) ? device.connectors : []).filter(c => c?.id);
    const byId = new Map(connectors.map(c => [String(c.id), c]));
    const edges = new Map(fields.map(field => [field, new Map(connectors.map(c => [String(c.id), new Set()]))]));
    const sources = new Map(fields.map(field => [field, []]));
    const outputs = new Set();
    const join = (members, keys, source) => keys.forEach(key => {
      const map = edges.get(key);
      members.forEach(id => members.forEach(other => { if (id !== other) map.get(id).add(other); }));
      sources.get(key).push(source);
    });
    const relationships = device?.connectorRelationships || device?.connectorTopology?.relationships || [];
    (Array.isArray(relationships) ? relationships : []).forEach(r => {
      if (!r) return;
      const type = String(r.type || r.relationshipType || "").toLowerCase();
      const bus = ["exclusive", "shared-bus", "exclusive-shared-bus", "exclusive-shared"].includes(type);
      const through = ["through", "loop-through", "loopthrough", "pass-through", "passthrough"].includes(type);
      if (!bus && !through) return;
      const members = unique(r.members || r.connectorIds || [r.sourceConnectorId, r.targetConnectorId, r.fromConnectorId, r.toConnectorId])
        .filter(id => byId.has(id));
      if (members.length < 2) return;
      const source = String(r.sourceConnectorId || r.fromConnectorId || "");
      const target = String(r.targetConnectorId || r.toConnectorId || "");
      if (bus) {
        join(members, fields, members.includes(source) ? source : members[0]);
      } else {
        const candidates = members.filter(id => {
          const c = byId.get(id);
          return normalizeSignalDirection(c.signalDirection, c.direction) === "output"
            || normalizeLegacyDirection(c.direction) === "output";
        });
        const output = candidates.length === 1 ? candidates[0]
          : members.includes(target) ? target : members[1];
        outputs.add(output);
        const input = members.find(id => id !== output && normalizeSignalDirection(byId.get(id).signalDirection, byId.get(id).direction) === "input")
          || (members.includes(source) && source !== output ? source : members.find(id => id !== output));
        join(members, fields.filter(key => key !== "nameText"), input);
      }
    });
    if (options.syncPaired !== false) connectors.forEach(c => {
      const pairId = String(c.pairedConnectorId || "");
      if (byId.has(pairId) && pairId !== String(c.id)) join([String(c.id), pairId],
        fields.filter(key => key !== "nameText" || (!outputs.has(String(c.id)) && !outputs.has(pairId))), String(c.id));
    });
    const component = (key, id) => {
      const found = new Set([id]), queue = [id];
      for (let i = 0; i < queue.length; i++) for (const other of edges.get(key).get(queue[i]) || []) {
        if (!found.has(other)) { found.add(other); queue.push(other); }
      }
      return [...found];
    };
    return { connectors, byId, edges, sources, outputs, component };
  }

  function resolve(device = {}, connectorId = "", patch = null, options = {}) {
    const graph = graphFor(device, options), changes = new Map(), affected = new Set();
    const put = (id, key, value) => {
      affected.add(id);
      if (!changes.has(id)) changes.set(id, {});
      changes.get(id)[key] = value;
    };
    if (patch !== null) {
      const id = String(connectorId || "");
      if (!graph.byId.has(id)) return { device, affectedConnectorIds: [], patches: [] };
      fields.forEach(key => {
        if (!own(patch, key)) return;
        graph.component(key, id).forEach(member => {
          put(member, key, String(patch[key] ?? ""));
          if (key === "nameText") put(member, "nameCustom", true);
        });
      });
      if (own(patch, "nameCustom") && !own(patch, "nameText")) put(id, "nameCustom", patch.nameCustom === true || patch.nameCustom === "true");
    } else {
      fields.forEach(key => {
        const visited = new Set();
        graph.connectors.forEach(c => {
          const id = String(c.id);
          if (visited.has(id)) return;
          const members = graph.component(key, id);
          members.forEach(member => visited.add(member));
          if (members.length < 2) return;
          const source = graph.sources.get(key).find(member => members.includes(member)) || members[0];
          members.forEach(member => {
            put(member, key, String(graph.byId.get(source)[key] ?? ""));
            if (key === "nameText") put(member, "nameCustom", true);
          });
        });
      });
    }
    // LOOP is a hard Name constraint, including any BUS sharing that output.
    const relevant = patch === null ? null : new Set(graph.component("customText", String(connectorId)));
    graph.outputs.forEach(id => {
      if (relevant && !relevant.has(id)) return;
      graph.component("nameText", id).forEach(member => {
        put(member, "nameText", "LOOP");
        put(member, "nameCustom", true);
      });
    });
    const patches = [], connectors = (Array.isArray(device.connectors) ? device.connectors : []).map(c => {
      const requested = changes.get(String(c?.id));
      if (!requested) return c;
      const changed = Object.fromEntries(Object.entries(requested).filter(([key, value]) => c[key] !== value));
      if (!Object.keys(changed).length) return c;
      patches.push({ connectorId: String(c.id), fields: changed });
      return { ...c, ...changed };
    });
    return { device: patches.length ? { ...device, connectors } : device,
      affectedConnectorIds: unique(graph.connectors.map(c => String(c.id)).filter(id => affected.has(id))), patches };
  }
  return Object.freeze({ fields,
    applyConnectorRelationshipFieldPatch: (device, id, patch, options = {}) => resolve(device, id, patch || {}, options),
    normalizeConnectorRelationshipMetadata: (device, options = {}) => resolve(device, "", null, options) });
}

const runtime = createRelationshipMetadataRuntime(normalizeSignalDirection, normalizeLegacyDirection);
export const CONNECTOR_RELATIONSHIP_FIELDS = runtime.fields;
export const applyConnectorRelationshipFieldPatch = runtime.applyConnectorRelationshipFieldPatch;
export const normalizeConnectorRelationshipMetadata = runtime.normalizeConnectorRelationshipMetadata;
export const relationshipMetadataRuntimeSource = `(() => { const normalizeLegacyDirection = ${normalizeLegacyDirection.toString()}; const normalizeSignalDirection = ${normalizeSignalDirection.toString()}; return (${createRelationshipMetadataRuntime.toString()})(normalizeSignalDirection, normalizeLegacyDirection); })()`;
