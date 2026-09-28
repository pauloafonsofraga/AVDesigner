import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
const reportSource = readFileSync(new URL("../src/engine/outputViewerReport.js", import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const allHdmi = ["cable-0", "cable-1", "cable-2"];

function harness() {
  const project = cableTypeSelectionFixture(), scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  const method = name => {
    const match = bridgeSource.match(new RegExp(`^  ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}`, "m"));
    assert.ok(match, name); return match[0];
  };
  const bridge = vm.runInNewContext(`({${method("selectWiresBySourceIds")},${method("resolveWire")}})`);
  const c = vm.createContext({ state: { ...project, selected: null }, ledConnectorSelection: ["old"],
    cableTypes: { hdmi: { label: "HDMI" }, sdi: { label: "SDI" } },
    activeEngineBridge: () => bridge, renderInspector() {}, setStatus(message) { c.status = message; } });
  for (const name of ["select", "selectedWireIds", "selectWiresFast", "selectWiresOfSameType", "selectReportCableGroup", "wireContextSelectionIds"]) {
    const match = html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"));
    assert.ok(match, name); vm.runInContext(match[0], c);
  }
  Object.assign(bridge, { scene, draws: 0, scheduleRender() { this.draws++; }, updateSelectionHud() {
    const items = [...scene.selectedWireIds].map(id => ({ type: "wire", id: scene.getWire(id).sourceId || id }));
    c.state.selected = items.length === 1 ? items[0] : { type: "multi", items };
  } });
  return { c, bridge, scene };
}

test("report cable selection includes every length and leaves project geometry untouched", () => {
  const { c, scene, bridge } = harness();
  const before = JSON.stringify(c.state.connections), devices = JSON.stringify(scene.devices), wires = JSON.stringify(scene.wires);
  for (const length of ["1", "5", "", "99"]) {
    scene.selectOnly("source");
    c.selectReportCableGroup("hdmi", length);
    assert.deepEqual([...scene.selectedWireIds], allHdmi);
    assert.deepEqual(plain(c.selectedWireIds()), allHdmi);
    assert.equal(scene.selectedIds.size, 0);
    assert.equal(c.ledConnectorSelection.length, 0);
    assert.equal(c.status, "3 HDMI cables selected from report.");
  }
  assert.equal(bridge.draws, 4, "selection schedules a canvas draw");
  assert.equal(JSON.stringify(c.state.connections), before);
  assert.equal(JSON.stringify(scene.devices), devices);
  assert.equal(JSON.stringify(scene.wires), wires);
});

test("same-type menu selects the exact cable type across lengths, replacing prior selection", () => {
  const { c, scene } = harness();
  c.selectReportCableGroup("sdi");
  assert.deepEqual(plain(c.state.selected), { type: "wire", id: "cable-3" });
  c.selectWiresOfSameType("cable-1");
  assert.deepEqual([...scene.selectedWireIds], allHdmi);
  assert.equal(c.status, "3 HDMI cables selected.");
  c.selectWiresOfSameType("cable-3");
  assert.deepEqual([...scene.selectedWireIds], ["cable-3"]);
  assert.equal(c.status, "1 SDI cable selected.");
});

test("stale report/menu IDs do not clear an existing valid selection", () => {
  const { c, scene, bridge } = harness();
  c.selectReportCableGroup("hdmi");
  c.selectReportCableGroup("unknown"); c.selectWiresOfSameType("removed");
  assert.deepEqual([...scene.selectedWireIds], allHdmi);
  assert.equal(bridge.draws, 1);
});

test("Engine wire selection resolves source IDs, deduplicates, and clears other selection kinds", () => {
  const { scene, bridge } = harness();
  scene.getWire("cable-0").sourceId = "saved-connection";
  scene.getWire("cable-3").selectable = false;
  scene.selectedIds.add("source"); scene.selectedRackIds.add("rack");
  scene.selectedConnectorKeys.add("source:port-0"); scene.selectedRoutePointKeys.add("cable-0:0");
  scene.selectedJumpLinkId = "jump-link"; scene.primarySelectedJumpId = "jump";
  bridge.selectWiresBySourceIds(["saved-connection", "cable-1", "saved-connection", "missing", "cable-3"]);
  assert.deepEqual([...scene.selectedWireIds], ["cable-0", "cable-1"]);
  for (const key of ["selectedIds", "selectedRackIds", "selectedConnectorKeys", "selectedRoutePointKeys"]) assert.equal(scene[key].size, 0);
  assert.equal(scene.selectedJumpLinkId, ""); assert.equal(scene.primarySelectedJumpId, "");
  assert.equal(bridge.draws, 1);
});

test("wire context selection retains an existing group or switches to the clicked cable", () => {
  const { c, scene } = harness();
  c.selectWiresOfSameType("cable-0");
  assert.deepEqual(plain(c.wireContextSelectionIds("cable-1")), allHdmi);
  assert.deepEqual(plain(c.wireContextSelectionIds("cable-3")), ["cable-3"]);
  assert.deepEqual([...scene.selectedWireIds], ["cable-3"]);
});

class Element {
  children = []; listeners = {}; dataset = {}; textContent = "";
  constructor(tag) { this.tag = tag; }
  append(...children) { this.children.push(...children); }
  prepend(child) { this.children.unshift(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  addEventListener(type, callback) { this.listeners[type] = callback; }
  close() { this.closed = true; }
}

test("real output report buttons select a whole cable type, not only the clicked length row", () => {
  const toolbar = new Element("toolbar"), host = new Element("host");
  host.querySelector = () => toolbar;
  const viewer = { host, abort: { signal: {} }, select(selection) { this.selection = selection; } };
  const cableRows = ["1", "5", ""].map(length => ({ type: "HDMI", typeId: "hdmi", length, quantity: 1 }));
  cableRows.push({ type: "SDI", typeId: "sdi", length: "1", quantity: 1 });
  const groups = cableRows.map((r, i) => ({ typeId: r.typeId, length: r.length, wireIds: [`cable-${i}`] }));
  groups.push({ typeId: "hdmi", length: "other", wireIds: ["cable-1"] });
  const before = JSON.stringify({ cableRows, groups });
  const c = vm.createContext({ document: { createElement: tag => new Element(tag) } });
  vm.runInContext(reportSource.replace("export function", "function"), c);
  c.installOutputReport(viewer, { cableRows }, groups);
  const walk = node => [node, ...node.children.flatMap(walk)];
  const buttons = walk(host).filter(node => node.tag === "button" && node.textContent === "HDMI");
  assert.equal(buttons.length, 3);
  for (const button of buttons) {
    button.listeners.click();
    assert.deepEqual(plain(viewer.selection), { type: "multi-wire", ids: allHdmi });
  }
  walk(host).find(node => node.tag === "button" && node.textContent === "SDI").listeners.click();
  assert.deepEqual(plain(viewer.selection), { type: "wire", id: "cable-3" });
  assert.equal(host.children[0].closed, true);
  assert.equal(JSON.stringify({ cableRows, groups }), before);
});
