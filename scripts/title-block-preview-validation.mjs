import assert from "node:assert/strict";

import { deviceVisualCacheKey } from "../src/engine/deviceVisualBuilder.js";
import {
  createTitleBlockPreviewDraft,
  createTitleBlockPreviewScene,
  titleBlockPreviewSummary,
  TITLE_BLOCK_PREVIEW_BUILD_ID,
  TITLE_BLOCK_PREVIEW_ID
} from "../src/engine/titleBlockPreview.js";
import { normalizeEngineCanvasObject } from "../src/engine/projectAdapter.js";

const baseFields = {
  client: "Video Core",
  project: "Engine Preview Migration",
  title: "Title Block Parity",
  jobId: "53.3",
  revision: "A",
  location: "Dubai",
  eventDate: "2026-09-08",
  drawingDate: "2026-09-08",
  accountManager: "AV",
  approvedBy: "PF",
  companyLogo: "data:image/png;base64,preview-logo"
};

const draft = createTitleBlockPreviewDraft({
  block: {
    id: "source-title-block",
    x: 240,
    y: 320,
    width: 940,
    height: 148,
    fields: baseFields
  }
});

assert.equal(draft.id, TITLE_BLOCK_PREVIEW_ID, "editor preview draft uses stable title-block preview id");
assert.equal(draft.x, 0, "editor preview draft is isolated from production x");
assert.equal(draft.y, 0, "editor preview draft is isolated from production y");
assert.equal(draft.width, 940, "editor preview draft preserves source width");
assert.equal(draft.height, 148, "editor preview draft preserves source height");
assert.equal(draft.logo, baseFields.companyLogo, "editor preview draft promotes companyLogo into logo");

const scene = createTitleBlockPreviewScene({
  block: draft,
  fields: draft.fields,
  width: draft.width,
  height: draft.height,
  logo: draft.logo
});

assert.equal(scene.meta.previewBuildId, TITLE_BLOCK_PREVIEW_BUILD_ID, "title-block preview build id is exposed");
assert.equal(scene.meta.source, "title-block-editor-draft", "title-block preview scene source is explicit");
assert.equal(scene.devices.length, 1, "title-block preview creates one Engine canvas object");
assert.equal(scene.wires.length, 0, "title-block preview does not create wires");
assert.equal(scene.racks.length, 0, "title-block preview does not create racks");

const previewDevice = scene.devices[0];
const productionDevice = normalizeEngineCanvasObject("title-block", draft, 0);
assert.deepEqual(previewDevice, productionDevice, "editor preview normalization matches production title-block normalization");
assert.equal(previewDevice.kind, "title-block", "preview object is an Engine title-block");
assert.equal(previewDevice.visual.objectKind, "title-block", "preview visual stays on title-block visual path");
assert.equal(previewDevice.visual.logo, baseFields.companyLogo, "preview visual keeps logo source");
assert.deepEqual(previewDevice.visual.fields, baseFields, "preview visual keeps all title-block fields");

const changedScene = createTitleBlockPreviewScene({
  block: {
    ...draft,
    fields: {
      ...draft.fields,
      title: "Updated Live Title"
    }
  }
});
const baseKey = deviceVisualCacheKey(previewDevice);
const changedKey = deviceVisualCacheKey(changedScene.devices[0]);
assert.notEqual(baseKey, changedKey, "live title-block field changes invalidate the Engine device visual");

const summary = titleBlockPreviewSummary(scene, draft);
assert.equal(summary.source, "EnginePreviewSurface", "summary reports Engine preview source");
assert.equal(summary.productionVisual, true, "summary reports production visual");
assert.equal(summary.deviceId, TITLE_BLOCK_PREVIEW_ID, "summary preserves preview device id");
assert.equal(summary.kind, "title-block", "summary reports title-block kind");
assert.equal(summary.width, draft.width, "summary reports width");
assert.equal(summary.height, draft.height, "summary reports height");
assert.equal(summary.title, baseFields.title, "summary reports title field");
assert.equal(summary.client, baseFields.client, "summary reports client field");
assert.equal(summary.project, baseFields.project, "summary reports project field");
assert.equal(summary.logo, baseFields.companyLogo, "summary reports logo source");

console.info("Title Block preview validation passed", {
  buildId: TITLE_BLOCK_PREVIEW_BUILD_ID,
  deviceId: previewDevice.id,
  kind: previewDevice.kind,
  width: previewDevice.width,
  height: previewDevice.height,
  visualKeyChanged: baseKey !== changedKey,
  title: summary.title,
  logo: Boolean(summary.logo)
});
