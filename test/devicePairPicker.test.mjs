import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function harness(query = "") {
  const devices = [
    { id: "tx", name: "M1-DP&HDMI-Pro TX", brand: "Beetek", category: "Extenders" },
    { id: "rx", name: "M1-DP&HDMI-Pro RX", brand: "Beetek", category: "Extenders", model: "M1-TECH" },
    { id: "other", name: "Receiver", manufacturer: "Vendor Alias", category: "Converters", model: "RX900" },
    { id: "plain", name: "Receiver" }
  ];
  const element = () => ({ value: "", dataset: {}, innerHTML: "", textContent: "",
    classList: { hidden: false, toggle(_class, value) { this.hidden = value; } } });
  const parent = element();
  const c = vm.createContext({ editorMode: "library", editorDraft: devices, libraryDeviceTemplates: () => devices, currentEditorTemplate: () => devices[0],
    editorPairSearch: { ...element(), value: query, closest: () => parent },
    editorPairTemplate: { value: "rx" }, editorPartOfPair: { checked: true },
    editorPairList: element(), editorPairEmpty: element(), editorPairCurrent: element(), editorPairCurrentName: element() });
  for (const name of ["escapeHtml", "escapeAttr", "deviceBrandLabel", "pairTemplateEntries", "renderPairTemplateList", "renderPairTemplatePicker"]) {
    const match = html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"));
    assert.ok(match, name); vm.runInContext(match[0], c);
  }
  return { c, devices, parent };
}

test("pair list searches names, normalized brands, category, model and multiple terms without including self", () => {
  const { c, devices } = harness();
  const ids = query => Array.from(c.pairTemplateEntries(devices[0], query), d => d.id);
  assert.deepEqual(ids(""), ["rx", "other", "plain"]);
  assert.deepEqual(ids(" Beetek  RX "), ["rx"]);
  assert.deepEqual(ids("M1-TECH"), ["rx"]);
  assert.deepEqual(ids("vendor alias"), ["other"]);
  assert.deepEqual(ids("CONVERTERS RX900"), ["other"]);
  assert.deepEqual(ids("TX"), []);
  assert.deepEqual(ids("unmatched"), []);
});

test("rendered pair rows retain stable IDs, two-line identity and current selection", () => {
  const { c } = harness(); c.renderPairTemplateList();
  assert.match(c.editorPairList.innerHTML, /value="rx" checked/);
  assert.match(c.editorPairList.innerHTML, /<strong>M1-DP&amp;HDMI-Pro RX<\/strong><small>Beetek \/ Extenders<\/small>/);
  assert.match(c.editorPairList.innerHTML, /Vendor Alias \/ Converters/);
  assert.match(c.editorPairList.innerHTML, /No brand \/ Custom/);
  assert.doesNotMatch(c.editorPairList.innerHTML, /value="tx"/);
  assert.equal(c.editorPairEmpty.classList.hidden, true);
});

test("filtering never changes pairing; selected partner remains visible with zero matches", () => {
  const { c, devices } = harness(); devices[0].pairedTemplateId = "rx";
  c.renderPairTemplatePicker(devices[0]);
  const before = JSON.stringify(devices);
  c.editorPairSearch.value = "missing"; c.renderPairTemplateList();
  assert.equal(c.editorPairTemplate.value, "rx");
  assert.equal(c.editorPairCurrentName.textContent, "M1-DP&HDMI-Pro RX");
  assert.equal(c.editorPairCurrent.classList.hidden, false);
  assert.equal(c.editorPairEmpty.classList.hidden, false);
  assert.equal(c.editorPairList.innerHTML, "");
  assert.equal(JSON.stringify(devices), before);
  c.renderPairTemplatePicker(devices[0]); assert.equal(c.editorPairSearch.value, "missing");
  c.renderPairTemplatePicker(devices[1]); assert.equal(c.editorPairSearch.value, "");
});

test("picker disables/hides when pairing is off and rejects missing/self partners", () => {
  const { c, devices, parent } = harness(); c.editorPartOfPair.checked = false;
  for (const pairedTemplateId of ["gone", "tx"]) {
    devices[0].pairedTemplateId = pairedTemplateId; c.renderPairTemplatePicker(devices[0]);
    assert.equal(c.editorPairTemplate.value, ""); assert.equal(devices[0].pairedTemplateId, "");
    assert.equal(c.editorPairSearch.disabled, true); assert.equal(c.editorPairList.disabled, true);
    assert.equal(parent.classList.hidden, true);
  }
});

test("all pair row values are escaped; duplicate names are distinguished by IDs", () => {
  const { c, devices } = harness();
  devices[1] = { id: 'rx"><img>', name: '<script>"&', vendor: "<vendor>", category: 'A&B' };
  c.editorPairTemplate.value = devices[1].id; c.renderPairTemplateList();
  assert.match(c.editorPairList.innerHTML, /value="rx&quot;&gt;&lt;img&gt;" checked/);
  assert.match(c.editorPairList.innerHTML, /&lt;script&gt;&quot;&amp;/);
  assert.match(c.editorPairList.innerHTML, /&lt;vendor&gt; \/ A&amp;B/);
  assert.doesNotMatch(c.editorPairList.innerHTML, /<script>|<img>/);
  assert.match(c.editorPairList.innerHTML, /value="other"/);
  assert.match(c.editorPairList.innerHTML, /value="plain"/);
});

test("single-device drafts can pair with library devices; draft edits win without duplicates or library mutations", () => {
  const { c, devices } = harness();
  const baseline = JSON.stringify(devices);
  const draft = { id: "new", name: "New Device", pairedTemplateId: "rx" };
  c.editorMode = "master-create";
  c.editorDraft = [draft];
  c.renderPairTemplatePicker(draft);
  assert.equal(c.editorPairTemplate.value, "rx");
  assert.match(c.editorPairList.innerHTML, /value="rx" checked/);
  c.editorDraft.push({ ...devices[1], name: "Edited Receiver" });
  const entries = Array.from(c.pairTemplateEntries(draft));
  assert.equal(entries.filter(d => d.id === "rx").length, 1);
  assert.equal(entries.find(d => d.id === "rx").name, "Edited Receiver");
  assert.equal(JSON.stringify(devices), baseline);
});

test("library editing does not resurrect partners deleted from the draft", () => {
  const { c, devices } = harness();
  devices[0].pairedTemplateId = "rx";
  c.editorDraft = devices.filter(d => d.id !== "rx");
  c.renderPairTemplatePicker(devices[0]);
  assert.equal(devices[0].pairedTemplateId, "");
  assert.doesNotMatch(c.editorPairList.innerHTML, /value="rx"/);
});
