import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8924";
assert.equal(new URL(base).hostname, "127.0.0.1");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  await page.goto(base); await page.evaluate(() => wireNexusReady);
  const device = (id, type, direction, x, y) => {
    const name = id, width = 230, height = 220;
    return { instanceId: id, name, x, y, templateOverride: { id, name, width, height, connectors: [{
      id: "port", type, direction, x: direction === "input" ? 0 : width, y: 166,
      ...(type === "fiber-mpo" ? { mpoPhysical: { schemaVersion: 1, fiberCategory: "om4" } } : {}),
      ...(type === "fiber-lc" ? { fiberMode: "om4", fiberCapability: { arrangement: "duplex" } } : {})
    }] } };
  };
  const load = async (name, buffer) => {
    await page.locator("#fileInput").setInputFiles({ name, mimeType: "application/json", buffer });
    await page.waitForFunction(name => projectFileName === name && activeEngineBridge()?.scene.getConnector("source", "port"), name);
    await page.locator("#zoomFit").click();
  };
  const fixture = { devices: [
    device("source", "fiber-mpo", "output", 0, 80), device("lc-dest-a", "fiber-lc", "input", 920, 30),
    device("lc-dest-b", "fiber-lc", "input", 920, 390), device("generic-sfp", "sfp-cage", "output", 0, 400),
    device("qsfp-host", "qsfp-cage", "input", 420, 500)
  ], connections: [] };
  await load("harness.avd", Buffer.from(JSON.stringify(fixture)));
  const point = (id, cid = "port") => page.evaluate(([id, cid]) => {
    const b = activeEngineBridge(), d = b.scene.getDevice(id), c = b.scene.getConnector(id, cid);
    const p = b.worldToScreenPoint(b.scene.connectorWorldPoint(d, c)), rect = b.canvas.getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }, [id, cid]);
  const inspect = async (id, cid = "port") => {
    const p = await point(id, cid);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(key => activeEngineBridge().scene.selectedConnectorKeys.has(key), id + ":" + cid);
  };
  const module = id => page.evaluate(id => activeEngineBridge().scene.getConnector(id, "port").installedModuleType, id);
  await inspect("generic-sfp");
  const panel = page.locator("[data-transceiver-config]");
  assert.equal(await panel.getByRole("button", { name: "Apply Transceiver" }).count(), 0);
  for (const iface of ["sc", "st"]) {
    await panel.getByLabel("Installed interface").selectOption(iface);
    assert.equal(await module("generic-sfp"), iface + "-singlemode");
  }
  await page.locator("#undoAction").click(); assert.equal(await module("generic-sfp"), "sc-singlemode");
  await page.locator("#redoAction").click(); assert.equal(await module("generic-sfp"), "st-singlemode");
  await inspect("source");
  const fixed = page.locator("[data-fixed-mpo]");
  const attach = page.getByRole("button", { name: "Attach MPO Breakout" });
  await page.locator("#inspectorBody").evaluate(element => { element.scrollTop = 0; });
  await attach.waitFor({state: "visible"});
  const top = await attach.boundingBox(), area = await page.locator("#inspectorBody").boundingBox();
  assert(top.y + top.height <= area.y + area.height, "Attach is visible without scrolling");
  const fixedMpoFormat = fixed.getByLabel("MPO Format");
  assert(await fixedMpoFormat.isVisible(), "Format is shown while advanced properties are collapsed");
  await fixedMpoFormat.selectOption("mpo-12");
  await fixed.getByRole("button", { name: "Apply MPO Properties" }).click();
  await fixed.getByText("MPO physical properties", { exact: true }).click();
  assert.equal(await fixed.getByLabel("MPO termination").count(), 0);
  assert.equal(await fixed.getByLabel(/numbering reference/i).count(), 0);
  await page.getByLabel("Harness fibre grade").selectOption("om4");
  await page.getByRole("button", { name: "Attach MPO Breakout" }).click();
  const lengths = page.getByLabel("Harness length");
  await lengths.waitFor();
  const saved = () => page.evaluate(() => {
    const b = activeEngineBridge(), root = b.mutations.root;
    return { harness: root.devices.find(d => d.templateOverride?.mpoHarness), wires: root.connections };
  });
  const created = await saved(), id = created.harness.instanceId;
  assert.equal(created.wires.length, 1);
  assert.equal(created.wires[0].to.connectorId, "mpo-trunk");
  await inspect("source");
  assert(await attach.isDisabled());
  assert(await page.getByText("Disconnect the existing cable or breakout before attaching a harness.").isVisible());
  await page.locator("#undoAction").click(); assert.equal((await saved()).harness, undefined);
  await page.locator("#redoAction").click(); assert.equal((await saved()).harness.instanceId, id);
  await lengths.fill("5 m"); await lengths.blur();
  await page.locator("#zoomFit").click();
  for (const [branch, dest, count] of [["lc-4", "lc-dest-b", 2], ["lc-2", "lc-dest-a", 3]]) {
    const from = await point(id, branch), to = await point(dest);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 16 }); await page.mouse.up();
    await page.waitForFunction(n => activeEngineBridge().mutations.root.connections.length === n, count);
  }
  const complete = await saved();
  const schedule = () => page.evaluate(async () => {
    const { buildCableSchedule } = await import("./src/engine/cableSchedule.js");
    return buildCableSchedule(activeEngineBridge().mutations.root, { assignNumbers: "readOnly" });
  });
  const rows = await schedule();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, "5 m");
  assert.match(rows[0].notes, /LC 4: lc-dest-b/);
  assert.match(rows[0].notes, /LC 2: lc-dest-a/);
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  const pending = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const stream = await (await pending).createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  await load("harness-reopened.avd", Buffer.concat(chunks));
  const reopened = await saved();
  assert.equal(reopened.harness.instanceId, id);
  assert.deepEqual(reopened.harness.templateOverride.mpoHarness, complete.harness.templateOverride.mpoHarness);
  assert.deepEqual(reopened.wires.map(w => [w.id, w.from, w.to]), complete.wires.map(w => [w.id, w.from, w.to]));
  assert.equal((await schedule())[0].length, "5 m");
  await inspect("qsfp-host");
  await panel.getByLabel("Installed interface").selectOption("mpo");
  await panel.getByLabel("Fibre category", { exact: true }).selectOption("multimode");
  assert(await panel.getByLabel("MPO Format").isVisible());
  await attach.click();
  const qsfpAttach = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const harnesses = bridge.mutations.root.devices.filter(d => d.templateOverride?.mpoHarness);
    const device = bridge.scene.getDevice(harnesses.at(-1)?.instanceId);
    return { count: harnesses.length, rotation: device?.rotation,
      ports: device?.connectors.map(port => [port.id, port.side]),
      error: bridge.errorPanel?.textContent };
  });
  assert.equal(qsfpAttach.count, 2, qsfpAttach.error);
  assert.equal(qsfpAttach.rotation, 0, "left-facing MPO ports mirror the layout without turning the label");
  assert.deepEqual(qsfpAttach.ports, [["mpo-trunk", "right"], ...[1, 2, 3, 4].map(n => ["lc-" + n, "left"])]);
  await page.locator("#undoAction").click();
  await inspect("qsfp-host");
  await page.getByLabel("Harness", { exact: true }).selectOption("sc-simplex");
  await page.getByRole("button", { name: "Attach MPO Breakout" }).click();
  const simplex = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const raw = bridge.mutations.root.devices.filter(d => d.templateOverride?.mpoHarness).at(-1);
    const projected = bridge.scene.getDevice(raw.instanceId);
    return { raw: raw.templateOverride.mpoHarness, mapped: projected.visual.adapterMapping.branchCount,
      ports: projected.connectors.slice(1).map(p => [p.type, p.fiberCapability?.arrangement]) };
  });
  assert.deepEqual(simplex.raw.branches.flatMap(branch => branch.mpoPositions), [1, 2, 3, 4, 9, 10, 11, 12]);
  assert.equal(simplex.mapped, 8);
  assert.deepEqual(simplex.ports, Array.from({length:8}, () => ["fiber-sc", "simplex"]));
  assert.equal((await schedule()).length, 2, "each passive harness is one schedule item");
  if (process.env.AVDESIGNER_MPO_SCREENSHOT) {
    await page.locator("#zoomFit").click();
    await page.screenshot({ path: process.env.AVDESIGNER_MPO_SCREENSHOT });
  }
  assert.deepEqual(errors, []);
  console.log("Chrome passed: SC/ST auto-apply, slim MPO fields, standalone and QSFP attachment, independent LC branches, one schedule row, undo/redo and AVD reopen.");
} finally {
  await browser.close();
}
