import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";

// Continue the real canvas-created Hybrid14 used by the Jump acceptance. No
// aggregate, patch lead, Loom or gateway is injected by this reporting phase.
export async function auditMultiCoreReference({ page, dir, point, read }) {
  const before = await read(), click = p => page.mouse.click(p.x, p.y);
  const tab = name => page.locator(`.mc-editor [data-tab="${name}"]`).click();
  const action = name => page.locator(`.mc-editor [data-action="${name}"]`).click();
  const field = async (path, value) => { const input = page.locator(`[data-path="${path}"]`); await input.fill(String(value)); await input.press("Tab"); };
  await click(await point("B")); await page.locator("[data-mc-edit]").click();
  for (const style of ["fanout", "stage-box", "rack-panel", "wall-plate", "inline-breakout", "custom-enclosure", "generic", "fanout"]) {
    await page.locator('[data-path="ends.B.style"]').selectOption(style);
    assert.deepEqual(await page.evaluate(() => activeEngineBridge().multiCoreEditor.session.value.ends.A), before.mc.ends.A);
  }
  await page.locator('.mc-port-row[data-port="b-41"]').click();
  await page.getByLabel("Connector X", { exact: true }).fill("80");
  await page.getByLabel("Connector X", { exact: true }).press("Tab");
  await page.screenshot({ path: `${dir}/phase8-fanout-placement.png` });
  await tab("Trunk"); await field("trunk.length", 100);
  await tab("General"); await field("name", "MC-001"); await field("notes", "FOH to stage; backup channel reserved for camera 2");
  await tab("Channels");
  assert.equal(await page.locator('tr[data-circuit-id="c-b7"] [data-channel-status]').innerText(), "Reserved");
  await page.locator('[data-path="circuits.2.administrativeState"]').selectOption("spare");
  assert.equal(await page.locator('tr[data-circuit-id="c-c3"] [data-channel-status]').innerText(), "Spare");
  const edited = await page.evaluate(() => structuredClone(activeEngineBridge().multiCoreEditor.session.value));
  await action("save"); await page.locator(".mc-editor").waitFor({ state: "detached" });
  assert.deepEqual((await read()).mc, edited);
  await page.keyboard.press("Meta+z"); assert.deepEqual((await read()).mc, before.mc);
  await page.keyboard.press("Meta+Shift+z"); assert.deepEqual((await read()).mc, edited);
  assert.deepEqual((await read()).cables, before.cables);
  // Exercise each exit after an actually rejected Save, not just a draft helper.
  for (const exit of ["cancel", "close", "escape"]) {
    await click(await point("A")); await page.locator("[data-mc-edit]").click(); await tab("Channels");
    const snapshot = await read();
    await page.locator('[data-path="circuits.1.endBPortId"]').selectOption("b-41"); await action("save");
    assert.match(await page.locator(".mc-diagnostics").innerText(), /Not saved/);
    assert.deepEqual(await read(), snapshot);
    if (exit === "escape") await page.keyboard.press("Escape"); else await action(exit);
    assert.equal(await page.locator(".mc-editor").count(), 0); assert.deepEqual(await read(), snapshot);
  }
  const snapshot = await page.evaluate(() => JSON.stringify([projectSnapshotData({ forEngine: true }), activeEngineBridge().engineHistoryState()]));
  await page.locator("#cableScheduleButton").click(); await page.locator("#cableScheduleBody tr").first().waitFor();
  assert.equal(await page.locator("#cableScheduleBody tr").count(), 2);
  const reports = await page.evaluate(() => currentMultiCoreReports);
  assert.equal(reports.assemblies.length, 1); assert.equal(reports.channels.length, 14);
  assert.deepEqual([reports.assemblies[0].occupied, reports.assemblies[0].spare, reports.assemblies[0].reserved], [1, 12, 1]);
  for (const [title, count, file] of [["Multi-Core Assembly Register", 1, "assemblies.csv"], ["Channel Allocation Manifest", 14, "channels.csv"]]) {
    const section = page.locator("#multiCoreReports details").filter({ has: page.locator("summary", { hasText: title }) });
    await section.locator("summary").click(); assert.equal(await section.locator("tbody tr").count(), count);
    const download = page.waitForEvent("download"); await section.getByRole("button", { name: "Download CSV" }).click(); await (await download).saveAs(`${dir}/phase8-${file}`);
  }
  await page.screenshot({ path: `${dir}/phase8-channel-manifest.png` });
  for (const [selector, name] of [["#downloadCableScheduleCsv", "cables.csv"], ["#downloadCableScheduleXlsx", "reports.xlsx"]]) {
    const download = page.waitForEvent("download"); await page.locator(selector).click(); await (await download).saveAs(`${dir}/phase8-${name}`);
  }
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(`${dir}/phase8-reports.xlsx`);
  for (const [name, count] of [["Cable Schedule", 2], ["Multi-Core Assemblies", 1], ["Channel Allocation", 14]]) {
    const sheet = book.getWorksheet(name); assert.equal(sheet.rowCount, count + 1); assert(sheet.autoFilter); assert.equal(sheet.views[0].state, "frozen");
    sheet.eachRow(row => row.eachCell(cell => assert.notEqual(cell.type, ExcelJS.ValueType.Formula)));
  }
  await page.locator("#closeCableSchedule").click();
  for (const [index, direction] of [[0, "A-to-B"], [1, "B-to-A"]]) {
    await page.evaluate(index => openSignalChainForWire(state.connections[index].id), index);
    const text = await page.locator("#signalChainBody").innerText(); assert(text.includes(direction)); assert(text.includes("100 m"));
    await page.screenshot({ path: `${dir}/phase8-chain-${index}.png` }); await page.locator("#closeSignalChain").click();
  }
  assert.equal(await page.evaluate(() => JSON.stringify([projectSnapshotData({ forEngine: true }), activeEngineBridge().engineHistoryState()])), snapshot,
    "all report actions preserve canonical data and history");
  await writeFile(`${dir}/phase8-reports.json`, JSON.stringify(reports, null, 2));
  return reports;
}
