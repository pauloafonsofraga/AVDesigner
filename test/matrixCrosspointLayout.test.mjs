import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { matrixCrosspointFixture } from "../fixtures/matrix-crosspoints.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const state = () => ({ filter:"", routedOnly:false, viewByDeviceId:{} });
function harness(size = 48, options = {}) {
  const instance = matrixCrosspointFixture(size, options).devices[0];
  const c = vm.createContext({
    matrixRoutingUiState:{ modal:state(), inspector:state() }, MATRIX_CROSSPOINT_DEFAULT_LIMIT:256,
    templateForInstance:device => device.templateOverride, effectiveTemplateConnectors:template => template.connectors,
    connectorIncludedInMatrix:connector => connector.includeInMatrix, connectorTypeLabel:() => "HDMI",
    activeEngineBridge:() => null, pushUndo() {}, state:{}, document:{ activeElement:null }
  });
  for (const name of ["escapeHtml", "escapeAttr", "matrixConnectorName", "matrixCrosspointKey",
    "matrixEndpointsForTemplate", "matrixEndpointsForInstance", "ensureMatrixRoutes", "matrixRoutingDeviceKey",
    "matrixRoutingStateFor", "matrixRoutingAssignedCount", "matrixRoutingDefaultView", "matrixRoutingViewForInstance",
    "matrixRoutingToolbarUseful", "matrixRoutingSearchText", "matrixRoutingMarkup", "matrixRoutingCaptureState",
    "applyMatrixInspectorFilter", "bindMatrixRoutingInspector"]) {
    const match = html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"));
    assert.ok(match, name); vm.runInContext(match[0], c);
  }
  return { c, instance, markup:(options = {}) => c.matrixRoutingMarkup(instance, { presentation:"modal", view:"crosspoint", ...options }) };
}
const count = (markup, pattern) => [...markup.matchAll(pattern)].length;

test("48x48 production markup has semantic headers and exactly 2304 stable crosspoints", () => {
  const { instance, markup } = harness(), grid = markup();
  assert.equal(count(grid, /class="matrix-corner" scope="col"/g), 1);
  assert.equal(count(grid, /class="matrix-input-header" scope="col"/g), 48);
  assert.equal(count(grid, /class="matrix-input-label"/g), 48);
  assert.equal(count(grid, /class="matrix-output-header" scope="row"/g), 48);
  assert.equal(count(grid, /class="matrix-crosspoint-cell"/g), 2304);
  const inputs = [...grid.matchAll(/data-matrix-input-header="([^"]+)"/g)].map(m => m[1]);
  const controls = [...grid.matchAll(/data-matrix-key="([^"]+)" data-matrix-output="([^"]+)" data-matrix-input="([^"]+)"/g)];
  assert.equal(controls.length, 2304); assert.equal(new Set(controls.map(m => m[1])).size, 2304);
  assert.deepEqual(inputs, instance.templateOverride.connectors.filter(c => c.direction === "input").map(c => c.id));
  for (const input of inputs) assert.equal(controls.filter(m => m[3] === input).length, 48);
  for (const output of instance.templateOverride.connectors.filter(c => c.direction === "output"))
    assert.equal(controls.filter(m => m[2] === output.id).length, 48);
});

test("full custom input names remain escaped DOM text, tooltips and accessible names", () => {
  const { c, instance, markup } = harness(48, { longNames:true }), grid = markup();
  const input = instance.templateOverride.connectors[23], label = c.escapeAttr(`${input.nameText} / HDMI`);
  assert.ok(grid.includes(`title="${label}" aria-label="${label}"><span class="matrix-input-label">${label}</span>`));
  assert.doesNotMatch(grid, /<primary>/);
  assert.match(grid, /aria-label="OUT 1 \/ HDMI from IN 1 \/ HDMI" aria-pressed="false"/);
  instance.matrixRoutes["output-port-101"] = input.id;
  assert.match(markup(), /class="matrix-cell active"[^>]*aria-pressed="true"/);
});

test("production route listeners assign, replace, remove and fan out using stable IDs", () => {
  const { c, instance, markup } = harness(4);
  const buttons = new Map();
  for (const match of markup().matchAll(/data-matrix-output="([^"]+)" data-matrix-input="([^"]+)"/g)) {
    const button = { dataset:{ matrixOutput:match[1], matrixInput:match[2] },
      addEventListener(type, listener) { this[type] = listener; } };
    buttons.set(`${match[1]}/${match[2]}`, button);
  }
  const wrapper = { dataset:{ matrixPresentation:"modal", matrixDeviceId:instance.instanceId, matrixViewCurrent:"crosspoint" } };
  const root = { querySelector:s => s === "[data-matrix-presentation]" ? wrapper : null,
    querySelectorAll:s => s === "[data-matrix-output][data-matrix-input]" ? [...buttons.values()] : [] };
  let renders = 0;
  c.bindMatrixRoutingInspector(instance, root, { presentation:"modal", rerender:() => renders++ });
  const click = (output, input) => buttons.get(`${output}/${input}`).click({ stopPropagation() {} });
  click("output-port-101", "input-port-108");
  assert.deepEqual(instance.matrixRoutes, { "output-port-101":"input-port-108" });
  click("output-port-101", "input-port-115");
  click("output-port-108", "input-port-115");
  assert.deepEqual(instance.matrixRoutes, { "output-port-101":"input-port-115", "output-port-108":"input-port-115" });
  click("output-port-101", "input-port-115");
  assert.deepEqual(instance.matrixRoutes, { "output-port-108":"input-port-115" });
  assert.equal(renders, 4);
  assert.equal(count(markup({ view:undefined }), /class="matrix-cell active"/g), 1);
  assert.equal(c.matrixRoutingUiState.modal.viewByDeviceId[instance.instanceId], "crosspoint");
});

test("Routes and compact inspector still render route dropdowns without the grid", () => {
  const { markup } = harness();
  for (const options of [{ view:"routes" }, { presentation:"inspector" }]) {
    const output = markup(options);
    assert.equal(count(output, /<select data-matrix-output-select=/g), 48);
    assert.doesNotMatch(output, /matrix-input-label|matrix-crosspoint-cell|<table/);
  }
  assert.match(markup({ presentation:"inspector" }), /data-matrix-open-modal/);
});

test("compact sizing, vertical writing and sticky layering are modal-scoped", () => {
  const rules = selector => html.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]+)\\}"))[1];
  assert.match(rules(".matrix-routing-modal .matrix-grid"), /table-layout: fixed/);
  assert.match(rules(".matrix-routing-modal .matrix-input-column"), /width: 32px/);
  assert.match(rules(".matrix-routing-modal .matrix-input-label"), /writing-mode: vertical-rl/);
  assert.match(rules(".matrix-routing-modal .matrix-input-label"), /transform: rotate\(180deg\)/);
  assert.match(rules(".matrix-routing-modal .matrix-input-label"), /max-height: 104px/);
  assert.match(rules(".matrix-routing-modal .matrix-grid .matrix-corner"), /position: sticky/);
  assert.match(rules(".matrix-routing-modal .matrix-grid .matrix-output-header"), /left: 0/);
  assert.match(html, /\.matrix-routing-modal \.matrix-grid \.matrix-corner \{\s*left: 0;\s*z-index: 3;/);
});
