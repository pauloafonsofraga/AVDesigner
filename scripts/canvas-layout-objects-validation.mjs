import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import {
  normalizeAvDesignerProject,
  normalizeEngineCanvasObject
} from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import {
  commentHitPart,
  commentLeaderGeometry,
  commentTitleHitRect
} from "../src/engine/commentGeometry.js";
import {
  canvasObjectSelectionRect,
  objectGlowRect
} from "../src/engine/renderer.js";
import {
  TITLE_BLOCK_BASE_HEIGHT,
  TITLE_BLOCK_BASE_WIDTH,
  titleBlockLayout
} from "../src/engine/titleBlockLayout.js";

const BUILD_ID = "iteration54-1-1-comment-double-click-editing";
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const indexHtml = readFileSync(resolve(repoRoot, "index.html"), "utf8");
const bridgeSource = readFileSync(resolve(repoRoot, "src/engine/productionBridge.js"), "utf8");
const mutationSource = readFileSync(resolve(repoRoot, "src/engine/projectMutations.js"), "utf8");

function sourceSlice(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} should exist`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `${endNeedle} should follow ${startNeedle}`);
  return source.slice(start, end);
}

assert.ok(indexHtml.includes(`const APP_BUILD_ID = "${BUILD_ID}";`), "app build id should identify Iteration 54.1.1");
assert.ok(indexHtml.includes('const APP_ITERATION = "54.1.1";'), "visible iteration should be 54.1.1");
assert.ok(indexHtml.includes('const APP_MODULE_CACHE_ID = "iteration54-1-1-comment-double-click-editing-modules";'), "module cache key should bust 54.1.1 modules");
assert.ok(bridgeSource.includes(`ENGINE_BRIDGE_VERSION = "${BUILD_ID}"`), "Engine bridge version should identify Iteration 54.1.1");

const classicScripts = [...indexHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert.ok(classicScripts.length >= 1, "index.html should contain at least one classic script");
classicScripts.forEach((match, index) => {
  new vm.Script(match[1], { filename: `index.html<script:${index + 1}>` });
});

const rawArea = {
  id: "area-validation",
  name: "Area / Room Name",
  x: 40,
  y: 64,
  width: 80,
  height: 60,
  backgroundColor: "#223544",
  opacity: 0.42,
  textSize: 28,
  locked: false
};

const rawComment = {
  id: "comment-validation",
  anchor: { x: 96, y: 208 },
  x: 320,
  y: 240,
  width: 180,
  height: 82,
  title: "Comment",
  text: "Line one\nLine two",
  textColor: "#edf2f7",
  backgroundColor: "#18202a",
  leaderColor: "#28bdfd",
  textSize: 14
};

const rawTitleBlock = {
  id: "title-validation",
  x: 520,
  y: 320,
  width: 760,
  height: 112,
  fields: {
    client: "AV Designer",
    project: "Canvas Layout Objects",
    title: "Validation Title",
    revision: "54.1.1",
    companyLogo: "data:image/png;base64,title-logo"
  }
};

const areaDevice = normalizeEngineCanvasObject("area", rawArea, 0);
assert.equal(areaDevice.kind, "area", "area normalizes as a canvas object");
assert.equal(areaDevice.sourceId, rawArea.id, "area keeps stable source id");
assert.equal(areaDevice.x, rawArea.x, "area x is raw x");
assert.equal(areaDevice.y, rawArea.y, "area y is raw y");
assert.equal(areaDevice.width, 80, "area preserves 80px minimum creation width");
assert.equal(areaDevice.height, 60, "area preserves 60px minimum creation height");
assert.equal(areaDevice.visual.backgroundColor, "#223544", "area default background is preserved");
assert.equal(areaDevice.visual.opacity, 0.42, "area explicit opacity survives normalization");
assert.equal(areaDevice.visual.textSize, 28, "area text size survives normalization");

[
  [undefined, 0.32],
  [0.05, 0.05],
  [0.32, 0.32],
  [0.75, 0.75],
  [1, 1]
].forEach(([opacity, expected]) => {
  const normalized = normalizeEngineCanvasObject("area", { ...rawArea, id: `area-opacity-${expected}`, opacity }, 0);
  assert.equal(normalized.visual.opacity, expected, `area opacity ${expected} normalizes numerically`);
});

const commentDevice = normalizeEngineCanvasObject("comment", rawComment, 1);
assert.equal(commentDevice.kind, "comment", "comment normalizes as a canvas object");
assert.equal(commentDevice.sourceId, rawComment.id, "comment keeps stable source id");
assert.deepEqual(absolutePoint(commentDevice, commentDevice.visual.anchor), rawComment.anchor, "comment anchor round-trips exactly");
assert.deepEqual(absoluteRect(commentDevice, commentDevice.visual.box), rawBox(rawComment), "comment box round-trips separately from union bounds");
assert.deepEqual(
  absolutePoint(commentDevice, commentDevice.visual.leaderEnd),
  legacyLeaderEnd(rawBox(rawComment), rawComment.anchor),
  "comment leader endpoint uses the legacy dominant-side rule"
);
const absoluteCommentBox = absoluteRect(commentDevice, commentDevice.visual.box);
const absoluteCommentAnchor = absolutePoint(commentDevice, commentDevice.visual.anchor);
const absoluteCommentLeaderEnd = absolutePoint(commentDevice, commentDevice.visual.leaderEnd);
const leaderGeometry = commentLeaderGeometry({
  box: absoluteCommentBox,
  anchor: absoluteCommentAnchor,
  leaderEnd: absoluteCommentLeaderEnd
});
assert.deepEqual(leaderGeometry.arrowTip, rawComment.anchor, "comment arrow tip is the raw anchor");
assert.notDeepEqual(leaderGeometry.leaderStart, rawComment.anchor, "comment leader line starts after the arrow base");
assert.ok(distance(rawComment.anchor, leaderGeometry.leaderStart) < distance(rawComment.anchor, leaderGeometry.leaderEnd), "comment leader start lies between anchor and box");
assert.deepEqual(canvasObjectSelectionRect(commentDevice), absoluteCommentBox, "comment selection rectangle is the box, not union bounds");
const glowRect = objectGlowRect(commentDevice);
assert.deepEqual(
  { x: glowRect.x, y: glowRect.y, width: glowRect.width, height: glowRect.height },
  absoluteCommentBox,
  "comment soft glow rectangle is the box, not union bounds"
);
assert.notEqual(glowRect.width, commentDevice.width, "comment glow width differs from normalized union width");
const commentHitFixture = {
  box: absoluteCommentBox,
  anchor: absoluteCommentAnchor,
  leaderEnd: absoluteCommentLeaderEnd,
  textSize: rawComment.textSize,
  title: rawComment.title
};
const titleHitRect = commentTitleHitRect(absoluteCommentBox, rawComment.textSize, rawComment.title);
assert.ok(titleHitRect.width < absoluteCommentBox.width, "comment title hit region is constrained to visible label width");
assert.equal(
  commentHitPart(commentHitFixture, {
    x: titleHitRect.x + titleHitRect.width / 2,
    y: titleHitRect.y + titleHitRect.height / 2
  }, 8)?.part,
  "title",
  "comment title hit region resolves as title"
);
assert.equal(
  commentHitPart(commentHitFixture, {
    x: absoluteCommentBox.x + absoluteCommentBox.width / 2,
    y: absoluteCommentBox.y + absoluteCommentBox.height / 2
  }, 8)?.part,
  "body",
  "comment body center resolves as body"
);
assert.equal(
  commentHitPart(commentHitFixture, {
    x: (leaderGeometry.leaderStart.x + leaderGeometry.leaderEnd.x) / 2,
    y: (leaderGeometry.leaderStart.y + leaderGeometry.leaderEnd.y) / 2
  }, 8)?.part,
  "leader",
  "comment leader midpoint resolves as leader"
);
assert.equal(
  commentHitPart(commentHitFixture, {
    x: (leaderGeometry.arrowTip.x + leaderGeometry.arrowBaseCenter.x) / 2,
    y: (leaderGeometry.arrowTip.y + leaderGeometry.arrowBaseCenter.y) / 2
  }, 8)?.part,
  "arrow",
  "comment arrow shaft resolves as arrow"
);

const movedComment = {
  ...rawComment,
  x: rawComment.x + 112,
  y: rawComment.y + 34
};
const movedCommentDevice = normalizeEngineCanvasObject("comment", movedComment, 1);
assert.deepEqual(absolutePoint(movedCommentDevice, movedCommentDevice.visual.anchor), rawComment.anchor, "comment box move keeps anchor fixed");
assert.deepEqual(absoluteRect(movedCommentDevice, movedCommentDevice.visual.box), rawBox(movedComment), "comment box move updates only box position");
assert.notDeepEqual(
  absolutePoint(movedCommentDevice, movedCommentDevice.visual.leaderEnd),
  absolutePoint(commentDevice, commentDevice.visual.leaderEnd),
  "comment leader recalculates after box movement"
);

const titleDevice = normalizeEngineCanvasObject("title-block", rawTitleBlock, 2);
assert.equal(titleDevice.kind, "title-block", "title block normalizes as a canvas object");
assert.equal(titleDevice.width / titleDevice.height, rawTitleBlock.width / rawTitleBlock.height, "title block preserves aspect ratio");
assert.equal(titleDevice.visual.logo, rawTitleBlock.fields.companyLogo, "title block logo survives normalization");
assert.equal(titleDevice.visual.fields.title, "Validation Title", "title nested fields survive normalization");
const titleLayout = titleBlockLayout(TITLE_BLOCK_BASE_WIDTH, TITLE_BLOCK_BASE_HEIGHT);
assert.equal(titleLayout.logoCell.width, titleLayout.logoCell.height, "title block logo cell is square");
assert.equal(titleLayout.logoCell.width, TITLE_BLOCK_BASE_HEIGHT, "title block logo square uses block height");
assert.ok(titleLayout.rowDivider.x2 <= titleLayout.logoCell.x, "title block row divider stops before logo cell");
assert.ok(titleLayout.logoContentRect.width <= titleLayout.logoCell.width, "title block logo content stays inside square");

const project = {
  devices: [],
  connections: [],
  areas: [rawArea],
  comments: [rawComment],
  titleBlocks: [rawTitleBlock],
  ledSurfaces: [],
  imageObjects: [],
  jumpNodes: [],
  racks: []
};
const adapter = new ProjectMutationAdapter({ projectData: project }, { cloneProjectData: false });

const createdComment = { ...rawComment, id: "comment-created", x: 612, y: 144 };
let result = adapter.restoreSceneObject("comment", createdComment, 1);
assert.equal(result.index, 1, "comment restore inserts at requested index");
assert.equal(project.comments.length, 2, "comment restore mutates production state");
assert.deepEqual(project.comments[1].anchor, rawComment.anchor, "restored comment preserves anchor");

const replacedComment = { ...createdComment, title: "Edited", textSize: 18 };
result = adapter.replaceSceneObject("comment", replacedComment, 1);
assert.equal(result.index, 1, "comment replace keeps index");
assert.equal(project.comments[1].title, "Edited", "comment replace updates raw production object");
assert.equal(project.comments[1].textSize, 18, "comment replace preserves textSize");

result = adapter.removeSceneObject(normalizeEngineCanvasObject("comment", replacedComment, 1));
assert.equal(result.index, 1, "comment delete reports deleted index");
assert.equal(project.comments.length, 1, "comment delete removes production object");
result = adapter.restoreSceneObject("comment", result.objectData, result.index);
assert.equal(project.comments.length, 2, "comment undo restore reinserts production object");
assert.equal(project.comments[1].id, "comment-created", "comment undo restore keeps stable id");

const replacedArea = { ...rawArea, name: "Edited Area", locked: true, opacity: 0.58, textSize: 24 };
result = adapter.replaceSceneObject("area", replacedArea, 0);
assert.equal(result.index, 0, "area replace keeps index");
assert.equal(project.areas[0].locked, true, "area lock survives replacement");
assert.equal(project.areas[0].opacity, 0.58, "area opacity survives replacement");
assert.equal(project.areas[0].textSize, 24, "area textSize survives replacement");

const resizedTitle = {
  ...rawTitleBlock,
  width: 380,
  height: 56,
  fields: { ...rawTitleBlock.fields, title: "Edited Title" }
};
result = adapter.replaceSceneObject("title-block", resizedTitle, 0);
assert.equal(result.index, 0, "title replace keeps index");
assert.equal(project.titleBlocks[0].width / project.titleBlocks[0].height, 760 / 112, "title replacement keeps proportional test fixture");
assert.equal(project.titleBlocks[0].fields.title, "Edited Title", "title nested fields replace exactly");

const roundTrip = JSON.parse(JSON.stringify(project));
const normalizedRoundTrip = normalizeAvDesignerProject(roundTrip);
assert.equal(normalizedRoundTrip.devices.filter(device => device.kind === "area").length, 1, "round-trip has one area");
assert.equal(normalizedRoundTrip.devices.filter(device => device.kind === "comment").length, 2, "round-trip has two comments");
assert.equal(normalizedRoundTrip.devices.filter(device => device.kind === "title-block").length, 1, "round-trip has one title block");
assert.deepEqual(roundTrip.comments[1].anchor, rawComment.anchor, "round-trip preserves comment anchor");
assert.equal(roundTrip.titleBlocks[0].fields.companyLogo, rawTitleBlock.fields.companyLogo, "round-trip preserves title logo field");
const savedReloadComment = {
  ...rawComment,
  id: "comment-save-reload",
  title: "FOH NOTE",
  text: "Move rack before doors"
};
const savedReloadProject = JSON.parse(JSON.stringify({
  ...project,
  comments: [savedReloadComment]
}));
const normalizedSavedReload = normalizeAvDesignerProject(savedReloadProject);
assert.equal(normalizedSavedReload.devices.filter(device => device.kind === "comment").length, 1, "save/reload fixture has one comment");
assert.equal(savedReloadProject.comments[0].title, "FOH NOTE", "save/reload preserves edited comment title");
assert.equal(savedReloadProject.comments[0].text, "Move rack before doors", "save/reload preserves edited comment body");

assert.ok(indexHtml.includes("commitCreatedCanvasObject"), "shell uses Engine canvas-object creation command");
assert.ok(indexHtml.includes("onEngineCanvasToolPointerEvent"), "shell exposes Engine canvas tool pointer adapter");
assert.ok(indexHtml.includes("onEngineCanvasObjectDoubleClick"), "shell exposes Engine canvas-object double-click adapter");
assert.ok(indexHtml.includes("engine-layout-tool-overlay"), "Engine placement previews use a dedicated overlay");
assert.ok(indexHtml.includes("pointer-events: none"), "Engine placement overlay must not intercept pointer events");
assert.ok(indexHtml.includes("engine-comment-preview-arrow"), "Engine comment placement preview draws an explicit arrowhead");
assert.ok(indexHtml.includes(".comment-editor") && indexHtml.includes("z-index: 120"), "inline comment editor is stacked above the Engine canvas");
assert.ok(indexHtml.includes("commitCanvasLayoutObjectInspectorEdit"), "Comment/Area inspector edits use canvas-object snapshot commands");
assert.ok(indexHtml.includes("bindCanvasObjectColorCommitInput"), "Comment/Area color inputs commit once through the snapshot path");
assert.ok(indexHtml.includes("bindCanvasObjectOpacityCommitInput"), "Area opacity uses one snapshot command per slider gesture");
const engineDoubleClickHandler = sourceSlice(
  indexHtml,
  "function handleEngineCanvasObjectDoubleClick",
  'if (kind === "area")'
);
assert.ok(engineDoubleClickHandler.includes('if (part === "title")'), "Engine shell routes comment title from payload.part");
assert.ok(engineDoubleClickHandler.includes('if (part === "body")'), "Engine shell routes comment body from payload.part");
assert.ok(!engineDoubleClickHandler.includes('part === "body" || part === "box"'), "Engine shell does not keep stale box alias for body editing");
assert.ok(!engineDoubleClickHandler.includes("titleBand"), "Engine shell removed obsolete Comment Y-band fallback");
assert.ok(indexHtml.includes("Math.max(80, Math.round(rect.width))"), "area creation enforces 80px minimum width");
assert.ok(indexHtml.includes("Math.max(60, Math.round(rect.height))"), "area creation enforces 60px minimum height");
assert.ok(indexHtml.includes("width: 180") && indexHtml.includes("height: 82"), "comment creation keeps legacy default size");
assert.ok(bridgeSource.includes("commentBoxDrag"), "Engine bridge has comment box-specific drag state");
assert.ok(bridgeSource.includes("commentHitPart"), "comment hit testing uses semantic title/body/leader/arrow geometry");
assert.ok(bridgeSource.includes('hit.part === "body"'), "Comment body is the draggable comment box part");
assert.ok(!bridgeSource.includes('hit.part === "box"'), "Engine bridge no longer expects stale box hit part");
assert.ok(bridgeSource.includes("consumeCanvasObjectPointerDoubleClick"), "Engine bridge recognizes visible pointer double-clicks for canvas comments");
assert.ok(bridgeSource.includes('"pointer-double-click"'), "Engine bridge reports pointer double-click diagnostics separately from native dblclick");
assert.ok(bridgeSource.includes("TITLE_BLOCK_MIN_SCALE = 0.34"), "title-block minimum scale is preserved");
assert.ok(mutationSource.includes('"textSize"'), "canvas object textSize is mutation-whitelisted");

console.info("Canvas layout object validation passed", {
  buildId: BUILD_ID,
  scriptsParsed: classicScripts.length,
  area: { width: areaDevice.width, height: areaDevice.height },
  comment: {
    box: absoluteRect(commentDevice, commentDevice.visual.box),
    anchor: absolutePoint(commentDevice, commentDevice.visual.anchor),
    movedAnchor: absolutePoint(movedCommentDevice, movedCommentDevice.visual.anchor)
  },
  title: {
    width: titleDevice.width,
    height: titleDevice.height,
    ratio: Number((titleDevice.width / titleDevice.height).toFixed(4)),
    logoCell: titleLayout.logoCell,
    rowDivider: titleLayout.rowDivider
  },
  roundTripCounts: normalizedRoundTrip.devices.reduce((counts, device) => {
    counts[device.kind] = (counts[device.kind] || 0) + 1;
    return counts;
  }, {})
});

function rawBox(comment) {
  return {
    x: comment.x,
    y: comment.y,
    width: comment.width,
    height: comment.height
  };
}

function absolutePoint(device, point) {
  return {
    x: Number((Number(device.x) + Number(point.x)).toFixed(6)),
    y: Number((Number(device.y) + Number(point.y)).toFixed(6))
  };
}

function absoluteRect(device, rect) {
  return {
    x: Number((Number(device.x) + Number(rect.x)).toFixed(6)),
    y: Number((Number(device.y) + Number(rect.y)).toFixed(6)),
    width: Number(rect.width),
    height: Number(rect.height)
  };
}

function legacyLeaderEnd(box, anchor) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = anchor.x - cx;
  const dy = anchor.y - cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { x: dx < 0 ? box.x : box.x + box.width, y: cy };
  }
  return { x: cx, y: dy < 0 ? box.y : box.y + box.height };
}

function distance(a, b) {
  return Number(Math.hypot(a.x - b.x, a.y - b.y).toFixed(6));
}
