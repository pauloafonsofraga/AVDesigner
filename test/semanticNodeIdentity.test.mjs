import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { engineConnectorColor, isEngineCageConnector, isEngineDeadCageConnector } from "../src/engine/connectorCompatibility.js";
import { resolvePersonalNodeContext } from "../src/personalDefinitions.js";
import { restoreProjectSemanticConnectorTypes, restoreSemanticConnectorTypes } from "../src/engine/semanticNodeIdentity.js";

const alias = type => `${type}-personal-9a5361be-3`;
const cage = (id, type, installedModuleType = "") => ({ id, type: alias(type), physicalType: alias(type),
  connectorType: alias(type), direction: "output", installedModuleType, x: 280, y: 100, customColor: "" });

test("saved personal cage aliases recover built-in styling and module semantics without changing relationships", () => {
  const definition = { id: "processor", name: "Processor", width: 280, height: 320, connectors: [
    cage("a", "sfp-plus-cage"), cage("b", "sfp-plus-cage"), cage("c", "sfp-cage"),
    cage("d", "qsfp-cage", "qsfp-mpo"),
    { id: "custom", type: "custom-cage-personal-9a5361be-3", direction: "output", x: 280, y: 300 }
  ], connectorRelationships: [{ id: "shared", type: "exclusive", members: ["a", "b"], outputCopy: true }] };
  const project = { deviceLibrary: [structuredClone(definition)], devices: [
    { instanceId: "main", templateId: definition.id, name: definition.name, x: 0, y: 0, templateOverride: structuredClone(definition) }
  ], connections: [] };
  const relationships = structuredClone(definition.connectorRelationships);
  assert.equal(restoreProjectSemanticConnectorTypes(project), 8);
  assert.equal(restoreProjectSemanticConnectorTypes(project), 0);
  for (const copy of [project.deviceLibrary[0], project.devices[0].templateOverride]) {
    assert.deepEqual(copy.connectors.slice(0, 4).map(connector => connector.type),
      ["sfp-plus-cage", "sfp-plus-cage", "sfp-cage", "qsfp-cage"]);
    assert.deepEqual(copy.connectors.slice(0, 4).map(connector => connector.physicalType),
      ["sfp-plus-cage", "sfp-plus-cage", "sfp-cage", "qsfp-cage"]);
    assert.equal(copy.connectors[3].installedModuleType, "qsfp-mpo");
    assert.equal(copy.connectors[4].type, "custom-cage-personal-9a5361be-3");
    assert.deepEqual(copy.connectorRelationships, relationships);
  }
  const normalized = normalizeAvDesignerProject(project).devices[0];
  for (const connector of normalized.connectors.slice(0, 3)) {
    assert.equal(isEngineCageConnector(connector), true);
    assert.equal(isEngineDeadCageConnector(connector), true);
    assert.equal(engineConnectorColor(connector), "#778492");
  }
  assert.equal(isEngineCageConnector(normalized.connectors[3]), true);
  assert.equal(isEngineDeadCageConnector(normalized.connectors[3]), false);
});

test("personal context never renames semantic cage IDs but still remaps ordinary node collisions", () => {
  const definition = { id: "processor", connectors: [cage("a", "sfp-plus-cage"),
    { id: "b", type: "qsfp-cage", direction: "output" }, { id: "c", type: "custom-control" }] };
  const sourceNodes = ["sfp-plus-cage", "qsfp-cage", "custom-control"].map(id => ({ id, label: `Personal ${id}`, color: "#111111" }));
  const destinationNodes = sourceNodes.map(node => ({ ...node, label: `Project ${node.id}`, color: "#222222" }));
  const before = structuredClone([definition, sourceNodes, destinationNodes]);
  const result = resolvePersonalNodeContext(definition, sourceNodes, destinationNodes);
  assert.deepEqual(result.definition.connectors.slice(0, 2).map(connector => connector.type), ["sfp-plus-cage", "qsfp-cage"]);
  assert.equal(result.definition.connectors[0].physicalType, "sfp-plus-cage");
  assert.equal(result.definition.connectors[0].connectorType, "sfp-plus-cage");
  assert.equal(result.nodes.some(node => node.id.startsWith("sfp-plus-cage-personal-")), false);
  assert.notEqual(result.definition.connectors[2].type, "custom-control");
  assert.deepEqual([definition, sourceNodes, destinationNodes], before);
});

test("only real LED processor outputs and known personal aliases are restored", () => {
  const aliased = "led-signal-personal-f00a0e90-2";
  const ordinary = { connectors: [{ type: aliased, direction: "output", signalIndex: 1 }] };
  assert.equal(restoreSemanticConnectorTypes(ordinary), 0);
  assert.equal(ordinary.connectors[0].type, aliased);
  const processor = { isLedProcessor: true, connectors: [
    { type: aliased, direction: "output", signalIndex: 1 },
    { type: aliased, direction: "input", signalIndex: 2 },
    { type: "sfp-plus-cage-personal-not-a-hash", direction: "output" }
  ] };
  assert.equal(restoreSemanticConnectorTypes(processor), 1);
  assert.deepEqual(processor.connectors.map(connector => connector.type),
    ["led-signal", aliased, "sfp-plus-cage-personal-not-a-hash"]);
});
