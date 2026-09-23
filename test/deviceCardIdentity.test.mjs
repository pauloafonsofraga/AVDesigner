import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const fixture = Object.freeze({ id: "barco-e2-gen2", name: "E2 Gen2", brand: "Barco", category: "Switchers", model: "E2 Gen2" });

class Element {
  children = [];
  dataset = {};
  attributes = {};
  listeners = {};
  classList = { toggle() {} };
  set innerHTML(value) { this.markup = value; this.children = []; }
  get innerHTML() { return this.markup || ""; }
  appendChild(child) { this.children.push(child); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) {
    if (selector !== ".library-favorite") return null;
    return this.favorite ||= new Element();
  }
}

function harness(devices = [fixture], filter = "", entries = devices.map(device => ({ kind: "device", device }))) {
  const context = vm.createContext({
    Element, structuredClone,
    document: { createElement: () => new Element(), body: new Element() },
    deviceList: new Element(), customDeviceList: new Element(),
    searchInput: { value: filter }, customDeviceSearch: { value: filter },
    selectedDeviceType: "", RACK_TYPE_PREFIX: "rack:",
    renderDeviceTypeTree() {}, deviceLibraryEntries: () => entries,
    deviceMatchesSelectedType: () => true,
    deviceThumbnailMarkup: () => '<img class="device-thumb" src="unchanged.png">',
    editorDeviceThumbHtml: () => '<img src="unchanged.png">',
    state: { devices: devices.map((device, i) => ({ instanceId: `instance-${i}`, templateId: device.id, name: `FOH ${device.name}`, brand: "Not the template brand" })) },
    templateForInstance: instance => devices.find(d => d.id === instance.templateId),
    templateById: id => devices.find(d => d.id === id),
    projectCustomDeviceTemplates: () => [], recordCustomIdentity() {}, activeEngineBridge: () => null,
    selectedRackCategory: () => "", userRacks: () => [{ id: "rack-1", name: "Video rack", category: "Control" }],
    normalizeRackCategory: value => value, rackName: rack => rack.name,
    rackDefinitionDevices: () => [1, 2], rackDevices: () => [], pluralCount: (n, label) => `${n} ${label}s`,
    rackBuilderModal: { classList: { contains: () => true } }, clearLibraryDragSession() {}, logLibraryDragStep() {},
    moveLibraryGhost() {}, installLibraryDragListeners() {}, libraryDrag: null
  });
  for (const name of ["escapeHtml", "escapeAttr", "deviceBrandLabel", "renderDeviceLibrary", "renderRackLibraryList",
    "projectDeviceListInstances", "renderProjectCustomDevices", "rackSourceDeviceItemHtml", "startLibraryDrag"]) {
    const source = html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"));
    assert.ok(source, `Production function ${name}`);
    vm.runInContext(source[0], context);
  }
  return context;
}

function lines(item, titleTag = "h3", subtitleTag = "p") {
  return [titleTag, subtitleTag].map(tag => item.innerHTML.match(new RegExp(`<${tag}>(.*?)</${tag}>`))?.[1]);
}

test("library cards show device name and brand/category without changing controls or model", () => {
  const c = harness();
  c.renderDeviceLibrary();
  const row = c.deviceList.children[0];
  assert.deepEqual(lines(row), ["E2 Gen2", "Barco / Switchers"]);
  assert.doesNotMatch(row.innerHTML, /Switchers \/ E2 Gen2/);
  assert.match(row.innerHTML, /<img class="device-thumb" src="unchanged.png">/);
  assert.match(row.innerHTML, /data-favorite-template="barco-e2-gen2"/);
  assert.match(row.innerHTML, /aria-label="Add to favorites"/);
  assert.equal(row.dataset.templateId, fixture.id);
  assert.equal(row.draggable, false);
  assert.deepEqual(Object.keys(row.listeners), ["dragstart", "pointerdown", "contextmenu"]);
  assert.equal(typeof row.favorite.listeners.click, "function");
  assert.equal(fixture.model, "E2 Gen2");
});

for (const [name, fields, expected] of [
  ["manufacturer alias", { manufacturer: " Barco " }, "Barco / Switchers"],
  ["vendor alias", { vendor: "Barco" }, "Barco / Switchers"],
  ["make alias", { make: "Barco" }, "Barco / Switchers"],
  ["blank brand falls through", { brand: "  ", manufacturer: "Barco" }, "Barco / Switchers"],
  ["brand takes precedence", { brand: "Barco", vendor: "Other" }, "Barco / Switchers"],
  ["missing brand", {}, "No brand / Switchers"],
  ["missing category", { brand: "Barco", category: undefined }, "Barco / Custom"],
  ["missing both", { category: "" }, "No brand / Custom"]
]) {
  test(`${name} in library, Project Devices, Rack Builder and drag preview`, () => {
    const device = Object.freeze({ ...fixture, brand: undefined, ...fields });
    const c = harness([device]);
    c.renderDeviceLibrary();
    c.renderProjectCustomDevices();
    assert.equal(lines(c.deviceList.children[0])[1], expected);
    assert.deepEqual(lines(c.customDeviceList.children[0]), ["FOH E2 Gen2", expected]);
    assert.deepEqual(lines({ innerHTML: c.rackSourceDeviceItemHtml({ kind: "library", id: device.id, template: device }) }, "strong", "span"), ["E2 Gen2", expected]);
    c.startLibraryDrag({ button: 0, preventDefault() {}, stopPropagation() {}, currentTarget: new Element() }, device.id);
    assert.deepEqual(lines(c.libraryDrag.ghost, "strong", "span"), ["E2 Gen2", expected]);
  });
}

test("Project Devices use instance identity and template brand/category without mutating either", () => {
  const c = harness();
  const before = JSON.stringify({ fixture, devices: c.state.devices });
  c.renderProjectCustomDevices();
  const row = c.customDeviceList.children[0];
  assert.deepEqual(lines(row), ["FOH E2 Gen2", "Barco / Switchers"]);
  assert.equal(row.dataset.instanceId, "instance-0");
  assert.equal(row.attributes["aria-label"], "Select FOH E2 Gen2 on canvas");
  assert.match(row.innerHTML, /src="unchanged.png"/);
  assert.doesNotMatch(row.innerHTML, /Switchers \/ E2 Gen2/);
  assert.equal(JSON.stringify({ fixture, devices: c.state.devices }), before);
});

test("a technical model distinct from the name remains searchable in both lists", () => {
  const c = harness([{ ...fixture, model: "R9004698" }], "r9004698");
  c.renderDeviceLibrary();
  c.renderProjectCustomDevices();
  assert.equal(c.deviceList.children.length, 1);
  assert.equal(c.customDeviceList.children.length, 1);
  assert.equal(lines(c.deviceList.children[0])[1], "Barco / Switchers");
  c.searchInput.value = c.customDeviceSearch.value = "no match";
  c.renderDeviceLibrary();
  c.renderProjectCustomDevices();
  assert.equal(c.deviceList.children.length, 0);
  assert.equal(c.customDeviceList.children.length, 0);
});

test("names, brand aliases and categories stay HTML escaped in every device card", () => {
  const device = { ...fixture, brand: undefined, name: '<E2 "Gen2">', vendor: 'B&<script>"\'', category: '<img onerror="bad">' };
  const c = harness([device]);
  c.renderDeviceLibrary(); c.renderProjectCustomDevices();
  c.startLibraryDrag({ button: 0, preventDefault() {}, stopPropagation() {}, currentTarget: new Element() }, device.id);
  const expected = "B&amp;&lt;script&gt;&quot;&#039; / &lt;img onerror=&quot;bad&quot;&gt;";
  assert.deepEqual(lines(c.deviceList.children[0]), ["&lt;E2 &quot;Gen2&quot;&gt;", expected]);
  assert.deepEqual(lines(c.customDeviceList.children[0]), ["FOH &lt;E2 &quot;Gen2&quot;&gt;", expected]);
  assert.equal(lines(c.libraryDrag.ghost, "strong", "span")[1], expected);
  assert.equal(lines({ innerHTML: c.rackSourceDeviceItemHtml({ kind: "library", id: device.id, template: device }) }, "strong", "span")[1], expected);
});

test("pair cards retain their pair identity, favorite, drag payload and searchable second model", () => {
  const second = { ...fixture, id: "paired", name: "S3", model: "PairOnlyModel" };
  const first = { ...fixture, favorite: true };
  const c = harness([first, second], "paironlymodel", [{ kind: "pair", first, second }]);
  c.renderDeviceLibrary();
  const row = c.deviceList.children[0];
  assert.deepEqual(lines(row), ["E2 Gen2 + S3", "Pair / Switchers"]);
  assert.equal(row.dataset.pairTemplateId, second.id);
  assert.match(row.innerHTML, /class="library-favorite active"/);
  c.startLibraryDrag({ button: 0, preventDefault() {}, stopPropagation() {}, currentTarget: row }, first.id, { pairTemplateId: second.id, pairName: "E2 Gen2 + S3" });
  assert.deepEqual(lines(c.libraryDrag.ghost, "strong", "span"), ["E2 Gen2 + S3", "Device pair / E2 Gen2 + S3"]);
  assert.equal(c.libraryDrag.pairTemplateId, second.id);
});

test("special Rack cards retain category/device count and rack identity", () => {
  const c = harness();
  c.selectedDeviceType = "rack:all";
  c.renderDeviceLibrary();
  assert.deepEqual(lines(c.deviceList.children[0]), ["Video rack", "Control / 2 devices"]);
  assert.equal(c.deviceList.children[0].dataset.rackId, "rack-1");
  assert.equal(c.deviceList.children[0].className, "rack-library-item");
});
