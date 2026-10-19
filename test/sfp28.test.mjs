import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { factoryPromotionNodes } from "../src/factoryPromotion.js";
import { collectDefinitionDependencies, resolvePersonalNodeContext } from "../src/personalDefinitions.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createNodeBuilderPreviewScene } from "../src/engine/nodePreview.js";
import { connectorIncludedInMatrixForEngine } from "../src/engine/matrixRouting.js";
import { restoreSemanticConnectorTypes } from "../src/engine/semanticNodeIdentity.js";
import { isEngineCageConnector, isEngineDeadCageConnector, effectiveConnectorTypeForEngine,
  engineConnectorColor, engineConnectorFiberMode, engineConnectorPlugTypeLabel,
  engineConnectorDisplayLabel, engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";

const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));
const cage = (type = "sfp28-cage", installedModuleType = "") => ({ id: "port", type, installedModuleType,
  schemaVersion: 2, signalDirection: "bidirectional", direction: "io", displaySide: "both", x: 0, y: 100 });
const compare = (source, target) => engineCompatibilitySummary(
  { device: { id: "a" }, connector: source }, { device: { id: "b" }, connector: target });

test("SFP28 is a factory editor-only cage with the same palette and direction rules as SFP+", () => {
  const type = catalogue.nodeTypes["sfp28-cage"];
  assert.deepEqual(type, { ...catalogue.nodeTypes["sfp-plus-cage"], label: "SFP28 Cage" });
  assert.ok(catalogue.nodeTags["sfp28-cage"].includes("sfp28"));
  const preview = createNodeBuilderPreviewScene({ typeId: "sfp28-cage", connectorType: type });
  assert.equal(effectiveConnectorTypeForEngine(preview.devices[0].connectors[0]), "fiber-lc");
});

test("empty SFP28 cages stay grey, labelled and unavailable until a module is installed", () => {
  const connector = cage();
  assert.equal(isEngineCageConnector(connector), true);
  assert.equal(isEngineDeadCageConnector(connector), true);
  assert.equal(engineConnectorColor(connector), "#778492");
  assert.equal(engineConnectorPlugTypeLabel(connector), "SFP28 Cage");
  assert.equal(engineConnectorDisplayLabel(connector), "SFP28 Cage Empty");
  assert.equal(effectiveConnectorTypeForEngine(connector), "");
  assert.equal(compare(connector, cage("sfp-plus-cage", "lc-singlemode")).rule, "dead-cage");
  assert.equal(connectorIncludedInMatrixForEngine(connector), false);
});

test("SFP28 modules retain SFP+ effective types, colours, fibre rules and removal behaviour", () => {
  for (const [module, expected] of [["lc-singlemode", "fiber-lc"], ["lc-multimode", "fiber-lc"], ["rj45-ethernet", "cat6a"]]) {
    const connector = cage("sfp28-cage", module), existing = cage("sfp-plus-cage", module);
    assert.equal(effectiveConnectorTypeForEngine(connector), expected);
    assert.equal(engineConnectorColor(connector), engineConnectorColor(existing));
    assert.equal(engineConnectorFiberMode(connector), engineConnectorFiberMode(existing));
    assert.equal(engineConnectorPlugTypeLabel(connector), engineConnectorPlugTypeLabel(existing));
    assert.equal(connectorIncludedInMatrixForEngine(connector), connectorIncludedInMatrixForEngine(existing));
    const compatible = compare(connector, existing);
    assert.equal(compatible.valid, true);
    assert.equal(compatible.selectedCableType, expected);
    connector.installedModuleType = "";
    assert.equal(engineConnectorColor(connector), "#778492");
    assert.equal(compare(connector, existing).valid, false);
  }
  assert.equal(compare(cage("sfp28-cage", "lc-singlemode"), cage("sfp-cage", "lc-multimode")).rule, "fiber-mode-mismatch");
  assert.equal(compare(cage("sfp28-cage", "rj45-ethernet"), cage("sfp-plus-cage", "lc-singlemode")).rule, "type-mismatch");
  for (const [module, expected] of [["SFP28 LC Singlemode", "fiber-lc"], ["SFP28 LC Multimode", "fiber-lc"], ["SFP28 RJ45 Ethernet", "cat6a"]]) {
    assert.equal(effectiveConnectorTypeForEngine(cage("sfp28-cage", module)), expected);
  }
});

test("SFP28 saved device/card definitions preserve cage identity and dependency collection", () => {
  const connector = cage("sfp28-cage", "lc-multimode");
  const definition = { id: "sfp28-device", name: "SFP28 Device", width: 320, height: 200, connectors: [connector],
    cardTypes: [{ id: "card", name: "SFP28 card", connectors: [structuredClone(connector)] }] };
  const nodes = factoryPromotionNodes(catalogue);
  const dependencies = collectDefinitionDependencies(definition, [definition], nodes);
  assert.deepEqual(dependencies.nodes.map(node => node.id), ["sfp28-cage"]);
  const alias = "sfp28-cage-personal-9a5361be-3", aliased = structuredClone(definition);
  for (const port of [aliased.connectors[0], aliased.cardTypes[0].connectors[0]]) {
    port.type = port.physicalType = port.connectorType = alias;
  }
  assert.equal(restoreSemanticConnectorTypes(aliased), 2);
  const resolved = resolvePersonalNodeContext(aliased, dependencies.nodes, dependencies.nodes.map(node => ({ ...node, color: "#111111" })));
  assert.equal(resolved.definition.connectors[0].type, "sfp28-cage");
  assert.equal(resolved.definition.cardTypes[0].connectors[0].type, "sfp28-cage");
  const project = { nodeLibrary: dependencies.nodes, deviceLibrary: [definition],
    devices: [{ instanceId: "switch", templateId: definition.id, x: 0, y: 0 }], connections: [] };
  const saved = JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(project)).exportJson());
  assert.deepEqual(saved.deviceLibrary, project.deviceLibrary);
  const reopened = normalizeAvDesignerProject(saved).devices[0].connectors[0];
  const output = buildEngineOutputScene(saved).devices[0].connectors[0];
  for (const port of [reopened, output]) {
    assert.equal(isEngineCageConnector(port), true);
    assert.equal(effectiveConnectorTypeForEngine(port), "fiber-lc");
    assert.equal(engineConnectorFiberMode(port), "om4");
  }
});
