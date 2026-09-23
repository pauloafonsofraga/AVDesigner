import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { buildEngineViewerHtml, inlineOutputAssets, scriptJson } from "../src/engine/outputViewerHtml.js";
import { outputAssetSources, resolveOutputDeviceAssets, validateOutputAssets } from "../src/engine/outputViewerAssets.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { outputViewerParityFixture } from "../fixtures/output-viewer.mjs";
const bundle = JSON.parse(readFileSync(new URL("../src/engine/generated/outputViewerBundle.json", import.meta.url)));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const payload = html => JSON.parse(html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
const snapshot = () => ({ engineScene: buildEngineOutputScene(outputViewerParityFixture()),
  reportData: { projectName: "Output parity", cableRows: [], matrixSections: [] }, metadata: { projectDataSource: "canonical-project-snapshot" } });

test("offline output embeds one Engine implementation, all images, reports and the unchanged scene", async () => {
  const s = snapshot(), before = JSON.stringify(s), requests = [];
  const assets = await inlineOutputAssets(s.engineScene, async src => { requests.push(src); return png; });
  const html = buildEngineViewerHtml(s, { bundle, assets });
  const p = payload(html);
  assert.deepEqual(p.engineScene, s.engineScene);
  assert.deepEqual(p.reportData, s.reportData);
  assert.equal(p.metadata.sceneSignature, s.engineScene.signature);
  assert.equal(p.metadata.drawingDependency, "engine-webgl");
  assert.equal(p.metadata.sceneSchemaFingerprint, s.engineScene.schemaFingerprint);
  assert.equal(JSON.stringify(s), before);
  assert.equal(requests.length, new Set(requests).size);
  assert.ok(requests.includes("VideoCoreLogo.png"));
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+(?:stylesheet|https?:)|<svg|buildStandaloneHtml|productionBridge/);
  new vm.Script(bundle.javascript);
});

test("missing external assets fail explicitly; no silent Legacy or network fallback", async () => {
  const s = snapshot();
  assert.throws(() => buildEngineViewerHtml(s, { bundle }), /Missing offline viewer image/);
  await assert.rejects(inlineOutputAssets(s.engineScene, src => src), /Cannot embed viewer image/);
  assert.throws(() => buildEngineViewerHtml(s), /bundle is unavailable/);
  assert.throws(() => buildEngineViewerHtml({ engineScene: {} }, { bundle }), /Canonical Engine/);
});

test("downloaded and hosted outputs differ only in presentation metadata, not implementation or geometry", async () => {
  const s = snapshot(), assets = await inlineOutputAssets(s.engineScene, () => png);
  const download = buildEngineViewerHtml(s, { bundle, assets });
  const hosted = buildEngineViewerHtml({ ...s, metadata: { ...s.metadata, mode: "hosted-viewer" } }, { bundle, assets, title: "Hosted title" });
  const a = payload(download), b = payload(hosted);
  assert.deepEqual(a.engineScene, b.engineScene);
  assert.equal(a.metadata.bundleHash, b.metadata.bundleHash);
  assert.equal(download.slice(download.lastIndexOf("<script>")), hosted.slice(hosted.lastIndexOf("<script>")));
});

test("inline JSON and titles safely retain hostile text without executable HTML", async () => {
  const s = snapshot(), text = '</script><script>alert("bad")</script>\u2028\u2029';
  s.reportData.projectName = text;
  const html = buildEngineViewerHtml(s, { bundle, title: text, assets: await inlineOutputAssets(s.engineScene, () => png) });
  assert.equal(payload(html).title, text);
  assert.equal(payload(html).reportData.projectName, text);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;\/script&gt;/);
  assert.doesNotMatch(scriptJson({ text }), /<|\u2028|\u2029/);
});

test("asset resolution covers faceplates, LED/image objects, title logos and PD plugs without mutation", () => {
  const device = { id: "asset-test", x: 30, visual: { faceImage: "face.png", thumbnailImage: "thumb.png",
    image: "led.png", logo: "logo.png", powerDistro: { plugEntries: [{ href: "plug.svg", x: 40 }] } } };
  const original = structuredClone(device);
  const assets = Object.fromEntries(["face.png", "thumb.png", "led.png", "logo.png", "plug.svg"].map(src => [src, png]));
  const resolved = resolveOutputDeviceAssets(device, assets);
  assert.deepEqual(device, original);
  assert.equal(resolved.x, device.x);
  assert.equal(resolved.visual.powerDistro.plugEntries[0].href, png);
  for (const key of ["faceImage", "thumbnailImage", "image", "logo"]) assert.equal(resolved.visual[key], png);
  validateOutputAssets({ devices: [resolved] });
});

test("runtime image mapping preserves scene signature, endpoints, card/bus/PD geometry and bounds", async () => {
  const { engineScene } = snapshot(), assets = await inlineOutputAssets(engineScene, () => png);
  const { scene, contract } = createOutputViewerModel(engineScene, { assets });
  assert.equal(contract.signature, engineScene.signature);
  assert.deepEqual(contract, engineScene);
  assert.deepEqual(scene.bounds(), engineScene.sceneBounds);
  for (const c of engineScene.connectors) assert.deepEqual(scene.connectorWorldPoint(scene.getDevice(c.deviceId), scene.getConnector(c.deviceId, c.connectorId)), c.worldPoint);
  for (const w of engineScene.wires) {
    assert.deepEqual(scene.endpointForWire(scene.getWire(w.id), "from"), w.endpoints.from);
    assert.deepEqual(scene.wireRenderPolyline(scene.getWire(w.id)), w.polyline);
  }
  assert.ok(outputAssetSources(engineScene).includes("VideoCoreLogo.png"));
  assert.ok(outputAssetSources({ devices: scene.devices }).every(src => src.startsWith("data:")));
});
