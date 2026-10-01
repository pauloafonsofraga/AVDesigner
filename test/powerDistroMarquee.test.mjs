import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function functionSource(name) {
  const source = html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))?.[0];
  assert.ok(source, `${name} exists`);
  return source;
}

function harness() {
  const template = { isPowerDistro: true, faceImage: "", faceplateDeleted: false };
  const svg = {};
  const entries = [
    { connector: { id: "a" }, x: 10, y: 10, width: 20, height: 20 },
    { connector: { id: "b" }, x: 50, y: 10, width: 20, height: 20 },
    { connector: { id: "c" }, x: 10, y: 50, width: 20, height: 20 }
  ];
  const renders = [], captures = [], releases = [];
  const context = vm.createContext({
    editorActiveTab: "faceplate", editorPowerPlugMarquee: null,
    editorSelectedPowerPlugIds: new Set(["c"]), editorSelectedFaceplate: false,
    deviceEditorPreview: svg, currentEditorTemplate: () => template,
    editorSvgForEvent: () => svg, getEditorPreviewPoint: event => event.point,
    powerDistroFaceRect: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    powerPlugLayout: () => entries,
    setEditorPointerCapture: event => captures.push(event.pointerId),
    releaseEditorPointerCapture: event => releases.push(event.pointerId),
    renderDeviceEditorPreview: options => renders.push(options)
  });
  vm.runInContext([
    "rectFromPoints", "edgeRectsIntersect", "rectContainsPoint", "powerPlugEntryRect",
    "selectPowerPlugsInRect", "startEditorPowerPlugMarquee", "cancelEditorPowerPlugMarquee"
  ].map(functionSource).join("\n"), context);
  const event = (point, options = {}) => ({
    button: 0, pointerId: 17, point, shiftKey: false, metaKey: false, ctrlKey: false,
    target: { closest: () => null }, preventDefault() {}, stopPropagation() {}, ...options
  });
  return { context, template, entries, captures, releases, renders, event };
}

test("Power Distro marquee selects plug artwork intervals and supports additive selection", () => {
  const { context, template, event } = harness();
  assert.equal(context.startEditorPowerPlugMarquee(event({ x: 3, y: 3 })), true);
  assert.deepEqual([...context.editorSelectedPowerPlugIds], []);
  assert.deepEqual([...context.editorPowerPlugMarquee.originalIds], ["c"]);
  const rect = context.rectFromPoints({ x: 75, y: 35 }, { x: 5, y: 5 });
  context.selectPowerPlugsInRect(template, rect, context.editorPowerPlugMarquee.baseIds);
  assert.deepEqual([...context.editorSelectedPowerPlugIds], ["a", "b"]);
  context.selectPowerPlugsInRect(template, rect, new Set(["c"]));
  assert.deepEqual([...context.editorSelectedPowerPlugIds], ["c", "a", "b"]);
});

test("Power Distro marquee is Faceplate-only and cancel restores selection without editing plugs", () => {
  const { context, template, entries, captures, releases, renders, event } = harness();
  const before = structuredClone(entries);
  context.editorActiveTab = "connectors";
  assert.equal(context.startEditorPowerPlugMarquee(event({ x: 3, y: 3 })), false);
  context.editorActiveTab = "faceplate";
  assert.equal(context.startEditorPowerPlugMarquee(event({ x: 3, y: 3 }, { target: { closest: () => ({}) } })), false);
  template.faceImage = "custom.png";
  assert.equal(context.startEditorPowerPlugMarquee(event({ x: 3, y: 3 })), false);
  template.faceImage = "";
  assert.equal(context.startEditorPowerPlugMarquee(event({ x: 3, y: 3 })), true);
  assert.equal(context.cancelEditorPowerPlugMarquee({ pointerId: 18 }), false);
  assert.equal(context.cancelEditorPowerPlugMarquee(), true);
  assert.deepEqual([...context.editorSelectedPowerPlugIds], ["c"]);
  assert.equal(context.editorPowerPlugMarquee, null);
  assert.deepEqual(captures, [17]);
  assert.deepEqual(releases, [17]);
  assert.deepEqual(renders.map(options => options.refreshTexture), [false, false]);
  assert.deepEqual(entries, before);
});
