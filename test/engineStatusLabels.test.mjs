import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");

test("app shell and Engine canvas contain no experimental labels or obsolete startup names", () => {
  assert.doesNotMatch(html, /experimental/i);
  assert.doesNotMatch(bridge, /experimental/i);
  assert.match(bridge, /aria-label="AV Designer canvas"/);
});

for (const type of ["route point", "object move", "wire create"]) {
  test(`${type} commit shows only the normal project summary`, () => {
    const messages = [], actions = [];
    const callback = html.match(/            onEngineCommit: (\(\{ type, mutationStats \}\) => \{[\s\S]*?^            \})/m)?.[1];
    assert.ok(callback);
    const commit = vm.runInNewContext(`(${callback})`, {
      renderCableLegend() {}, renderProjectCustomDevices() {}, renderInspector() {}, updateUndoRedoButtons() {},
      matrixRoutingModal: null, statusSummary: () => "2 devices / 4 cables",
      setStatus: message => messages.push(message), recordShellAction: (...args) => actions.push(args), console: { info() {} }
    });
    commit({ type, mutationStats: {} });
    assert.deepEqual(messages, ["2 devices / 4 cables"]);
    assert.deepEqual(actions, [["engine commit", type]], "internal commit diagnostics are retained");
  });
}

for (const action of ["undo", "redo"]) {
  test(`${action} loading guard uses plain canvas wording`, () => {
    const messages = [];
    const fn = html.match(new RegExp(`^    function ${action}Action\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))?.[0];
    const run = vm.runInNewContext(`(${fn})`, {
      deviceEditorModal: { classList: { contains: () => true } }, activeEngineBridge: () => null,
      engineRendererRequested: () => true, setStatus: message => messages.push(message)
    });
    run();
    assert.deepEqual(messages, [`${action === "undo" ? "Undo" : "Redo"} is not available until the canvas finishes loading.`]);
  });
}
