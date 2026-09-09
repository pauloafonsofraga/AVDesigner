import { normalizeEngineCanvasObject } from "./projectAdapter.js";

export const TITLE_BLOCK_PREVIEW_BUILD_ID = "iteration53-4-1-preview-verification";
export const TITLE_BLOCK_PREVIEW_ID = "title-block-editor-preview";
export const TITLE_BLOCK_PREVIEW_BASE_WIDTH = 760;
export const TITLE_BLOCK_PREVIEW_BASE_HEIGHT = 112;

export function createTitleBlockPreviewScene(options = {}) {
  const draft = createTitleBlockPreviewDraft(options);
  const device = normalizeEngineCanvasObject("title-block", draft, 0);
  return {
    devices: device ? [device] : [],
    wires: [],
    racks: [],
    meta: {
      source: "title-block-editor-draft",
      previewBuildId: TITLE_BLOCK_PREVIEW_BUILD_ID,
      titleBlockPreview: titleBlockPreviewSummary(device, draft)
    }
  };
}

export function createTitleBlockPreviewDraft(options = {}) {
  const sourceBlock = options.block || {};
  const fields = {
    ...(options.defaultFields || {}),
    ...(sourceBlock.fields || {}),
    ...(options.fields || {})
  };
  const logo = String(options.logo || sourceBlock.logo || sourceBlock.companyLogo || fields.companyLogo || "").trim();
  return {
    id: TITLE_BLOCK_PREVIEW_ID,
    x: 0,
    y: 0,
    width: positiveNumber(options.width) || positiveNumber(sourceBlock.width) || TITLE_BLOCK_PREVIEW_BASE_WIDTH,
    height: positiveNumber(options.height) || positiveNumber(sourceBlock.height) || TITLE_BLOCK_PREVIEW_BASE_HEIGHT,
    fields,
    logo,
    companyLogo: logo
  };
}

export function titleBlockPreviewSummary(deviceOrScene, draftInput = {}) {
  const device = Array.isArray(deviceOrScene?.devices)
    ? deviceOrScene.devices[0]
    : deviceOrScene;
  const draft = Array.isArray(deviceOrScene?.devices)
    ? draftInput
    : draftInput;
  const fields = device?.visual?.fields || draft.fields || {};
  return {
    source: "EnginePreviewSurface",
    productionVisual: true,
    deviceId: device?.id || TITLE_BLOCK_PREVIEW_ID,
    kind: device?.kind || "title-block",
    width: Number(device?.width) || positiveNumber(draft.width) || TITLE_BLOCK_PREVIEW_BASE_WIDTH,
    height: Number(device?.height) || positiveNumber(draft.height) || TITLE_BLOCK_PREVIEW_BASE_HEIGHT,
    title: fields.title || "",
    client: fields.client || "",
    project: fields.project || "",
    logo: device?.visual?.logo || draft.logo || draft.companyLogo || fields.companyLogo || ""
  };
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
