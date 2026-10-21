import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { cardSafetyFixture } from "../test/helpers/cardSafetyFixture.mjs";
import { multiCoreJumpProject } from "../fixtures/multi-core-jump.mjs";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8774";
const shots = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-prompt2";
mkdirSync(shots, {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
const modifier = process.platform === "darwin" ? "Meta" : "Control";
try {
  const context = await browser.newContext({viewport: {width: 1700, height: 1100}, permissions: ["clipboard-read", "clipboard-write"]});
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage(), errors = [], dialogs = [], checks = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", async d => { dialogs.push(d.message()); await d.accept(); });
  await page.goto(base); await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded && canvasClipboardModule);
  const fixture = cardSafetyFixture();
  fixture.deviceLibrary[0].connectors = structuredClone(fixture.deviceLibrary[0].cardTypes[0].connectors);
  fixture.deviceLibrary[0].connectors.forEach((c, i) => {c.y = 154 + i * 54; c.label = "SDI";});
  fixture.deviceLibrary[0].cardTypes = []; fixture.deviceLibrary[0].cardSlots = []; fixture.deviceLibrary[0].hasSwappableCards = false;
  fixture.connections[0].from.connectorId = "p1";
  await page.evaluate(data => restoreSnapshot(data), fixture);
  await page.evaluate(() => openDeviceEditorForInstance("chassis-1"));
  await page.locator('[data-editor-tab="connectors"]').click();
  const draft = () => page.evaluate(() => structuredClone(currentEditorTemplate()));
  const drag = async (type, id, card = false, cancel = false) => {
    const chip = page.locator(`#nodePalette [data-node-type="${type}"]`);
    await chip.scrollIntoViewIfNeeded();
    const target = card ? page.locator(`[data-card-preview-node="${id}"] circle`).first()
      : page.locator(`[data-editor-node-id="${id}"] .editor-engine-hit`).first();
    const a = await chip.boundingBox(), b = await target.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, {steps: 3});
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {steps: 12});
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.locator('[data-node-replacement-preview]').waitFor();
    await page.screenshot({path: `${shots}/preview-${card ? 'card' : id}-${type}.png`});
    if (cancel) await page.mouse.move(5, 5, {steps: 8});
    await page.mouse.up();
  };
  const original = await draft(), cables = await page.evaluate(() => structuredClone(state.connections));
  await page.screenshot({path: `${shots}/nodes-before.png`});
  await drag("hdmi", "p1");
  assert.deepEqual(await draft(), original, "connected SDI must reject HDMI");
  assert.match(dialogs.join(" "), /cable-1/);
  assert.equal(await page.evaluate(() => editorMetadataHistory.undo.length), 0);
  await drag("hdmi", "p2", false, true);
  assert.deepEqual(await draft(), original, "Canceled drag outside the editor must not change the draft");
  assert.equal(await page.locator('[data-node-replacement-preview]').count(), 0);
  if (!await page.locator('#deviceEditorModal').isVisible()) {
    await page.evaluate(() => openDeviceEditorForInstance("chassis-1"));
    await page.locator('[data-editor-tab="connectors"]').click();
  }
  await drag("hdmi", "p2");
  const changed = await draft();
  assert.equal(changed.connectors.length, original.connectors.length);
  assert.equal(changed.connectors[1].type, "hdmi");
  for (const key of ["id", "x", "y", "nameText", "direction"]) assert.deepEqual(changed.connectors[1][key], original.connectors[1][key]);
  assert.equal(await page.evaluate(() => editorMetadataHistory.undo.length), 1);
  await page.screenshot({path: `${shots}/nodes-after.png`});
  await page.keyboard.press(`${modifier}+z`); assert.deepEqual(await draft(), original);
  await page.keyboard.press(`${modifier}+Shift+z`); assert.deepEqual(await draft(), changed);
  await page.locator('#closeDeviceEditor').click();
  await page.locator('[data-choice="keep"]').click();
  assert.deepEqual(await draft(), changed);
  await page.keyboard.press('Escape');
  await page.locator('[data-choice="keep"]').click();
  assert.deepEqual(await draft(), changed);
  await drag("sdi", "p1"); assert.equal((await draft()).connectors[0].type, "sdi");
  assert.deepEqual(await page.evaluate(() => state.connections), cables);
  assert.equal(await page.locator('[data-node-replacement-preview]').count(), 0);
  await page.locator('#applyDeviceEditor').click(); await page.locator('#deviceEditorModal').waitFor({state: "hidden"});
  await page.evaluate(() => openDeviceEditorForInstance("chassis-1"));
  assert.equal((await draft()).connectors.find(c => c.id === "p2").type, "hdmi");
  await page.locator('[data-editor-tab="connectors"]').click();
  const savedDraft = await draft();
  await drag('sdi', 'p2');
  await page.locator('#closeDeviceEditor').click();
  await page.locator('[data-choice="discard"]').click();
  await page.locator('#deviceEditorModal').waitFor({state: "hidden"});
  await page.evaluate(() => openDeviceEditorForInstance("chassis-1"));
  assert.deepEqual(await draft(), savedDraft, 'Discard restores the saved definition');
  await page.locator('[data-editor-tab="connectors"]').click();
  const chip = page.locator('#nodePalette [data-node-type="hdmi"]');
  await chip.scrollIntoViewIfNeeded();
  const emptyPoint = await page.evaluate(() => {
    const svg = deviceEditorPreview, point = svg.createSVGPoint();
    point.x = deviceTemplateWidth(currentEditorTemplate()) / 2;
    point.y = currentEditorTemplate().connectors[0].y;
    const p = point.matrixTransform(svg.getScreenCTM());
    return {x: p.x, y: p.y};
  });
  const chipBounds = await chip.boundingBox();
  await page.mouse.move(chipBounds.x + 12, chipBounds.y + 12); await page.mouse.down();
  await page.mouse.move(chipBounds.x + 22, chipBounds.y + 12, {steps: 3});
  await page.mouse.move(emptyPoint.x, emptyPoint.y, {steps: 12});
  await page.mouse.move(emptyPoint.x, emptyPoint.y); await page.mouse.up();
  assert.equal((await draft()).connectors.length, savedDraft.connectors.length + 1, 'Empty-space drop inserts');
  await page.keyboard.press(`${modifier}+z`); assert.deepEqual(await draft(), savedDraft);
  await page.locator('#closeDeviceEditor').click(); await page.locator('#deviceEditorModal').waitFor({state: "hidden"});
  checks.push("native occupied-node replacement, incompatible rejection, stable ID/position/name, one-step draft undo/redo, Save and reopen");
  checks.push("empty-space insertion, drag cancellation, undo to clean, Keep Editing, Escape and Discard guards");
  const replacementOutput = await page.evaluate(async () => {
    const {snapshot} = await prepareEngineViewerOutput({mode: 'hosted-viewer'});
    return {ports: snapshot.engineScene.devices.find(d => d.id === 'chassis-1').connectors, wires: snapshot.engineScene.wires};
  });
  assert.equal(replacementOutput.ports.find(c => c.id === 'p2').type, 'hdmi');
  assert.equal(replacementOutput.wires[0].fromConnectorId, 'p1');
  await page.locator('#exportPdf').click();
  const replacementPdf = page.waitForEvent('download'); await page.locator('#confirmPdfExport').click();
  await (await replacementPdf).saveAs(`${shots}/replacement.pdf`);
  assert.equal(readFileSync(`${shots}/replacement.pdf`).subarray(0, 5).toString(), '%PDF-');
  checks.push('replacement Publish preparation retains types/attachments; vector PDF downloads');

  await page.evaluate(data => restoreSnapshot(data), cardSafetyFixture("sdi", false));
  await page.evaluate(() => openDeviceEditorForInstance("chassis-1"));
  await page.locator('[data-editor-tab="cards"]').click();
  const cardBefore = await draft();
  await drag("hdmi", "0", true);
  const cardAfter = await draft();
  assert.equal(cardAfter.cardTypes[0].connectors[0].type, "hdmi");
  assert.deepEqual(cardAfter.cardSlots.map(s=>s.id), cardBefore.cardSlots.map(s=>s.id));
  assert.equal(cardAfter.cardTypes[0].connectors[0].id, "p1");
  await page.keyboard.press(`${modifier}+z`); assert.deepEqual(await draft(), cardBefore);
  await page.keyboard.press(`${modifier}+Shift+z`); assert.deepEqual(await draft(), cardAfter);
  await page.screenshot({path: `${shots}/card-after.png`});
  await page.locator('#applyDeviceEditor').click(); await page.locator('#deviceEditorModal').waitFor({state: "hidden"});
  checks.push("native card-node replacement with stable card/slot IDs and exact undo/redo");

  for (const type of ['exclusive', 'mirrored']) {
    const related = structuredClone(fixture);
    related.deviceLibrary[0].connectorRelationships = [{id: 'relationship', type, members: ['p1', 'p2']}];
    await page.evaluate(data => restoreSnapshot(data), related);
    await page.evaluate(() => openDeviceEditorForInstance('chassis-1'));
    await page.locator('[data-editor-tab="connectors"]').click();
    const before = await draft();
    await drag('hdmi', 'p2');
    if (type === 'mirrored') {
      assert.deepEqual(await draft(), before);
      assert.equal(await page.evaluate(() => editorMetadataHistory.undo.length), 0);
    } else {
      assert.deepEqual((await draft()).connectorRelationships, before.connectorRelationships);
      assert.equal((await draft()).connectors[1].type, 'hdmi');
      await page.keyboard.press(`${modifier}+z`); assert.deepEqual(await draft(), before);
    }
    await page.locator('#closeDeviceEditor').click(); await page.locator('#deviceEditorModal').waitFor({state: 'hidden'});
  }
  checks.push('native Exclusive replacement keeps membership; incompatible shared/mirrored bus rejects without dirtying');

  fixture.jumpNodes = [{id: "jump-a", x: 600, y: 500, label: "A", pairId: "pair"}, {id: "jump-b", x: 900, y: 500, label: "B", pairId: "pair"}];
  fixture.jumpLinks = [{id: "link", outputJumpId: "jump-a", inputJumpId: "jump-b"}];
  fixture.connections[0].to = {jumpNodeId: "jump-a"};
  fixture.connections.push({id: "peer-cable", cableNumber: "V-001", cableType: "sdi", from: {jumpNodeId: "jump-b"}, to: {deviceId: "sink-1", connectorId: "in"}});
  await page.evaluate(data => restoreSnapshot(data), fixture);
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  const originals = await page.evaluate(() => ({nodes: structuredClone(state.jumpNodes), links: structuredClone(state.jumpLinks), wires: structuredClone(state.connections)}));
  for (const ids of [["jump-a"], ["jump-a", "jump-b"]]) {
    await page.evaluate(ids => { const b = activeEngineBridge(); b.scene.selectMany(ids); b.updateSelectionHud(); document.activeElement?.blur(); setStatus("Copy pending"); }, ids);
    const count = await page.evaluate(() => state.jumpNodes.length);
    await page.keyboard.press(`${modifier}+c`);
    await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('system clipboard'));
    await page.keyboard.press(`${modifier}+v`);
    await page.waitForFunction(n => state.jumpNodes.length === n, count + ids.length).catch(async error => {
      console.log(await page.evaluate(() => ({status: document.querySelector('#statusText').textContent, selected: state.selected, jumps: state.jumpNodes})));
      throw error;
    });
    const pasted = await page.evaluate(n => state.jumpNodes.slice(n), count);
    assert.ok(pasted.every(j => !j.pairId && !j.attachedDeviceId));
    assert.deepEqual(await page.evaluate(() => state.jumpLinks), originals.links);
    assert.deepEqual(await page.evaluate(() => state.connections), originals.wires);
    await page.keyboard.press(`${modifier}+z`); await page.waitForFunction(n => state.jumpNodes.length === n, count);
    await page.keyboard.press(`${modifier}+Shift+z`); await page.waitForFunction(n => state.jumpNodes.length === n, count + ids.length);
    assert.deepEqual(await page.evaluate(n => state.jumpNodes.slice(n), count), pasted);
  }
  await page.screenshot({path: `${shots}/jumps-pasted.png`});
  const waiting = page.waitForEvent("download"); await page.locator('#saveProjectAs').click();
  const path = `${shots}/jump-copy.avd`; await (await waiting).saveAs(path);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  await page.locator('#fileInput').setInputFiles(path);
  await page.waitForFunction(n => state.jumpNodes.length === n, saved.jumpNodes.length);
  assert.deepEqual(await page.evaluate(() => state.jumpNodes), saved.jumpNodes);
  assert.deepEqual(await page.evaluate(() => state.connections), originals.wires);
  checks.push("native single/pair Jump copy/paste, original topology preserved, exact undo/redo identities and project save/reload");

  const htmlDownload = page.waitForEvent("download"); await page.locator('#exportHtml').click();
  const htmlPath = `${shots}/jump-copy.html`; await (await htmlDownload).saveAs(htmlPath);
  const output = JSON.parse(readFileSync(htmlPath, 'utf8').match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
  assert.equal(output.engineScene.jumpLinks.length, 1);
  const offline = await browser.newContext({offline: true});
  const viewer = await offline.newPage();
  await viewer.goto(`file://${htmlPath}`); await viewer.waitForFunction(() => window.outputViewer?.model);
  assert.equal(await viewer.evaluate(() => outputViewer.scene.jumpLinks.length), 1);
  await viewer.screenshot({path: `${shots}/offline-jumps.png`});
  await offline.close();
  checks.push("standalone HTML and offline Output Viewer retain only the original pair");
  assert.equal(await page.evaluate(async () => (await prepareEngineViewerOutput({mode: 'hosted-viewer'})).snapshot.engineScene.jumpLinks.length), 1);

  const loom = cableTypeSelectionFixture();
  loom.jumpNodes = [{id: "gateway-a", x: 300, y: 100}, {id: "gateway-b", x: 900, y: 300}];
  loom.jumpLinks = [{id: "loom-pair", outputJumpId: "gateway-a", inputJumpId: "gateway-b", deviceIndependent: true}];
  loom.looms = [{id: "loom", name: "LM-001", sideA: {x: 0, y: 0}, sideB: {x: 1200, y: 300}, routePoints: [{id: "anchor", x: 300, y: 100}],
    jumpRouting: {usageMode: "loom", entryJumpId: "gateway-a", exitJumpId: "gateway-b", entryAnchorId: "anchor", continuationComplete: true}}];
  const connectedLoom = structuredClone(fixture);
  connectedLoom.jumpNodes = structuredClone(loom.jumpNodes);
  connectedLoom.jumpLinks = structuredClone(loom.jumpLinks);
  connectedLoom.looms = structuredClone(loom.looms);
  connectedLoom.connections[0].to = {jumpNodeId: 'gateway-a'};
  connectedLoom.connections[1].from = {jumpNodeId: 'gateway-b'};
  const gatewayCases = [["Multi-Core", multiCoreJumpProject()], ['Connected Loom', connectedLoom]];
  // Run the known failing Loom case explicitly; never turn it into a passing assertion.
  if (process.env.AVDESIGNER_INCLUDE_KNOWN_LOOM_FAILURE === "1") gatewayCases.push(["Loom", loom]);
  for (const [kind, data] of gatewayCases) {
    await page.evaluate(data => restoreSnapshot(data), data); await page.waitForFunction(() => activeEngineBridge()?.ready);
    const before = await page.evaluate(() => ({looms: structuredClone(state.looms), multiCores: structuredClone(state.multiCores), connections: structuredClone(state.connections), links: structuredClone(state.jumpLinks)}));
    await page.evaluate(() => {const b = activeEngineBridge(); b.scene.selectMany(["gateway-a", "gateway-b"]); b.updateSelectionHud(); document.activeElement?.blur(); setStatus("Copy pending");});
    await page.keyboard.press(`${modifier}+c`); await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('system clipboard'));
    await page.keyboard.press(`${modifier}+v`); await page.waitForFunction(() => state.jumpNodes.length === 4);
    assert.ok(await page.evaluate(() => state.jumpNodes.slice(2).every(j => !j.pairId && !j.loomId && !j.multiCoreId)));
    assert.deepEqual(await page.evaluate(() => ({looms: state.looms, multiCores: state.multiCores, connections: state.connections, links: state.jumpLinks})), before);
    await page.keyboard.press(`${modifier}+z`); await page.waitForFunction(() => state.jumpNodes.length === 2);
    await page.keyboard.press(`${modifier}+Shift+z`); await page.waitForFunction(() => state.jumpNodes.length === 4);
    await page.screenshot({path: `${shots}/${kind}-copies.png`});
    checks.push(`${kind} gateways copy independently; native paste/undo/redo leaves ownership, circuits and topology unchanged`);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({checks, dialogs, errors, shots,
    knownFailure: "Loom fixture hits the null installedModule renderer error, reproduced on a4bd45c. One-ended Jump pair also hits that stack in the working tree."}, null, 2));
} finally { await browser.close(); }
