import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const report = { projectName: "Reports", summary: [], deviceRows: [], screenRows: [], cableRows: [],
  matrixSections: ["Main <matrix>", "Backup"].map(name => ({ name, brand: "Brand", size: "1 x 1",
    inputs: [{ id: "in", name: "Input 1" }], outputs: [{ id: "out", name: "Output 1" }],
    routes: { out: "in" }, routeRows: [{ output: "Output 1", input: "Input 1" }] })) };
function shell() {
  const c = vm.createContext({});
  for (const name of ["escapeHtml", "escapeAttr", "reportTableHtml", "reportCableTableHtml", "reportSectionHtml",
    "matrixReportGridHtml", "matrixReportHtml", "buildEditorReportHtml", "buildPrintableReportHtml"]) {
    const match = html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"));
    assert.ok(match, name); vm.runInContext(match[0], c);
  }
  return c;
}

test("editor report matrices are separate collapsed disclosures with escaped titles and intact routes", () => {
  const c = shell(), before = JSON.stringify(report), rendered = c.buildEditorReportHtml(report);
  assert.equal((rendered.match(/<details class="report-section matrix-report-section">/g) || []).length, 2);
  assert.doesNotMatch(rendered, /<details[^>]*\bopen\b/);
  assert.match(rendered, /<summary>Matrix Routing - Brand - Main &lt;matrix&gt; \(1 x 1\)<\/summary>/);
  assert.equal((rendered.match(/class="matrix-report-grid"/g) || []).length, 2);
  assert.match(rendered, /Output 1/); assert.match(rendered, /Input 1/);
  assert.equal(JSON.stringify(report), before);
});

test("print/PDF matrix tables remain expanded, complete and noninteractive", () => {
  const rendered = shell().buildPrintableReportHtml(report);
  assert.doesNotMatch(rendered, /<details|<summary|closeReport/);
  assert.equal((rendered.match(/<section class="report-section matrix-report-section">/g) || []).length, 2);
  assert.equal((rendered.match(/class="matrix-report-grid"/g) || []).length, 2);
  assert.match(rendered, /<h2>Matrix Routing/);
});

test("Escape and Close return from the editor report to its opener, without changing selection", () => {
  const source = shell().buildEditorReportHtml(report).match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const action of ["escape", "button"]) {
    const listeners = {}, calls = [];
    const c = vm.createContext({ window: { opener: { focus: () => calls.push("focus") }, close: () => calls.push("close") },
      document: { getElementById: () => ({ addEventListener: (name, fn) => { listeners.button = fn; } }),
        addEventListener: (name, fn) => { listeners[name] = fn; } } });
    vm.runInContext(source, c);
    listeners.keydown({ key: "ArrowDown" }); assert.deepEqual(calls, []);
    if (action === "escape") listeners.keydown({ key: "Escape", preventDefault: () => calls.push("prevent") });
    else listeners.button();
    assert.deepEqual(calls, action === "escape" ? ["prevent", "focus", "close"] : ["focus", "close"]);
  }
});

class Element {
  children = []; dataset = {}; listeners = {}; open = false;
  constructor(tag) { this.tag = tag; }
  append(...children) { this.children.push(...children); }
  prepend(child) { this.children.unshift(child); }
  setAttribute() {}
  addEventListener(type, fn) { this.listeners[type] = fn; }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
}

test("output report renders collapsed matrix tables and Escape restores canvas focus without deselecting", () => {
  const toolbar = new Element("toolbar"), host = new Element("host"), before = JSON.stringify(report);
  host.querySelector = () => toolbar;
  let focused = 0;
  const viewer = { host, abort: { signal: {} }, stage: { focus: () => focused++ },
    select() { assert.fail("closing the report must not change selection"); } };
  const c = vm.createContext({ document: { createElement: tag => new Element(tag) } });
  const source = readFileSync(new URL("../src/engine/outputViewerReport.js", import.meta.url), "utf8");
  vm.runInContext(source.replace("export function", "function"), c);
  c.installOutputReport(viewer, report);
  const walk = node => [node, ...node.children.flatMap(walk)];
  const details = walk(host).filter(node => node.tag === "details");
  assert.equal(details.length, 2);
  details.forEach((node, i) => {
    assert.equal(node.open, false);
    assert.equal(node.children[0].tag, "summary");
    assert.ok(node.children[0].textContent.includes(report.matrixSections[i].name));
    assert.equal(walk(node).filter(n => n.tag === "td").length, 2);
  });
  toolbar.children[0].listeners.click();
  const dialog = host.children[0]; assert.equal(dialog.open, true);
  let prevented = false;
  dialog.listeners.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(dialog.open, false); assert.equal(focused, 1);
  assert.equal(JSON.stringify(report), before);
});
