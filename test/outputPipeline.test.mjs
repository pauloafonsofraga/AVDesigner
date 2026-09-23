import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateOutputPipeline } from "../scripts/output-pipeline-validation.mjs";
import { OUTPUT_SCENE_VERSION, OUTPUT_SCENE_SCHEMA, OUTPUT_SCENE_SCHEMA_FINGERPRINT } from "../src/engine/outputSceneContract.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { buildEngineViewerHtml, inlineOutputAssets } from "../src/engine/outputViewerHtml.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { outputAssetSources } from "../src/engine/outputViewerAssets.js";
import { outputPrintFixture } from "../fixtures/output-print.mjs";
import { outputViewerScaleFixture } from "../fixtures/output-viewer.mjs";
const bundle = JSON.parse(readFileSync(new URL("../src/engine/generated/outputViewerBundle.json", import.meta.url)));
const payload = html => JSON.parse(html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);

test("output entry points reject retired renderers and share Engine ownership", () => {
  assert.equal(validateOutputPipeline().outputs, 3);
});
for (const [name, project] of [["representative", outputPrintFixture()], ["100 devices / 300 wires", outputViewerScaleFixture()]]) {
  test(name + ": HTML, Publish and vector PDF share schema, signature and geometry", async () => {
    const before = JSON.stringify(project), engineScene = buildEngineOutputScene(project);
    assert.deepEqual(Object.keys(engineScene).sort(), Object.keys(OUTPUT_SCENE_SCHEMA).sort());
    const image = outputPrintFixture().ledSurfaces[0].image;
    const assets = await inlineOutputAssets(engineScene, () => image);
    const snapshot = { engineScene, reportData: { projectName: name }, metadata: {} };
    const download = payload(buildEngineViewerHtml(snapshot, { bundle, assets }));
    const publish = payload(buildEngineViewerHtml(snapshot, { bundle, assets, title: "Hosted" }));
    const images = Object.fromEntries(outputAssetSources(engineScene).map(src => [src, { href: assets[src] || src, width: 20, height: 10 }]));
    const pdf = renderEngineOutputSvg(snapshot, { images });
    assert.equal(pdf.diagnostics.sceneVersion, OUTPUT_SCENE_VERSION);
    assert.equal(pdf.diagnostics.sceneSchemaFingerprint, OUTPUT_SCENE_SCHEMA_FINGERPRINT);
    for (const output of [download, publish]) {
      assert.deepEqual(output.engineScene, engineScene);
      assert.equal(output.metadata.sceneVersion, pdf.diagnostics.sceneVersion);
      assert.equal(output.metadata.sceneSchemaFingerprint, pdf.diagnostics.sceneSchemaFingerprint);
      assert.equal(output.metadata.sceneSignature, pdf.diagnostics.signature);
      assert.equal(output.metadata.bundleHash, bundle.bundleHash);
      const model = createOutputViewerModel(output);
      assert.deepEqual(model.contract.sharedBuses, engineScene.sharedBuses);
      assert.deepEqual(model.contract.cards, engineScene.cards);
      assert.deepEqual(model.contract.rackExposure, engineScene.rackExposure);
      for (const c of engineScene.connectors) assert.deepEqual(model.scene.connectorWorldPoint(model.scene.getDevice(c.deviceId), model.scene.getConnector(c.deviceId, c.connectorId)), c.worldPoint);
      for (const w of engineScene.wires) assert.deepEqual(model.scene.wireRenderPolyline(model.scene.getWire(w.id)), w.polyline);
    }
    assert.deepEqual(pdf.diagnostics.bounds, engineScene.bounds);
    assert.deepEqual(pdf.diagnostics.counts, engineScene.diagnostics.counts);
    assert.match(pdf.svg, /<metadata>.*sceneSchemaFingerprint/);
    assert.equal(JSON.stringify(project), before);
  });
}
test("viewer and print backends reject an incompatible scene schema", () => {
  const original = buildEngineOutputScene(outputPrintFixture());
  for (const scene of [{ ...original, version: 99 }, { ...original, schemaFingerprint: "wrong" }]) {
    assert.throws(() => createOutputViewerModel(scene), /version\/schema mismatch/);
    assert.throws(() => buildEngineViewerHtml({ engineScene: scene }, { bundle }), /version\/schema mismatch/);
    assert.throws(() => renderEngineOutputSvg(scene), /version\/schema mismatch/);
  }
});
