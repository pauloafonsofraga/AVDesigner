import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/avdesigner-switch-ports";
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const checks = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", d => { errors.push(d.message()); return d.dismiss(); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.locator("#addLibraryDevice").click();
  await page.locator("#deviceEditorModal").waitFor({ state: "visible" });
  await page.locator("label:has(#editorEthernetSwitch)").click();
  const read = async () => {
    await page.waitForFunction(() => !editorPlacementMotionState?.entries?.size);
    return page.evaluate(() => {
      const t = currentEditorTemplate(), l = resolveEditorModularLayout(t, { useDragPreview: false });
      return { template: structuredClone(t), lanes: Object.fromEntries(l.items.map(i => [i.id, i.lane])),
        endLane: l.endLane, items: l.items.map(({ id, sideMask, span }) => ({ id, sideMask, span })), selected: [...editorSelectedNodeIds] };
    });
  };
  const assertPorts = snapshot => {
    for (const p of snapshot.template.connectors) {
      assert.equal(p.schemaVersion, 2); assert.equal(p.displaySide, "both");
      assert.equal(p.signalDirection, "bidirectional"); assert.equal(p.direction, "io");
      assert.ok(!p.pairedConnectorId && !p.networkGroupId && !p.ethernetGroupId);
      assert.deepEqual(p.anchors.map(a => [a.side, a.x, a.y]), [["left", 0, p.y], ["right", snapshot.template.width, p.y]]);
      assert.equal(snapshot.items.find(i => i.id === `connector:${p.id}`).sideMask, "both");
    }
  };
  await page.locator("#editorSwitchPortCount").selectOption("8");
  await page.locator("#addEthernetSwitchPorts").click();
  const first = await read();
  assert.equal(first.template.connectors.length, 8);
  assert.equal(first.endLane, 8); assertPorts(first);
  assert.deepEqual(first.lanes, Object.fromEntries(first.template.connectors.map((p, i) => [`connector:${p.id}`, i])));
  checks.push("new-device UI creates eight logical V2 both-side, bidirectional ports in eight lanes");
  await page.locator('[data-editor-tab="connectors"]').click();
  const circle = (id, side) => page.locator(`#deviceEditorPreview [data-editor-node-id="${id}"] circle.editor-engine-hit`)[side === "left" ? "first" : "last"]();
  const port = first.template.connectors.at(-1);
  for (const side of ["left", "right"]) {
    await circle(port.id, side).click();
    assert.equal(await page.locator('[data-connector-display-side="both"]').isChecked(), true);
    assert.equal(await page.locator('[data-connector-signal-direction="bidirectional"]').isChecked(), true);
    assert.deepEqual((await read()).selected, [port.id]);
  }
  await page.screenshot({ path: `${directory}/both-port-inspector.png` });
  checks.push("clicking either anchor selects the same connector and shows Both / Bi-dir in the inspector");
  for (const side of ["right", "left"]) {
    await page.locator("#editorZoomReset").click();
    const box = await circle(port.id, side).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.waitForFunction(id => editorNodeDrag?.connectorId === id, port.id);
    const destination = await page.evaluate(() => {
      const d = editorNodeDrag;
      if (!d.persistentAuthoringDrag) throw new Error("generated switch port bypassed persistent placement");
      return d.pointerStartClientY - d.originalLane * Math.max(12, d.projectedLanePx);
    });
    await page.mouse.move(box.x + box.width / 2, destination, { steps: 8 }); await page.mouse.up();
    const moved = await read(); assertPorts(moved);
    assert.deepEqual(moved.lanes, Object.fromEntries([port, ...first.template.connectors.slice(0, -1)].map((p, i) => [`connector:${p.id}`, i])));
    assert.equal(moved.endLane, 8);
    await page.evaluate(() => undoEditorConnectorMetadata());
    assert.deepEqual((await read()).lanes, first.lanes);
    await page.evaluate(() => undoEditorConnectorMetadata(true));
    assert.deepEqual((await read()).lanes, moved.lanes);
    await page.evaluate(() => undoEditorConnectorMetadata());
  }
  checks.push("native dragging from either anchor moves one both-side interval; collision chain and undo/redo stay stable");
  await page.locator('[data-editor-tab="device"]').click();
  for (const profile of ["1g-rj45", "10g-rj45", "sfp", "sfp-plus", "qsfp"]) {
    const before = await read();
    await page.locator("#editorSwitchPortCount").selectOption("2");
    await page.locator("#editorSwitchPortType").selectOption(profile);
    await page.locator("#addEthernetSwitchPorts").click();
    const after = await read(); assertPorts(after);
    const added = after.template.connectors.filter(p => !before.template.connectors.some(old => old.id === p.id));
    assert.equal(added.length, 2);
    assert.deepEqual(after.lanes, { ...before.lanes, ...Object.fromEntries(added.map((p, i) => [`connector:${p.id}`, before.endLane + i])) });
    assert.equal(after.endLane, before.endLane + 2);
    assert.deepEqual(after.template.connectors.slice(0, before.template.connectors.length), before.template.connectors);
    checks.push(`${profile}: append two ports without moving or changing existing ports`);
  }
  const final = await read();
  const normalized = await page.evaluate(async template => {
    const { normalizeAvDesignerProject } = await import(runtimeFileUrl("./src/engine/projectAdapter.js"));
    const { SceneGraph } = await import(runtimeFileUrl("./src/engine/sceneGraph.js"));
    const scene = new SceneGraph();
    scene.setData(normalizeAvDesignerProject({ devices: [{ instanceId: "switch", templateId: template.id,
      templateOverride: JSON.parse(JSON.stringify(template)), x: 0, y: 0 }], connections: [] }));
    const d = scene.getDevice("switch");
    return d.connectors.map(c => ({ id: c.id, side: c.displaySide, direction: c.direction,
      anchors: c.anchors.map(a => ({ side: a.side, ...scene.connectorAnchorWorldPoint(d, c, a.id) })) }));
  }, final.template);
  assert.equal(normalized.length, final.template.connectors.length);
  normalized.forEach((p, i) => {
    assert.equal(p.id, final.template.connectors[i].id);
    assert.equal(p.direction, "io");
    assert.equal(p.anchors.length, 2);
    assert.deepEqual(p.anchors.map(a => a.y), [final.template.connectors[i].y, final.template.connectors[i].y]);
  });
  checks.push("JSON round-trip into the live Engine retains one connector ID and two anchors per port");
  await page.locator("#editorDeviceName").fill("Ethernet Switch Regression");
  await page.locator("#applyDeviceEditor").click();
  await page.waitForFunction(() => deviceEditorModal.classList.contains("hidden"));
  const savedId = await page.evaluate(() => deviceLibrary.find(t => t.name === "Ethernet Switch Regression")?.id);
  assert.ok(savedId, "Apply saves the new switch in Project Devices");
  await page.evaluate(id => openDeviceEditorForProjectTemplate(id), savedId);
  const reopened = await read(); assertPorts(reopened);
  assert.deepEqual(reopened.lanes, final.lanes);
  assert.deepEqual(reopened.template.connectors.map(p => p.id), final.template.connectors.map(p => p.id));
  checks.push("Apply and reopen preserve both-side placement, bidirectional flags, connector IDs and lanes");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, directory }, null, 2));
} finally { await browser.close(); }
