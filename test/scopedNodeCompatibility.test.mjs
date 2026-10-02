import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolvePersonalNodeContext } from "../src/personalDefinitions.js";
import { createCanvasClipboardPayload, prepareCanvasClipboardPaste, resolveNodeDefinitionCollisions } from "../src/engine/canvasClipboard.js";
import {
  canonicalFactoryNodeIds, generatedPersonalAliasBase, restoreProjectNodeCompatibilityTypes
} from "../src/engine/nodeCompatibilityIdentity.js";
import {
  effectiveConnectorTypeForEngine, engineCompatibilitySummary, engineConnectorCompatibilityType
} from "../src/engine/connectorCompatibility.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { buildCableSchedule } from "../src/engine/cableSchedule.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { bidirectionalJumpFixture } from "../fixtures/bidirectional-jumps.mjs";

const factory = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url), "utf8"));
const canonicalIds = canonicalFactoryNodeIds(factory.nodeTypes);
const alias = "hdmi-personal-542ee7a2";
const connector = (id, type, direction, y = 160) => ({ id, type, direction, x: direction === "output" ? 380 : 0, y });
const device = (id, name, connectors) => ({ id, name, width: 380, height: 300, connectors });

function projectWithAlias(node = { id: alias, compatibilityType: "hdmi", label: "Personal HDMI", color: "#123456" }) {
  return {
    projectName: "Scoped HDMI connection",
    nodeLibrary: [node],
    deviceLibrary: [
      device("resolume", "Resolume Main", [connector("out-1", "hdmi", "output")]),
      device("bidirectional", "HDMI <> SDI Bi-Directional", [connector("in-1", alias, "input")])
    ],
    devices: [
      { instanceId: "source", templateId: "resolume", x: 0, y: 0 },
      { instanceId: "target", templateId: "bidirectional", x: 700, y: 0 }
    ],
    connections: []
  };
}

test("factory protocols drive exact personal-alias recovery, never custom-name prefix inference", () => {
  assert.ok(canonicalIds.has("hdmi") && canonicalIds.has("sdi") && canonicalIds.has("fiber-lc") && canonicalIds.has("iec"));
  assert.ok(!canonicalIds.has("new-node-4") && !canonicalIds.has("misc") && !canonicalIds.has("custom-control"));
  assert.equal(generatedPersonalAliasBase(alias, canonicalIds), "hdmi");
  assert.equal(generatedPersonalAliasBase(`${alias}-2`, canonicalIds), "hdmi");
  assert.equal(generatedPersonalAliasBase("hdmi-personal-not-a-hash", canonicalIds), "");
  assert.equal(generatedPersonalAliasBase("custom-control-personal-aaaaaaaa", canonicalIds), "");

  const project = projectWithAlias({ id: alias, label: "HDMI", color: "#123456" });
  project.nodeLibrary.push({ id: `${alias}-2`, label: "HDMI 2" });
  project.nodeLibrary.push({ id: "hdmi-personal-not-a-hash", label: "Bad alias" });
  project.nodeLibrary.push({ id: "custom-control-personal-aaaaaaaa", label: "Custom control" });
  assert.equal(restoreProjectNodeCompatibilityTypes(project, factory.nodeTypes), 2);
  assert.deepEqual(project.nodeLibrary.map(node => node.compatibilityType || ""), ["hdmi", "hdmi", "", ""]);
  assert.equal(restoreProjectNodeCompatibilityTypes(project, factory.nodeTypes), 0);
  assert.equal(restoreProjectNodeCompatibilityTypes({ nodeLibrary: [], deviceLibrary: project.deviceLibrary }, factory.nodeTypes), 0);
  assert.equal(project.deviceLibrary[1].connectors[0].type, alias);
});

test("new personal collisions preserve scoped storage identity and all dependent connector references", () => {
  const definition = device("bidirectional", "HDMI <> SDI Bi-Directional", [
    { ...connector("in-1", "hdmi", "input"), physicalType: "hdmi", connectorType: "hdmi", cableType: "hdmi", switchPortType: "hdmi" }
  ]);
  definition.cardTypes = [{ id: "card-1", connectors: [connector("card-in", "hdmi", "input")] }];
  definition.cardSlots = [{ id: "slot-1", connectorOverrides: { "card-in": { type: "hdmi", physicalType: "hdmi" } } }];
  definition.defaultConfiguration = { connectors: [connector("default-in", "hdmi", "input")] };
  const source = [{ id: "hdmi", label: "Personal HDMI", color: "#123456", custom: false }];
  const destination = [{ id: "hdmi", label: "Factory HDMI", color: "#FFD600", custom: false }];
  const resolved = resolvePersonalNodeContext(definition, source, destination, undefined, factory.nodeTypes);
  const scoped = resolved.nodes[0];
  assert.match(scoped.id, /^hdmi-personal-[0-9a-f]{8}$/);
  assert.equal(scoped.compatibilityType, "hdmi");
  assert.equal(scoped.color, "#123456");
  for (const field of ["type", "physicalType", "connectorType", "cableType", "switchPortType"]) {
    assert.equal(resolved.definition.connectors[0][field], scoped.id);
  }
  assert.equal(resolved.definition.cardTypes[0].connectors[0].type, scoped.id);
  assert.equal(resolved.definition.cardSlots[0].connectorOverrides["card-in"].physicalType, scoped.id);
  assert.equal(resolved.definition.defaultConfiguration.connectors[0].type, scoped.id);
  assert.equal(definition.connectors[0].type, "hdmi", "source definition stays untouched");
});

test("Engine accepts ordinary HDMI to scoped HDMI without flattening scoped artwork or metadata", () => {
  const project = projectWithAlias();
  const scene = normalizeAvDesignerProject(project);
  const source = scene.devices.find(item => item.id === "source");
  const target = scene.devices.find(item => item.id === "target");
  const sourceHit = { device: source, connector: source.connectors[0] };
  const targetHit = { device: target, connector: target.connectors[0] };
  const summary = engineCompatibilitySummary(sourceHit, targetHit);
  assert.equal(summary.valid, true);
  assert.equal(summary.sourceType, "hdmi");
  assert.equal(summary.targetType, "hdmi");
  assert.equal(summary.selectedCableType, "hdmi");
  assert.equal(targetHit.connector.type, alias);
  assert.equal(targetHit.connector.effectiveType, alias);
  assert.equal(effectiveConnectorTypeForEngine(targetHit.connector), alias);
  assert.equal(engineConnectorCompatibilityType(targetHit.connector), "hdmi");
  assert.equal(targetHit.connector.color, "#123456");
  assert.equal(targetHit.connector.typeLabel, "Personal HDMI");
  assert.equal(targetHit.connector.label, "Personal HDMI");
  assert.equal(engineCompatibilitySummary({ device: source, connector: { ...source.connectors[0], type: "sdi" } }, targetHit).valid, false);
  const saved = JSON.parse(JSON.stringify(project));
  assert.equal(normalizeAvDesignerProject(saved).devices.find(item => item.id === "target").connectors[0].compatibilityType, "hdmi");

  saved.connections.push({ id: "wire-1", from: { deviceId: "source", connectorId: "out-1" },
    to: { deviceId: "target", connectorId: "in-1" }, cableType: "hdmi" });
  const row = buildCableSchedule(saved, { assignNumbers: "readOnly" })[0];
  assert.equal(row.signal, "Video");
  assert.equal(row.cableTypeId, "hdmi");
  assert.equal(row.sourceNodeTypeId, "hdmi");
  assert.equal(row.destinationNodeTypeId, "hdmi");

  const graph = new SceneGraph();
  graph.setData(scene);
  assert.equal(graph.getConnector("target", "in-1").compatibilityType, "hdmi");
  graph.updateConnector("target", "in-1", { type: "sdi" });
  assert.equal(engineConnectorCompatibilityType(graph.getConnector("target", "in-1")), "sdi",
    "changing node type cannot retain the previous alias's electrical identity");
});

test("custom collision aliases remain isolated unless compatibility is explicitly authored", () => {
  const customA = { id: "custom-control", label: "Control A", color: "#111111", custom: true };
  const customB = { id: "custom-control", label: "Control B", color: "#222222", custom: true };
  const customC = { id: "custom-control", label: "Control C", color: "#333333", custom: true };
  const first = resolveNodeDefinitionCollisions([customB], [customA], "personal", undefined, canonicalIds).nodeDefinitions[0];
  const second = resolveNodeDefinitionCollisions([customC], [customA, first], "personal", undefined, canonicalIds).nodeDefinitions[0];
  assert.notEqual(first.id, second.id);
  assert.equal(first.compatibilityType, undefined);
  assert.equal(second.compatibilityType, undefined);
  assert.equal(engineCompatibilitySummary({ device: { id: "a" }, connector: connector("a", first.id, "output") },
    { device: { id: "b" }, connector: connector("b", second.id, "input") }).valid, false);
});

test("clipboard carries a scoped factory variant even when its node is not marked custom", () => {
  const project = projectWithAlias({ id: alias, compatibilityType: "hdmi", label: "Personal HDMI",
    color: "#123456", custom: false });
  const payload = createCanvasClipboardPayload(project, [{ type: "device", id: "target" }],
    { x: 850, y: 100, width: 380, height: 300 });
  assert.equal(payload.nodeLibrary.length, 1);
  assert.equal(payload.nodeLibrary[0].id, alias);
  assert.equal(payload.nodeLibrary[0].compatibilityType, "hdmi");
  const plan = prepareCanvasClipboardPaste(payload,
    { devices: [], deviceLibrary: [], nodeLibrary: [], factoryNodeTypes: factory.nodeTypes }, { x: 100, y: 100 });
  assert.equal(plan.nodeDefinitions[0].compatibilityType, "hdmi");
});

test("SDI, power and fibre aliases retain direction and module guards", () => {
  const compatible = (source, target) => engineCompatibilitySummary(
    { device: { id: "a" }, connector: source }, { device: { id: "b" }, connector: target });
  assert.equal(compatible(connector("a", "sdi", "output"),
    { ...connector("b", "sdi-personal-12345678", "input"), compatibilityType: "sdi" }).valid, true);
  assert.equal(compatible(connector("a", "iec", "output"),
    { ...connector("b", "iec-personal-12345678", "input"), compatibilityType: "iec" }).valid, true);
  assert.equal(compatible(connector("a", "hdmi", "input"),
    { ...connector("b", alias, "input"), compatibilityType: "hdmi" }).rule, "input-input");
  assert.equal(compatible({ ...connector("a", "fiber-lc", "output"), fiberMode: "single-mode" },
    { ...connector("b", "fiber-lc-personal-12345678", "input"), compatibilityType: "fiber-lc", fiberMode: "om4" }).rule,
  "fiber-mode-mismatch");
  assert.equal(compatible(connector("a", "fiber-lc", "output"),
    { ...connector("b", "sfp-cage", "input"), compatibilityType: "fiber-lc" }).rule, "dead-cage");
});

test("Jump Node inspection exposes the canonical cable type without losing its scoped endpoint", () => {
  const project = bidirectionalJumpFixture();
  project.nodeLibrary = [{ id: alias, compatibilityType: "hdmi", label: "Personal HDMI", color: "#123456" }];
  project.devices[0].templateOverride.connectors[0].type = alias;
  const graph = new SceneGraph();
  graph.setData(normalizeAvDesignerProject(project));
  graph.addJumpLink({ id: "scoped-portal", outputJumpId: "a", inputJumpId: "b" });
  assert.equal(graph.getConnector("source", "port").type, alias);
  assert.equal(graph.jumpNodeConnectionInfo("a").cableType, "hdmi");
});
