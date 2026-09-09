import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  ENGINE_PREVIEW_BUILD_ID,
  enginePreviewOwnershipAudit
} from "../src/engine/enginePreview.js";
import { RACK_PREVIEW_BUILD_ID } from "../src/engine/rackPreview.js";
import { NODE_PREVIEW_BUILD_ID } from "../src/engine/nodePreview.js";
import { TITLE_BLOCK_PREVIEW_BUILD_ID } from "../src/engine/titleBlockPreview.js";

const EXPECTED_BUILD_ID = "iteration53-4-preview-parity-cleanup";
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const indexHtml = readFileSync(resolve(repoRoot, "index.html"), "utf8");

assert.equal(ENGINE_PREVIEW_BUILD_ID, EXPECTED_BUILD_ID, "shared preview build id");
assert.equal(RACK_PREVIEW_BUILD_ID, EXPECTED_BUILD_ID, "rack preview build id");
assert.equal(NODE_PREVIEW_BUILD_ID, EXPECTED_BUILD_ID, "node preview build id");
assert.equal(TITLE_BLOCK_PREVIEW_BUILD_ID, EXPECTED_BUILD_ID, "title-block preview build id");

assert.ok(indexHtml.includes('const APP_ITERATION = "53.4";'), "app iteration should be 53.4");
assert.ok(indexHtml.includes(`const APP_BUILD_ID = "${EXPECTED_BUILD_ID}";`), "app build id should match 53.4");
assert.ok(indexHtml.includes('const APP_MODULE_CACHE_ID = "iteration53-4-preview-parity-cleanup-modules";'), "module cache key should match 53.4");
assert.ok(indexHtml.includes('url.searchParams.set("module", APP_MODULE_CACHE_ID);'), "engine imports should carry the module cache key");
assert.ok(indexHtml.includes("Preview Parity & Cleanup"), "app build label should name 53.4");

const ownership = enginePreviewOwnershipAudit();
assert.equal(ownership.buildId, EXPECTED_BUILD_ID, "ownership audit build id");

const owners = new Map(ownership.requiredOwners.map(row => [row.owner, row]));
for (const owner of ["device-editor", "rack-builder", "node-builder", "title-block"]) {
  assert.ok(owners.has(owner), `${owner} should be a declared preview owner`);
  assert.equal(owners.get(owner).source, "EnginePreviewSurface", `${owner} source`);
  assert.match(owners.get(owner).productionVisual, /EnginePreviewSurface/, `${owner} production visual ownership`);
}

const excludedIds = new Set(ownership.excludedSurfaces.map(row => row.id));
for (const id of ["node-thumbnail-crop", "main-canvas-transient-previews", "output-report-viewer", "legacy-mode"]) {
  assert.ok(excludedIds.has(id), `${id} should be explicitly excluded from persistent Engine preview migration`);
}

assertFunctionOrder("renderDeviceEditorPreview", [
  "if (deviceEditorUsesEnginePreview())",
  "renderDeviceEditorEnginePreview(template);",
  "return;",
  "editorEnginePreviewLegacyVisualDraws += 1;"
], "Device Editor Engine branch must return before legacy production drawing");

assertFunctionOrder("renderRackBuilderPreview", [
  "if (rackBuilderUsesEnginePreview() && rackBuilderModalOpen())",
  "renderRackBuilderEnginePreview(options);",
  "return;",
  "renderRackBuilderInternalWires(rack, bounds);"
], "Rack Builder Engine branch must return before legacy rack-internal wire drawing");

assertFunctionOrder("renderTitleBlockPreview", [
  "if (titleBlockUsesEnginePreview())",
  "syncTitleBlockEnginePreview(options);",
  "return;",
  "titleBlockEnginePreviewLegacyVisualDraws += 1;",
  "drawTitleBlock(titleBlockPreview, previewBlock, { preview: true });"
], "Title Block Engine branch must return before legacy SVG title-block drawing");

const faceplateGate = functionSource("canShowEditorFaceplatePreview");
assert.ok(
  faceplateGate.includes("if (deviceEditorUsesEnginePreview()) return false;"),
  "separate faceplate SVG production preview must be disabled in Engine mode"
);

const nodeAppearance = functionSource("renderNodeBuilderCanvasAppearancePreview");
assert.ok(nodeAppearance.includes("ensureNodeBuilderEnginePreviewSurface()"), "Node Canvas Appearance should use the Engine preview surface");
assert.ok(nodeAppearance.includes("syncNodeBuilderEnginePreview(options)"), "Node Canvas Appearance should sync through node preview adapter");
assert.equal(
  (indexHtml.match(/nodeBuilderEnginePreviewLegacyVisualDraws \+=/g) || []).length,
  0,
  "Node Canvas Appearance should not retain an Engine-mode legacy production draw counter"
);

assert.ok(indexHtml.includes('owner: "device-editor"'), "Device Editor surface owner should be declared");
assert.ok(indexHtml.includes('owner: "rack-builder"'), "Rack Builder surface owner should be declared");
assert.ok(indexHtml.includes('owner: "node-builder"'), "Node Builder surface owner should be declared");
assert.ok(indexHtml.includes('owner: "title-block"'), "Title Block surface owner should be declared");

const rackLegacyDevice = functionSource("drawRackPreviewDevice");
assert.ok(
  rackLegacyDevice.includes("if (rackBuilderUsesEnginePreview())") && rackLegacyDevice.includes("rackBuilderEnginePreviewLegacyVisualDraws += 1;"),
  "Rack legacy device drawing should retain the Engine-mode tripwire"
);

console.info("Preview ownership validation passed", {
  buildId: EXPECTED_BUILD_ID,
  owners: [...owners.keys()],
  excluded: [...excludedIds]
});

function assertFunctionOrder(functionName, orderedNeedles, message) {
  const source = functionSource(functionName);
  let previous = -1;
  for (const needle of orderedNeedles) {
    const index = source.indexOf(needle, previous + 1);
    assert.ok(index >= 0, `${functionName} should contain ${needle}`);
    assert.ok(index > previous, `${message}: ${needle}`);
    previous = index;
  }
}

function functionSource(functionName) {
  const namePattern = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`function\\s+${namePattern}\\s*\\([^)]*\\)\\s*\\{`).exec(indexHtml);
  assert.ok(match, `Missing function ${functionName}`);
  const start = match.index;
  const bodyStart = start + match[0].lastIndexOf("{");
  assert.ok(bodyStart >= 0, `Missing body for ${functionName}`);
  let depth = 0;
  for (let index = bodyStart; index < indexHtml.length; index += 1) {
    const char = indexHtml[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return indexHtml.slice(start, index + 1);
    }
  }
  assert.fail(`Unterminated function ${functionName}`);
}
