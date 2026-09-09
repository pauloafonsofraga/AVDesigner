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
  jobId: "53.4.1",
  revision: "A",
  location: "Dubai",
  eventDate: "2026-09-08",
  drawingDate: "2026-09-08",
  accountManager: "AV",
  approvedBy: "PF",
  companyLogo: ""
};

const logoA = "data:image/png;base64,preview-logo-a-wide";
const logoB = "data:image/png;base64,preview-logo-b-tall";

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
assert.equal(draft.logo, "", "editor preview draft supports no-logo state");

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
assert.equal(previewDevice.visual.logo, "", "preview visual keeps no-logo state");
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

const logoAScene = createTitleBlockPreviewScene({
  block: {
    ...draft,
    fields: {
      ...draft.fields,
      companyLogo: logoA
    },
    logo: logoA,
    companyLogo: logoA
  },
  logo: logoA
});
const logoBScene = createTitleBlockPreviewScene({
  block: {
    ...draft,
    fields: {
      ...draft.fields,
      companyLogo: logoB
    },
    logo: logoB,
    companyLogo: logoB
  },
  logo: logoB
});
const noLogoKey = deviceVisualCacheKey(previewDevice);
const logoAKey = deviceVisualCacheKey(logoAScene.devices[0]);
const logoBKey = deviceVisualCacheKey(logoBScene.devices[0]);
assert.notEqual(noLogoKey, logoAKey, "adding a title-block logo invalidates the Engine device visual");
assert.notEqual(logoAKey, logoBKey, "changing the title-block logo invalidates the Engine device visual");
assert.equal(logoAScene.devices[0].visual.logo, logoA, "logo A is promoted into production visual data");
assert.equal(logoBScene.devices[0].visual.logo, logoB, "logo B is promoted into production visual data");

const savedProjectSnapshot = JSON.parse(JSON.stringify({
  titleBlocks: [{
    id: "saved-title-block",
    x: 320,
    y: 440,
    width: draft.width,
    height: draft.height,
    fields: {
      ...draft.fields,
      companyLogo: logoB
    },
    logo: logoB,
    companyLogo: logoB
  }]
}));
const reloadedBlock = savedProjectSnapshot.titleBlocks[0];
const reloadedPreview = createTitleBlockPreviewScene({
  block: reloadedBlock,
  fields: reloadedBlock.fields,
  width: reloadedBlock.width,
  height: reloadedBlock.height,
  logo: reloadedBlock.logo
});
const reloadedProduction = normalizeEngineCanvasObject("title-block", {
  ...reloadedBlock,
  id: TITLE_BLOCK_PREVIEW_ID,
  x: 0,
  y: 0
}, 0);
assert.deepEqual(reloadedPreview.devices[0], reloadedProduction, "save/reload title-block data normalizes identically for preview and production");
assert.equal(reloadedPreview.devices[0].visual.logo, logoB, "save/reload retains the changed title-block logo");

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
assert.equal(summary.logo, "", "summary reports no-logo source");

console.info("Title Block preview validation passed", {
  buildId: TITLE_BLOCK_PREVIEW_BUILD_ID,
  deviceId: previewDevice.id,
  kind: previewDevice.kind,
  width: previewDevice.width,
  height: previewDevice.height,
  visualKeyChanged: baseKey !== changedKey,
  logoAddedKeyChanged: noLogoKey !== logoAKey,
  logoReplacementKeyChanged: logoAKey !== logoBKey,
  saveReloadLogo: reloadedPreview.devices[0].visual.logo === logoB,
  title: summary.title,
  logo: Boolean(logoB)
});
