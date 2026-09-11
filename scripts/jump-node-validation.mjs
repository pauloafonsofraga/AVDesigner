import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { distanceToPolyline } from "../src/engine/hitTest.js";
import {
  deriveLegacyPairJumpLinks,
  invalidJumpLinksForScene,
  JUMP_NODE_CONNECTOR_ID,
  JUMP_NODE_ROLE,
  JUMP_NODE_ROLE_COLORS,
  jumpLinkBezierPolyline,
  jumpNodeCenter,
  jumpNodeConnectionInfo,
  jumpIdleHoverPrecedence,
  jumpNodeLocalCenter,
  JUMP_NODE_SIZE,
  JUMP_PRESS_MOVE_THRESHOLD_PX,
  JUMP_PRESS_INTENT,
  jumpPressIntent,
  jumpPairCompatibility,
  normalizeEngineJumpNode,
  normalizeJumpLinks,
  rawJumpNodeRole,
  resolvePlayableSignalPath,
  sceneJumpNodeRole,
  validateJumpLinks
} from "../src/engine/jumpNodeModel.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import {
  WIRE_PLAYBACK_COMPLETE_HOLD_MS,
  wirePlaybackDurationMs,
  wirePlaybackEase
} from "../src/engine/wirePlayback.js";

const BUILD_ID = "iteration54-2-5-jump-interaction-legacy-actions";
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const indexHtml = readFileSync(resolve(repoRoot, "index.html"), "utf8");
const bridgeSource = readFileSync(resolve(repoRoot, "src/engine/productionBridge.js"), "utf8");
const rendererSource = readFileSync(resolve(repoRoot, "src/engine/renderer.js"), "utf8");
const snapshotSource = readFileSync(resolve(repoRoot, "src/engine/outputSnapshot.js"), "utf8");
const wirePlaybackSource = readFileSync(resolve(repoRoot, "src/engine/wirePlayback.js"), "utf8");

assert.ok(indexHtml.includes(`const APP_BUILD_ID = "${BUILD_ID}";`), "app build id should identify Jump Interaction & Legacy Actions");
assert.ok(indexHtml.includes('const APP_MODULE_CACHE_ID = "iteration54-2-5-jump-interaction-legacy-actions-modules";'), "module cache key should identify Jump Interaction & Legacy Actions");
assert.ok(indexHtml.includes("Jump Interaction & Legacy Actions"), "visible build label should name Jump Interaction & Legacy Actions");
assert.ok(bridgeSource.includes(`ENGINE_BRIDGE_VERSION = "${BUILD_ID}"`), "Engine bridge version should identify Jump Interaction & Legacy Actions");
assert.ok(bridgeSource.includes('ENGINE_BRIDGE_FEATURE_LABEL = "jump-interaction-legacy-actions"'), "bridge feature label should identify Jump Interaction & Legacy Actions");
assert.ok(bridgeSource.includes("production-bridge-iteration54-2-5-jump-interaction-legacy-actions"), "bridge fingerprint should identify Jump Interaction & Legacy Actions");
assert.ok(rendererSource.includes("renderer-iteration54-2-4-jump-legacy-parity-play-wire"), "unchanged renderer fingerprint should remain on the last renderer iteration");
assert.ok(snapshotSource.includes("jumpLinks"), "output snapshot should preserve jumpLinks");
assert.ok(rendererSource.includes("drawJumpNodeInfoBox"), "renderer should draw derived Legacy Jump info boxes");
assert.ok(rendererSource.includes("pushWirePlaybackOverlay"), "renderer should draw transient Play Wire overlays");
assert.ok(bridgeSource.includes("jumpToPair("), "Engine bridge should handle Jump to Pair navigation");
assert.ok(bridgeSource.includes("playWireTrace"), "Engine bridge should expose Play Wire");
assert.ok(bridgeSource.includes("wirePlaybackOverlayState"), "Engine bridge should expose playback as interaction overlay state");
assert.ok(bridgeSource.includes("handleInspectorActionClick"), "Engine inspector actions should use persistent delegated click handling");
assert.ok(bridgeSource.includes("triggerJumpToPairAction"), "Engine bridge should expose one shared Jump to Pair button action");
assert.ok(bridgeSource.includes("triggerPlayWireAction"), "Engine bridge should expose one shared Play Wire button action");
assert.ok(indexHtml.includes("triggerJumpToPairAction(jumpNodeId"), "app Inspector Jump to Pair should delegate to the active Engine bridge");
assert.ok(indexHtml.includes("triggerPlayWireAction(connectionId"), "app Inspector Play Wire should delegate to the active Engine bridge");
assert.ok(bridgeSource.includes('data-jump-id="${escapeHtml(primaryJump.id)}"'), "Jump to Pair button should carry the active Jump ID");
assert.ok(bridgeSource.includes('data-wire-id="${escapeHtml(wire.id)}"'), "Play Wire button should carry the active wire ID");
assert.ok(bridgeSource.includes("idleHoverOwner"), "Jump debug snapshot should expose idle hover ownership");
assert.ok(bridgeSource.includes("connectorHoverSuppressedByJump"), "Jump debug snapshot should expose connector suppression");
assert.ok(bridgeSource.includes("wireHoverSuppressedByJump"), "Jump debug snapshot should expose wire suppression");
assert.ok(bridgeSource.includes("jumpToPairButtonClickCount"), "Jump debug snapshot should expose Jump to Pair button clicks");
assert.ok(bridgeSource.includes("playWireButtonClickCount"), "Jump debug snapshot should expose Play Wire button clicks");
assert.ok(wirePlaybackSource.includes("WIRE_PLAYBACK_MIN_MS = 650"), "Play Wire should preserve Legacy minimum timing");
assert.ok(wirePlaybackSource.includes("WIRE_PLAYBACK_MAX_MS = 4500"), "Play Wire should preserve Legacy maximum timing");
assert.equal(WIRE_PLAYBACK_COMPLETE_HOLD_MS, 350, "Playback completion hold should be short and self-cleaning");
assert.equal(wirePlaybackDurationMs([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 650, "short wires should use Legacy minimum duration");
assert.equal(wirePlaybackDurationMs([{ x: 0, y: 0 }, { x: 2000, y: 0 }]), 4500, "long wires should use Legacy maximum duration");
assert.equal(wirePlaybackEase(0), 0, "playback easing should start at 0");
assert.equal(wirePlaybackEase(1), 1, "playback easing should end at 1");
assert.equal(JUMP_PRESS_MOVE_THRESHOLD_PX, 5, "Jump press movement tolerance should be 5 px");
assert.equal(jumpPressIntent({ distancePx: 0, released: true }), JUMP_PRESS_INTENT.select, "released below threshold should select");
assert.equal(jumpPressIntent({ distancePx: 5, canStartLink: true, explicitlyMoveArmed: false }), JUMP_PRESS_INTENT.link, "eligible unarmed movement at threshold should link");
assert.equal(jumpPressIntent({ distancePx: 5, canStartLink: true, explicitlyMoveArmed: true }), JUMP_PRESS_INTENT.move, "eligible armed movement at threshold should move");
assert.equal(jumpPressIntent({ distancePx: 5, canStartLink: true, pressedJumpSelected: true, selectedCount: 2 }), JUMP_PRESS_INTENT.move, "selected multi Jump drag should move instead of link from pressed A");
assert.equal(jumpPressIntent({ distancePx: 5, canStartLink: true, multiSelectionMove: true }), JUMP_PRESS_INTENT.move, "selected multi Jump drag should move instead of link from pressed B");
assert.equal(jumpPressIntent({ distancePx: 5, canStartLink: false, explicitlyMoveArmed: false }), JUMP_PRESS_INTENT.move, "neutral movement at threshold should move");
assert.equal(jumpPressIntent({ distancePx: 5, canStartLink: false, explicitlyMoveArmed: true }), JUMP_PRESS_INTENT.move, "paired or otherwise ineligible movement at threshold should move");
assert.equal(jumpPressIntent({ distancePx: 4, canStartLink: true, explicitlyMoveArmed: false }), JUMP_PRESS_INTENT.pending, "below threshold should remain pending until released or dragged");

const baseProject = createProject();
const baseScene = createScene();

assert.equal(sceneJumpNodeRole(baseScene, "jump-output").role, JUMP_NODE_ROLE.output, "device output -> Jump derives output role");
assert.equal(sceneJumpNodeRole(baseScene, "jump-input").role, JUMP_NODE_ROLE.input, "Jump -> device input derives input role");
assert.equal(sceneJumpNodeRole(baseScene, "jump-neutral").role, JUMP_NODE_ROLE.neutral, "unconnected Jump derives neutral role");
assert.equal(rawJumpNodeRole(baseProject, "jump-output").role, JUMP_NODE_ROLE.output, "raw output role derives from real connector direction");
assert.equal(rawJumpNodeRole(baseProject, "jump-input").role, JUMP_NODE_ROLE.input, "raw input role derives from real connector direction");
assert.equal(JUMP_NODE_ROLE_COLORS.output, "#32b6ff", "output Jump color");
assert.equal(JUMP_NODE_ROLE_COLORS.input, "#fb7904", "input Jump color");
assert.equal(JUMP_NODE_ROLE_COLORS.neutral, "#778492", "neutral Jump color");

assert.deepEqual(jumpNodeConnectionInfo(baseScene, "jump-output"), {
  side: "right",
  prefix: "to",
  text: "to: destination - input-hdmi",
  displayText: "to: destination - input-hdmi",
  connected: true,
  jumpId: "jump-output",
  pairId: "jump-input",
  wireId: "wire-jump-input",
  wireSourceId: "wire-jump-input",
  localWireSide: "from",
  deviceId: "destination",
  deviceName: "destination",
  connectorId: "input-hdmi",
  connectorName: "input-hdmi",
  cableType: "hdmi",
  fiberMode: ""
}, "output Jump info should describe the paired downstream endpoint using the exact Legacy formula");
assert.equal(
  jumpNodeConnectionInfo(baseScene, "jump-input").displayText,
  "from: source - output-hdmi",
  "input Jump info should describe the paired upstream endpoint using the exact Legacy formula"
);
assert.equal(
  jumpNodeConnectionInfo(baseScene, "jump-neutral").displayText,
  "to: Unassigned",
  "unconnected Jump info should match the Legacy placeholder"
);
const renamedDestination = baseScene.getDevice("destination");
renamedDestination.label = "Switcher B";
renamedDestination.connectorsById.get("input-hdmi").nameText = "PGM";
assert.equal(
  jumpNodeConnectionInfo(baseScene, "jump-output").displayText,
  "to: Switcher B - PGM",
  "derived Jump info should update from scene data without persisted caption state"
);
renamedDestination.label = "destination";
renamedDestination.connectorsById.get("input-hdmi").nameText = "";

const rawCenteredJump = normalizeEngineJumpNode({ id: "raw-center-jump", x: 400, y: 300, label: "Center" }, 0);
const rawCenteredConnector = rawCenteredJump.connectors.find(item => item.id === JUMP_NODE_CONNECTOR_ID);
assert.deepEqual(jumpNodeLocalCenter(rawCenteredJump), { x: 22, y: 22 }, "Jump local center should be the visible node center");
assert.deepEqual(jumpNodeCenter(rawCenteredJump), { x: 400, y: 300 }, "Jump world center should preserve the raw visible center");
assert.equal(rawCenteredConnector?.side, "center", "Jump connector should be center-side");
assert.equal(rawCenteredConnector?.x, 22, "Jump connector x should sit at the center");
assert.equal(rawCenteredConnector?.y, 22, "Jump connector y should sit at the center");
assert.equal(rawCenteredConnector?.primaryAnchorId, JUMP_NODE_CONNECTOR_ID, "Jump connector should use its center anchor as primary");
assert.equal(rawCenteredConnector?.anchors?.[0]?.id, JUMP_NODE_CONNECTOR_ID, "Jump center anchor should be explicit");
assert.equal(rawCenteredConnector?.anchors?.[0]?.side, "center", "Jump center anchor should be center-side");
assert.equal(rawCenteredConnector?.anchors?.[0]?.x, 22, "Jump center anchor x should be explicit");
assert.equal(rawCenteredConnector?.anchors?.[0]?.y, 22, "Jump center anchor y should be explicit");

const engineScene = createEngineScene();
const engineOutputJump = engineScene.getDevice("engine-jump-output");
const engineInputJump = engineScene.getDevice("engine-jump-input");
const engineOutputCenter = jumpNodeCenter(engineOutputJump);
const engineInputCenter = jumpNodeCenter(engineInputJump);
const engineOutputConnectorPoint = engineScene.connectorWorldPoint(engineOutputJump, engineScene.getConnector(engineOutputJump.id, JUMP_NODE_CONNECTOR_ID));
const engineOutputWireEndpoint = engineScene.endpointForWire(engineScene.getWire("engine-wire-output-jump"), "to");
const engineInputWireEndpoint = engineScene.endpointForWire(engineScene.getWire("engine-wire-jump-input"), "from");
const engineOutputHit = engineScene.connectorIndex
  .queryRect({ x: engineOutputCenter.x - 0.5, y: engineOutputCenter.y - 0.5, width: 1, height: 1 })
  .find(entry => entry.payload?.device?.id === "engine-jump-output" && entry.payload?.connector?.id === JUMP_NODE_CONNECTOR_ID);
assertClosePoint(engineOutputCenter, { x: 400, y: 300 }, "Engine Jump output center");
assertClosePoint(engineInputCenter, { x: 680, y: 470 }, "Engine Jump input center");
assertClosePoint(engineOutputConnectorPoint, engineOutputCenter, "Engine Jump connector hit point should match center");
assertClosePoint(engineOutputWireEndpoint, engineOutputCenter, "Wire endpoint into Jump output should match center");
assertClosePoint(engineInputWireEndpoint, engineInputCenter, "Wire endpoint out of Jump input should match center");
assert.ok(engineOutputHit, "Jump connector hit index should include the visible center");
assertClosePoint(engineOutputHit.payload.point, engineOutputCenter, "Jump connector spatial index point should match center");

const jumpRadius = JUMP_NODE_SIZE / 2;
const wireToJump = [{ x: engineOutputCenter.x - 140, y: engineOutputCenter.y }, engineOutputCenter];
[
  { label: "left semicircle", point: { x: engineOutputCenter.x - jumpRadius + 1, y: engineOutputCenter.y } },
  { label: "center", point: engineOutputCenter },
  { label: "right semicircle", point: { x: engineOutputCenter.x + jumpRadius - 1, y: engineOutputCenter.y } }
].forEach(({ label, point }) => {
  const wireNear = distanceToPolyline(wireToJump, point).distance <= 8;
  const owner = jumpIdleHoverPrecedence({ jumpBodyHit: true, wireHit: wireNear });
  assert.equal(owner.owner, "jump", `${label}: Jump body should own idle hover`);
  assert.equal(owner.wireHoverSuppressedByJump, wireNear, `${label}: physical wire hover is suppressed only when it overlaps the Jump`);
});
const outsideWirePoint = { x: engineOutputCenter.x - jumpRadius - 28, y: engineOutputCenter.y };
assert.equal(distanceToPolyline(wireToJump, outsideWirePoint).distance <= 8, true, "outside point should still be on the physical wire");
assert.equal(
  jumpIdleHoverPrecedence({ jumpBodyHit: false, wireHit: true }).owner,
  "wire",
  "physical wire should own idle hover outside the Jump circle"
);

engineScene.selectJumpPairPrimary("engine-jump-output");
assert.equal(engineScene.selectedIds.has("engine-jump-output"), true, "Selecting a Jump should select the clicked node");
assert.equal(engineScene.selectedIds.has("engine-jump-input"), false, "Selecting a paired Jump should not select or move the paired node");
assert.equal(engineScene.pairedJumpId("engine-jump-output"), "engine-jump-input", "Selected Jump should still know its pair");
const engineInputBeforeMove = jumpNodeCenter(engineInputJump);
engineScene.moveDevicesBy(["engine-jump-output"], 73, 41);
assertClosePoint(jumpNodeCenter(engineOutputJump), { x: 473, y: 341 }, "Moving one selected Jump should move that Jump by the drag delta");
assertClosePoint(jumpNodeCenter(engineInputJump), engineInputBeforeMove, "Moving one selected Jump should not move its paired Jump");
assertClosePoint(engineScene.endpointForWire(engineScene.getWire("engine-wire-output-jump"), "to"), jumpNodeCenter(engineOutputJump), "Moved Jump wire endpoint should stay centered");
assertClosePoint(engineScene.connectorWorldPoint(engineOutputJump, engineScene.getConnector(engineOutputJump.id, JUMP_NODE_CONNECTOR_ID)), jumpNodeCenter(engineOutputJump), "Moved Jump connector should stay centered");

engineScene.selectMany(["engine-jump-output", "engine-jump-input"]);
engineScene.moveDevicesBy([...engineScene.selectedIds], 10, 20);
assertClosePoint(jumpNodeCenter(engineOutputJump), { x: 483, y: 361 }, "Explicit multi-selection should move the output Jump");
assertClosePoint(jumpNodeCenter(engineInputJump), { x: 690, y: 490 }, "Explicit multi-selection should move the input Jump");

const jumpPairNavigationScene = createEngineScene();
const navigationLinksBefore = JSON.stringify(jumpPairNavigationScene.jumpLinks);
jumpPairNavigationScene.selectJumpPairPrimary("engine-jump-output");
const navigationTarget = jumpPairNavigationScene.pairedJumpId(jumpPairNavigationScene.primarySelectedJumpId);
jumpPairNavigationScene.selectJumpPairPrimary(navigationTarget);
assert.equal(jumpPairNavigationScene.primarySelectedJumpId, "engine-jump-input", "Jump to Pair selection should make the paired Jump primary");
assert.deepEqual([...jumpPairNavigationScene.selectedIds], ["engine-jump-input"], "Jump to Pair selection should leave only the paired Jump selected");
assert.equal(JSON.stringify(jumpPairNavigationScene.jumpLinks), navigationLinksBefore, "Jump to Pair selection should not mutate Jump Link model data");
assert.ok(bridgeSource.includes("commandIndexBefore") && bridgeSource.includes("commandIndexAfter"), "Jump to Pair should record command index before/after for no-history diagnostics");
assert.ok(bridgeSource.includes("centerCameraAtWorldPoint(center, \"jump-to-pair\""), "Jump to Pair should center the paired Jump without changing zoom");

const portalPoints = jumpLinkBezierPolyline({ x: 400, y: 300 }, { x: 660, y: 470 });
assert.ok(portalPoints.length > 2, "Jump portal links should use sampled Bezier points");
assert.equal(portalPoints[0].x, 400, "Bezier portal should start at the output center x");
assert.equal(portalPoints[0].y, 300, "Bezier portal should start at the output center y");
assert.equal(portalPoints.at(-1).x, 660, "Bezier portal should end at the input center x");
assert.equal(portalPoints.at(-1).y, 470, "Bezier portal should end at the input center y");
assert.ok(portalPoints.some((point, index) => {
  const t = index / Math.max(1, portalPoints.length - 1);
  const straightX = 400 + (660 - 400) * t;
  const straightY = 300 + (470 - 300) * t;
  return Math.hypot(point.x - straightX, point.y - straightY) > 0.01;
}), "Bezier portal should visibly curve away from the straight chord");
const portalHitPoint = portalPoints[Math.floor(portalPoints.length * 0.35)];
assert.equal(hitJumpLinkFromOverlays([{ id: "engine-jump-link-1", points: portalPoints }], portalHitPoint, 0.01)?.id, "engine-jump-link-1", "Revealed Jump portal should be hit-testable along its Bezier path");
assert.equal(hitJumpLinkFromOverlays([{ id: "engine-jump-link-1", points: portalPoints }], { x: portalHitPoint.x, y: portalHitPoint.y + 200 }, 5), null, "Far-away points should not hit a Jump portal");

const deleteScene = createEngineScene();
deleteScene.selectJumpLinkOnly("engine-jump-link-1");
assert.equal(deleteScene.selectedJumpLinkId, "engine-jump-link-1", "Jump Link should be independently selectable");
const deletedJumpLink = deleteScene.deleteJumpLink("engine-jump-link-1");
assert.equal(deletedJumpLink?.link?.id, "engine-jump-link-1", "Deleting a selected Jump Link should remove the portal relationship");
assert.equal(deleteScene.jumpLinks.length, 0, "Deleting a Jump Link should clear jumpLinks only");
assert.equal(deleteScene.selectedJumpLinkId, "", "Deleting a selected Jump Link should clear link selection");
assert.ok(deleteScene.getDevice("engine-jump-output"), "Deleting a Jump Link should leave output Jump Node in the scene");
assert.ok(deleteScene.getDevice("engine-jump-input"), "Deleting a Jump Link should leave input Jump Node in the scene");
assert.ok(deleteScene.getWire("engine-wire-output-jump"), "Deleting a Jump Link should leave the incoming visible wire");
assert.ok(deleteScene.getWire("engine-wire-jump-input"), "Deleting a Jump Link should leave the outgoing visible wire");
deleteScene.insertJumpLink(deletedJumpLink.link, deletedJumpLink.index);
assert.equal(deleteScene.getJumpLink("engine-jump-link-1")?.id, "engine-jump-link-1", "Undo-style restore should put the Jump Link back");

expectPair("output + input", createScene({ jumpLinks: [] }), "jump-output", "jump-input", true, "output-input");
expectPair("output + output", createScene({ jumpLinks: [] }), "jump-output", "jump-output-2", false, "output-output");
expectPair("input + input", createScene({ jumpLinks: [] }), "jump-input", "jump-input-2", false, "input-input");
expectPair("neutral + input", createScene({ jumpLinks: [] }), "jump-neutral", "jump-input", false, "neutral");
expectPair("self", createScene({ jumpLinks: [] }), "jump-output", "jump-output", false, "self");
expectPair("already paired", createScene({ jumpLinks: [{ id: "jump-link-1", outputJumpId: "jump-output", inputJumpId: "jump-input" }] }), "jump-output", "jump-input-2", false, "already-paired");
expectPair("matching HDMI", createScene({ jumpLinks: [] }), "jump-output", "jump-input", true, "output-input");
expectPair("HDMI to SDI mismatch", createScene({ destinationType: "sdi", destinationConnectorId: "input-sdi", jumpLinks: [] }), "jump-output", "jump-input", false, "incompatible");
expectPair("matching LC fiber", createScene({ sourceType: "fiber-lc", destinationType: "fiber-lc", sourceFiberMode: "single-mode", destinationFiberMode: "single-mode", jumpLinks: [] }), "jump-output", "jump-input", true, "output-input");
expectPair("incompatible fiber family", createScene({ sourceType: "fiber-lc", destinationType: "fiber-lc", sourceFiberMode: "single-mode", destinationFiberMode: "om4", jumpLinks: [] }), "jump-output", "jump-input", false, "incompatible");

const explicitValidation = validateJumpLinks(baseProject, { compatibilitySummary: engineCompatibilitySummary });
assert.deepEqual(explicitValidation.warnings, [], "valid project should have no Jump Link warnings");

const fallbackGreyProject = createProject({ sourceType: "sdi", destinationType: "sdi" });
fallbackGreyProject.connections.forEach(connection => {
  if (connection.from?.jumpNodeId || connection.to?.jumpNodeId) {
    connection.cableType = "jump";
    connection.customColor = "#778492";
  }
});
const repairedGreyScene = normalizeAvDesignerProject(fallbackGreyProject, { dataSource: "validation" });
const repairedOutputWire = normalizedWire(repairedGreyScene, "wire-output-jump");
const repairedInputWire = normalizedWire(repairedGreyScene, "wire-jump-input");
assert.equal(repairedOutputWire.cableType, "sdi", "loaded output-side Jump wire should repair to the real device connector cable family");
assert.equal(repairedInputWire.cableType, "sdi", "loaded input-side Jump wire should repair to the real device connector cable family");
assert.equal(repairedOutputWire.color, repairedInputWire.color, "loaded Jump physical wires with the same real connector family should share the same color");
assert.notEqual(repairedInputWire.color.toLowerCase(), "#778492", "loaded accidental input-side Jump fallback grey should be repaired visually");
assert.equal(repairedOutputWire.customColor, "", "accidental output-side Jump fallback custom color should be cleared");
assert.equal(repairedInputWire.customColor, "", "accidental input-side Jump fallback custom color should be cleared");
assert.equal(repairedOutputWire.jumpWireMetadataSource, "real-connector", "output-side Jump repair should record real connector metadata source");
assert.equal(repairedInputWire.jumpWireMetadataSource, "real-connector", "input-side Jump repair should record real connector metadata source");

const explicitGreyProject = createProject({ sourceType: "sdi", destinationType: "sdi" });
explicitGreyProject.connections.forEach(connection => {
  if (connection.from?.jumpNodeId || connection.to?.jumpNodeId) {
    connection.cableType = "sdi";
    connection.customColor = "#777777";
  }
});
const explicitGreyScene = normalizeAvDesignerProject(explicitGreyProject, { dataSource: "validation" });
const explicitGreyInputWire = normalizedWire(explicitGreyScene, "wire-jump-input");
assert.equal(explicitGreyInputWire.cableType, "sdi", "explicit custom grey should keep the real cable family");
assert.equal(explicitGreyInputWire.customColor, "#777777", "explicit custom grey should remain custom");
assert.equal(explicitGreyInputWire.color, "#777777", "explicit custom grey should remain the visible wire color");
assert.equal(explicitGreyInputWire.colorSource, "custom", "explicit custom grey should be identified as user-authored color");

const invalidProject = createProject({
  jumpLinks: [
    { id: "dup", outputJumpId: "jump-output", inputJumpId: "jump-input" },
    { id: "dup", outputJumpId: "missing-output", inputJumpId: "jump-input-2" },
    { id: "self", outputJumpId: "jump-output-2", inputJumpId: "jump-output-2" },
    { id: "bad-role", outputJumpId: "jump-neutral", inputJumpId: "jump-output" }
  ]
});
const invalidWarnings = validateJumpLinks(invalidProject, { compatibilitySummary: engineCompatibilitySummary }).warnings.join("\n");
assert.match(invalidWarnings, /duplicates link id dup/, "duplicate Jump Link IDs should warn");
assert.match(invalidWarnings, /references missing output Jump missing-output/, "missing Jump IDs should warn");
assert.match(invalidWarnings, /pairs a Jump Node with itself/, "self-pair should warn");
assert.match(invalidWarnings, /appears in multiple Jump Links/, "one Jump in multiple links should warn");
assert.match(invalidWarnings, /Output Jump jump-neutral derives role neutral/, "neutral stored as output should warn");
assert.match(invalidWarnings, /Input Jump jump-output derives role output/, "role drift should warn");

const normalizedLinks = normalizeJumpLinks([
  { id: "one", outputJumpId: "jump-output", inputJumpId: "jump-input" },
  { id: "two", outputJumpId: "jump-output", inputJumpId: "jump-input-2" },
  { id: "self", outputJumpId: "jump-input", inputJumpId: "jump-input" }
], { jumpNodeIds: new Set(["jump-output", "jump-input", "jump-input-2"]) });
assert.equal(normalizedLinks.length, 1, "normalization should enforce one link per Jump and reject self-pairs");

const normalWireProject = createProject({
  connections: [
    wire("wire-normal", deviceEndpoint("source", "output-hdmi"), deviceEndpoint("destination", "input-hdmi"), "hdmi")
  ],
  jumpLinks: []
});
const normalPlayback = resolvePlayableSignalPath({ startingWireId: "wire-normal", project: normalWireProject });
assert.deepEqual(sequenceShape(normalPlayback), ["wire:wire-normal:f"], "Play Wire should keep a normal physical wire as one visible segment");

const playbackFromOutput = resolvePlayableSignalPath({ startingWireId: "wire-output-jump", project: baseProject });
const playbackFromInput = resolvePlayableSignalPath({ startingWireId: "wire-jump-input", project: baseProject });
assert.deepEqual(sequenceShape(playbackFromOutput), ["wire:wire-output-jump:f", "teleport:jump-output>jump-input", "wire:wire-jump-input:f"], "Play Wire should resolve output segment through portal");
assert.deepEqual(sequenceShape(playbackFromInput), sequenceShape(playbackFromOutput), "Play Wire should resolve the same signal chain from either visible segment");
assert.equal(
  playbackFromOutput.some(step => step.type === "wire" && step.wireId === "jump-link-1"),
  false,
  "Play Wire should not treat a Jump Link as a physical animated cable"
);

const brokenPlayback = resolvePlayableSignalPath({
  startingWireId: "wire-output-jump",
  project: createProject({ connections: baseProject.connections.slice(0, 1) })
});
assert.deepEqual(sequenceShape(brokenPlayback), ["wire:wire-output-jump:f"], "broken portal playback should fall back to the visible segment");

const legacyProject = createProject({
  jumpLinks: [],
  jumpNodes: [
    { id: "jump-output", pairId: "legacy-pair", x: 160, y: 100, label: "Legacy Out" },
    { id: "jump-input", pairId: "legacy-pair", x: 360, y: 100, label: "Legacy In" }
  ]
});
assert.deepEqual(deriveLegacyPairJumpLinks(legacyProject), [{ id: "jump-link-legacy-pair", outputJumpId: "jump-output", inputJumpId: "jump-input" }], "unambiguous legacy pairId should derive a Jump Link");
assert.deepEqual(sequenceShape(resolvePlayableSignalPath({ startingWireId: "wire-jump-input", project: legacyProject })), ["wire:wire-output-jump:f", "teleport:jump-output>jump-input", "wire:wire-jump-input:f"], "legacy pair playback should resolve through portal");

const disconnectedProject = structuredClone(baseProject);
const adapter = new ProjectMutationAdapter({ projectData: disconnectedProject }, { cloneProjectData: false });
const beforeConnectionIds = disconnectedProject.connections.map(connection => connection.id);
const removed = adapter.removeJumpLink("jump-link-1");
assert.equal(removed.linkData.id, "jump-link-1", "disconnect removes the Jump Link");
assert.deepEqual(disconnectedProject.connections.map(connection => connection.id), beforeConnectionIds, "disconnect leaves visible connections untouched");
adapter.restoreJumpLink(removed.linkData, removed.index);
assert.deepEqual(disconnectedProject.jumpLinks, baseProject.jumpLinks, "undo disconnect restores the same Jump Link");

const missingRoleScene = createScene({ jumpLinks: baseProject.jumpLinks });
missingRoleScene.wires = missingRoleScene.wires.filter(wire => wire.id !== "wire-output-jump");
const invalidAfterWireDelete = invalidJumpLinksForScene(missingRoleScene, { jumpIds: ["jump-output"] });
assert.deepEqual(invalidAfterWireDelete.map(link => link.id), ["jump-link-1"], "deleting the role-defining visible wire invalidates the portal link");

const malformedLoopProject = createProject({
  jumpLinks: [{ id: "loop", outputJumpId: "jump-output", inputJumpId: "jump-output" }]
});
assert.ok(resolvePlayableSignalPath({ startingWireId: "wire-output-jump", project: malformedLoopProject }).length <= 3, "malformed cyclic data must terminate safely");

assert.ok(indexHtml.includes("jumpLinks: state.jumpLinks"), "project snapshot and output paths should preserve jumpLinks");
assert.ok(indexHtml.includes("state.jumpLinks = Array.isArray(data.jumpLinks) ? data.jumpLinks : []"), "project load should initialize jumpLinks");
assert.ok(indexHtml.includes("jump links:"), "output diagnostics should count Jump Links separately");
assert.ok(indexHtml.includes("function wireTraceSequence"), "editor/export Play Wire path resolver should exist");
assert.ok(indexHtml.includes("type:\"teleport\"") || indexHtml.includes('type: "teleport"'), "standalone viewer should include teleport playback steps");
assert.ok(indexHtml.includes("function renderJumpLinks"), "standalone viewer should have a Jump Link reveal layer");
assert.ok(indexHtml.includes("viewer-jump-link-reveal"), "standalone viewer should keep hidden Jump Link reveal styling addressable");
assert.ok(indexHtml.includes("viewerBezierPolyline"), "standalone viewer Jump Link reveal should use Bezier geometry");
assert.ok(indexHtml.includes("pointsToPath(points)"), "standalone viewer Jump Link reveal should render a Bezier path");
assert.ok(bridgeSource.includes("hitTestVisibleJumpLink"), "Engine bridge should hit-test visible Jump Link overlays");
assert.ok(bridgeSource.includes("selectedJumpLinkId"), "Engine bridge should preserve independent Jump Link selection");
assert.ok(bridgeSource.includes("deleteSelectedJumpLink"), "Engine bridge should delete the selected Jump Link relationship");
assert.ok(bridgeSource.includes("pairedJumpHighlightIds"), "Engine bridge should highlight, not select, the paired Jump Node");
assert.ok(rendererSource.includes("pushGradientPolyline"), "renderer should draw Jump Link overlays as sampled polylines");
assert.ok(rendererSource.includes('mode === "link-selected"'), "renderer should distinguish selected Jump Link overlays");
assert.ok(rendererSource.includes("pushJumpSelectionGlow"), "renderer should give selected Jump Nodes an orange glow");

console.info("Jump Node validation passed", {
  buildId: BUILD_ID,
  roles: {
    output: sceneJumpNodeRole(baseScene, "jump-output").role,
    input: sceneJumpNodeRole(baseScene, "jump-input").role,
    neutral: sceneJumpNodeRole(baseScene, "jump-neutral").role
  },
  playback: sequenceShape(playbackFromOutput)
});

function expectPair(label, scene, first, second, expectedValid, expectedRule) {
  const result = jumpPairCompatibility(scene, first, second, {
    compatibilitySummary: engineCompatibilitySummary
  });
  assert.equal(result.valid, expectedValid, `${label}: validity`);
  assert.equal(result.rule, expectedRule, `${label}: rule`);
}

function sequenceShape(sequence) {
  return sequence.map(segment => {
    if (segment.type === "teleport") return `teleport:${segment.fromJumpId}>${segment.toJumpId}`;
    return `wire:${segment.wireId}:${segment.reverse ? "r" : "f"}`;
  });
}

function normalizedWire(scene, wireId) {
  const wire = (scene.wires || []).find(item => String(item.id || item.sourceId || "") === String(wireId || ""));
  assert.ok(wire, `expected normalized wire ${wireId}`);
  return wire;
}

function createProject({
  sourceType = "hdmi",
  destinationType = "hdmi",
  sourceFiberMode = "",
  destinationFiberMode = "",
  destinationConnectorId = "input-hdmi",
  jumpNodes = null,
  connections = null,
  jumpLinks = null
} = {}) {
  return {
    version: 1,
    devices: [
      rawDevice("source", connector("output-hdmi", sourceType, "output", sourceFiberMode)),
      rawDevice("destination", connector(destinationConnectorId, destinationType, "input", destinationFiberMode)),
      rawDevice("second-source", connector("output-2", sourceType, "output", sourceFiberMode)),
      rawDevice("second-destination", connector("input-2", destinationType, "input", destinationFiberMode))
    ],
    jumpNodes: jumpNodes || [
      { id: "jump-output", x: 160, y: 100, label: "FOH SEND" },
      { id: "jump-input", x: 360, y: 100, label: "STAGE RECEIVE" },
      { id: "jump-neutral", x: 260, y: 220, label: "Neutral" },
      { id: "jump-output-2", x: 160, y: 200, label: "Second Out" },
      { id: "jump-input-2", x: 360, y: 200, label: "Second In" }
    ],
    connections: connections || [
      wire("wire-output-jump", deviceEndpoint("source", "output-hdmi"), jumpEndpoint("jump-output"), sourceType, sourceFiberMode),
      wire("wire-jump-input", jumpEndpoint("jump-input"), deviceEndpoint("destination", destinationConnectorId), destinationType, destinationFiberMode),
      wire("wire-output2-jump", deviceEndpoint("second-source", "output-2"), jumpEndpoint("jump-output-2"), sourceType, sourceFiberMode),
      wire("wire-jump-input2", jumpEndpoint("jump-input-2"), deviceEndpoint("second-destination", "input-2"), destinationType, destinationFiberMode)
    ],
    jumpLinks: jumpLinks ?? [{ id: "jump-link-1", outputJumpId: "jump-output", inputJumpId: "jump-input" }]
  };
}

function createScene(options = {}) {
  const project = createProject(options);
  const devices = new Map();
  project.devices.forEach(item => {
    const source = item.template.connectors[0];
    devices.set(item.instanceId, {
      id: item.instanceId,
      label: item.name,
      kind: "device",
      connectors: [source],
      connectorsById: new Map([[source.id, source]])
    });
  });
  project.jumpNodes.forEach((node, index) => {
    const device = normalizeEngineJumpNode(node, index);
    device.connectorsById = new Map(device.connectors.map(item => [item.id, item]));
    devices.set(device.id, device);
  });
  const wires = project.connections.map(connection => ({
    id: connection.id,
    sourceId: connection.id,
    fromDeviceId: connection.from.deviceId || connection.from.jumpNodeId || "",
    fromConnectorId: connection.from.connectorId || "jump-center",
    toDeviceId: connection.to.deviceId || connection.to.jumpNodeId || "",
    toConnectorId: connection.to.connectorId || "jump-center",
    cableType: connection.cableType,
    fiberMode: connection.fiberMode || ""
  }));
  return {
    devices: [...devices.values()],
    wires,
    jumpLinks: structuredClone(project.jumpLinks || []),
    getDevice(id) {
      return devices.get(String(id || "")) || null;
    },
    getWire(id) {
      return wires.find(wire => wire.id === id) || null;
    },
    jumpLinkForNode(id) {
      return this.jumpLinks.find(link => link.outputJumpId === id || link.inputJumpId === id) || null;
    }
  };
}

function createEngineScene() {
  const scene = new SceneGraph();
  scene.setData({
    devices: [
      engineDevice("engine-source", 180, 260, connector("engine-output-hdmi", "hdmi", "output")),
      normalizeEngineJumpNode({ id: "engine-jump-output", x: 400, y: 300, label: "Output Jump" }, 0),
      normalizeEngineJumpNode({ id: "engine-jump-input", x: 680, y: 470, label: "Input Jump" }, 1),
      engineDevice("engine-destination", 820, 430, connector("engine-input-hdmi", "hdmi", "input"))
    ],
    wires: [
      engineWire("engine-wire-output-jump", {
        fromDeviceId: "engine-source",
        fromConnectorId: "engine-output-hdmi",
        fromAnchorId: "engine-output-hdmi-main",
        fromSide: "right",
        toDeviceId: "engine-jump-output",
        toConnectorId: JUMP_NODE_CONNECTOR_ID,
        toAnchorId: JUMP_NODE_CONNECTOR_ID,
        toSide: "center",
        color: "#32b6ff"
      }),
      engineWire("engine-wire-jump-input", {
        fromDeviceId: "engine-jump-input",
        fromConnectorId: JUMP_NODE_CONNECTOR_ID,
        fromAnchorId: JUMP_NODE_CONNECTOR_ID,
        fromSide: "center",
        toDeviceId: "engine-destination",
        toConnectorId: "engine-input-hdmi",
        toAnchorId: "engine-input-hdmi-main",
        toSide: "left",
        color: "#fb7904"
      })
    ],
    jumpLinks: [
      { id: "engine-jump-link-1", outputJumpId: "engine-jump-output", inputJumpId: "engine-jump-input" }
    ],
    racks: []
  });
  return scene;
}

function engineDevice(id, x, y, connectorRecord) {
  const direction = connectorRecord.direction === "input" ? "input" : "output";
  const side = direction === "input" ? "left" : "right";
  return {
    id,
    sourceId: id,
    sourceKind: "device",
    kind: "device",
    x,
    y,
    width: 120,
    height: 80,
    label: id,
    connectors: [{
      ...connectorRecord,
      side,
      x: side === "left" ? 0 : 120,
      y: 40,
      anchors: [{
        id: `${connectorRecord.id}-main`,
        side,
        x: side === "left" ? 0 : 120,
        y: 40,
        primary: true
      }],
      primaryAnchorId: `${connectorRecord.id}-main`
    }],
    portCount: 1
  };
}

function engineWire(id, overrides = {}) {
  return {
    id,
    sourceId: id,
    fromPortIndex: 0,
    toPortIndex: 0,
    fromUsesRealConnector: true,
    toUsesRealConnector: true,
    usesRealConnectorEndpoints: true,
    routeStyle: "bezier",
    routePoints: [],
    cableType: "hdmi",
    label: id,
    ...overrides
  };
}

function assertClosePoint(actual, expected, message, tolerance = 0.01) {
  assert.ok(actual, `${message}: actual point should exist`);
  assert.ok(expected, `${message}: expected point should exist`);
  assert.ok(Number.isFinite(Number(actual.x)), `${message}: actual x should be finite`);
  assert.ok(Number.isFinite(Number(actual.y)), `${message}: actual y should be finite`);
  assert.ok(Math.abs(Number(actual.x) - Number(expected.x)) <= tolerance, `${message}: x ${actual.x} should be close to ${expected.x}`);
  assert.ok(Math.abs(Number(actual.y) - Number(expected.y)) <= tolerance, `${message}: y ${actual.y} should be close to ${expected.y}`);
}

function hitJumpLinkFromOverlays(overlays = [], point = {}, tolerance = 8) {
  let best = null;
  overlays.forEach(overlay => {
    const points = Array.isArray(overlay.points) ? overlay.points : [];
    if (points.length < 2) return;
    const hit = distanceToPolyline(points, point);
    if (hit.distance <= tolerance && (!best || hit.distance < best.distance)) {
      best = { ...overlay, distance: hit.distance, point: hit.point };
    }
  });
  return best;
}

function rawDevice(id, connectorRecord) {
  return {
    instanceId: id,
    name: id,
    template: {
      id: `${id}-template`,
      connectors: [connectorRecord]
    }
  };
}

function connector(id, type, direction, fiberMode = "") {
  return {
    id,
    label: id,
    type,
    direction,
    fiberMode
  };
}

function wire(id, from, to, cableType, fiberMode = "") {
  return {
    id,
    cableType,
    fiberMode,
    from,
    to
  };
}

function deviceEndpoint(deviceId, connectorId) {
  return { deviceId, connectorId };
}

function jumpEndpoint(jumpNodeId) {
  return { jumpNodeId };
}
