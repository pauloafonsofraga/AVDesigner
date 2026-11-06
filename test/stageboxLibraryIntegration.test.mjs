import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { hybridMultiCoreProject } from "../fixtures/multi-core.mjs";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { buildMultiCoreReports } from "../src/engine/multiCoreReports.js";
import { migrateLegacyLooms, renameLoom } from "../src/engine/loomModel.js";
import { collectDevicePackage, encodeDevicePackage, decodeDevicePackage, prepareDevicePackageImport } from "../src/devicePackage.js";
import { imageDataUrl } from "../src/imageAssets.js";

const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));
const factory = id => structuredClone(catalogue.devices.find(device => device.id === id));
const snake = () => factory("passive-xlr-snake-4ch");

function patchProject(template) {
  const { devices } = cableTypeSelectionFixture();
  for (const device of devices) device.templateOverride.connectors[0].type = "xlr-3pin";
  return { deviceLibrary: [snake()], devices: [...devices, { instanceId: "snake", x: 320, y: 200, ...template }],
    connections: [
      { id: "send", cableType: "xlr-3pin", length: "3m", from: { deviceId: "source", connectorId: "port-0" }, to: { deviceId: "snake", connectorId: "a-2" } },
      { id: "return", cableType: "xlr-3pin", length: "5m", from: { deviceId: "snake", connectorId: "b-2" }, to: { deviceId: "sink", connectorId: "port-0" } }
    ] };
}

test("factory, historical string and inline definitions all export the same channel and physical cable rows", () => {
  for (const template of [{ templateId: snake().id }, { template: snake().id }, { template: snake() }]) {
    const project = patchProject(template), output = buildEngineOutputScene(project);
    assert.equal(output.wires.filter(w => w.stageboxAssemblyId).length, 1);
    for (const reports of [buildMultiCoreReports(project), output.modelData.reports]) {
      assert.equal(reports.cableRows.length, 2);
      assert.deepEqual(reports.cableRows.map(r => r.length).sort(), ["3m", "5m"]);
      assert.ok(reports.cableRows.every(r => r.notes.includes("CH 2")));
      const chain = reports.signalPaths.find(path => path.wireIds.includes("send"));
      assert.deepEqual(chain.path.externalCableIds, ["send", "return"]);
      assert.equal(chain.path.segments.find(s => s.passive).channelId, "ch-2");
      assert.equal(chain.path.lengthSources.length, 2);
    }
  }
});

test("mixed project round trip preserves legacy Loom, Multi-Core and ordinary powered Rio devices", () => {
  const project = { ...hybridMultiCoreProject(), ...patchProject({ templateId: snake().id }) };
  const legacy = { ...snake(), id: "old-snake", name: "Legacy Snake", isStageboxSnake: false };
  delete legacy.stageboxSnake;
  project.devices.push({ instanceId: "legacy", templateOverride: legacy, x: 2000, y: 0 });
  const rios = ["custom-device-dm7-copy", "custom-device-dm7-copy-2"].map(factory);
  for (const device of rios) project.devices.push({ instanceId: device.id, templateOverride: device, x: 2400, y: 0 });
  project.connections[0].loom = "Old snake run";
  assert.deepEqual(migrateLegacyLooms(project), []);
  assert.ok(renameLoom(project, project.looms[0].id, "Edited legacy run"));
  const saved = JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(project)).exportJson());
  for (const field of ["looms", "multiCores", "connections"]) assert.deepEqual(saved[field], project[field]);
  assert.deepEqual(saved.devices.find(d => d.instanceId === "legacy").templateOverride, legacy);
  const scene = normalizeAvDesignerProject(saved);
  assert.equal(scene.devices.filter(d => d.stageboxIdentity).length, 2);
  assert.ok(scene.wires.some(w => w.multiCoreIdentity));
  for (const rio of rios) {
    const devices = scene.devices.filter(d => d.sourceId === rio.id);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].powerWatts, rio.powerWatts);
    assert.ok(rio.powerWatts > 0);
  }
});

test("factory snake is portable as .wnx with its XLR dependency and all four channels", async () => {
  const definition = snake(), nodes = catalogue.nodes.filter(node => node.id === "xlr-3pin");
  const payload = await collectDevicePackage(definition, { library: [definition], nodes, factoryNodeTypes: catalogue.nodeTypes,
    resolveImage: path => imageDataUrl(readFileSync(new URL(path, new URL("../", import.meta.url)))) });
  const decoded = await decodeDevicePackage(await encodeDevicePackage(payload));
  const imported = prepareDevicePackageImport(decoded, { library: [definition], nodes, factoryNodeTypes: catalogue.nodeTypes,
    uuid: () => "stagebox-import" });
  assert.notEqual(imported.definition.id, definition.id);
  assert.deepEqual(imported.definition.stageboxSnake, definition.stageboxSnake);
  assert.deepEqual(decoded.devices[0].connectors, definition.connectors);
  assert.deepEqual(imported.definition.connectors.map(c => ({ ...c, type: "xlr-3pin" })), definition.connectors);
  assert.ok(imported.definition.connectors.every(c => imported.nodes.some(node => node.id === c.type
    && (node.id === "xlr-3pin" || node.compatibilityType === "xlr-3pin"))));
});
