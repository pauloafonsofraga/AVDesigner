# Attached Node Rotation

Build 54.38.120. Scope: connector visual orientation on existing adapters and
breakouts only. No new rotation system or project schema.

## Audit and Coordinate Flow

Starting local and fetched remote HEAD were both
`6d4c76b34a15c428a1b183d32f1d85ef402ea019`, newer than the requested historical
baseline `7bac48ff996a2a4b7b61d07ee1fd6b63349011a6`.

The existing `adapterRotation.js` remains byte-for-byte unchanged. The rotation
handle uses the rotated body's bounding box. Rotation is about the body's center,
snaps to 15-degree steps, and has a stronger cardinal snap within 12 degrees.
All 24 states from 0 through 345 degrees remain supported. Existing arbitrary
persisted rotations still normalize and render without quantization changes.

Before this fix, SceneGraph, the connector spatial index, wire endpoints,
`connectorAnchorRenderPoint`, `adapterWorldPoint`, body textures, relationship
lines and output anchors already applied rotation correctly. The separate live
connector overlay drew marker details in screen-horizontal axes. Standalone
labels rotated their anchor but not their relative offset/alignment; shared-bus
captions did not rotate their anchor at all.

The corrected flow is:

1. Authored local connector/anchor coordinates pass through the existing
   adapter-center transform exactly once to produce world anchors.
2. Marker vertices are oriented around that already-resolved world anchor.
   `attachedConnectorBasis` reuses `rotateAdapterPoint` at a zero origin to
   obtain the orientation basis, without translating the anchor a second time.
3. The same basis rotates caption offsets. Shared-bus captions first resolve
   their existing group anchor through the existing adapter transform.
4. Text remains upright and unmirrored. Alignment follows the rotated inward
   direction, centered at vertical orientations. Text, fonts, sizes, colors,
   zoom thresholds and multi-line rules are unchanged.

## Preserved Behavior

- Adapter and breakout classification both resolve to the existing `adapter`
  kind. Ordinary-device geometry is unchanged and tested byte-for-byte.
- Body dimensions, authored positions, pivot, controls, angle steps, snapping,
  connector IDs, anchor IDs, relationships and physical definitions are unchanged.
- Solid circles are rotationally symmetric. Segmented colors and not-working
  marks inherit orientation; circular selection/hover geometry stays centered
  at the unchanged anchor. The spatial index and hit tolerance are untouched.
- Existing cable IDs, endpoints, type, length, labels and compatibility are not
  rewritten. No history, save or Cable Schedule code changed.
- The Engine currently draws circular canvas connector markers, not node-library
  thumbnail images as connector icons. Custom image metadata/bytes are preserved;
  this fix does not introduce image-backed canvas nodes or alter library/report
  artwork. Existing adapter body texture rotation remains unchanged.
- The helper is local marker arithmetic: one basis per marker or caption, no
  new scene rebuild, asset load, image decode, texture upload or source-image
  mutation. Drag/rotation/hover remained functional in Chrome. This was not a
  large-scene performance benchmark.

## Verification

Production checks ran from an isolated checkout of the staged tree, without
the unrelated local Device JSON Import development. A separate fetched-baseline
tree was served read-only for the same Chrome scenario before/after comparison.

- 26 new focused tests cover every existing rotation state on one-to-one,
  fan-out, shared-bus and real segmented Powerlock markers, including operational
  marks. They compare all marker vertices and colors against one rotation of
  baseline geometry, unchanged anchors, hit targets/tolerance, stable IDs,
  physical endpoints, immutable source data and JSON reload.
- Label integration tests exercise the actual shared renderer through its SVG
  context, including rotated shared-bus anchors and readable text. Ordinary
  devices retain identical marker meshes and horizontal label offsets.
- Existing rotation, persistence, bounds and vector-output tests remain intact.
  The isolated shared-bus label test harness imports the new dependencies; none
  of its zoom, module-caption or wrapping assertions were weakened.
- Full Node suite: **1,751 passed**, zero failures/skips.
- All **16 static validators passed**. Output Viewer bundle is reproducible and
  current; PDF and Cable Schedule bundles are current. Embedded app and changed
  JS syntax checks and `git diff --check` passed.
- Actual Chrome acceptance uses the existing rotation handle for all 24 states
  on a USB-C-to-HDMI adapter and a breakout. USB-C and HDMI cables are attached.
  Every connector is hovered, right-click-selected and pressed to start its
  existing connect/rewire interaction, then cancelled. IDs/endpoints survive.
  Existing body drag, undo/redo and project serialization/reload are verified.
- Standalone HTML opens with the browser offline. The same Output Viewer runtime
  renders connector orientation in technician/read-only mode. Actual Publish
  preparation is exercised with mocked private storage/API calls; its device,
  connector and wire geometry matches downloaded HTML. No live upload occurred.
- Actual PDF export succeeded. Its drawing page was rendered with Poppler and
  inspected, and connector text was checked with pypdf. Shared renderer primitives
  and label routines give Canvas/Viewer/HTML/Publish/vector-PDF parity.

Evidence root: `/tmp/wirenexus-attached-rotation-2026-10-21`.
`before/` and `after/` contain the same-scene Chrome screenshots, offline HTML,
prepared Publish HTML and PDFs. Inspected images include
`before/offline-rotated-adapters.png`, `after/offline-rotated-adapters.png`,
`after/breakout-180-interaction.png`, and `after/pdf-page.png`.
The original pre-edit Chrome reproduction is also retained at
`/var/folders/hq/kkzckjvn6h5_fpphh8y2ks3r0000gn/T/wirenexus-adapter-rotation-UCG1iV`.

## Files and Delivery

Production: `src/engine/attachedConnectorOrientation.js`,
`src/engine/renderer.js`, regenerated `src/engine/generated/outputViewerBundle.json`.
Build fingerprints: `index.html`, `src/engine/productionBridge.js`, and the
existing canvas-layout-objects, connector-operational-status, jump-node and
preview-ownership validators.
Tests: `test/attachedConnectorOrientation.test.mjs`,
`test/sharedBusOverlay.test.mjs`, `scripts/adapter-rotation-browser-smoke.mjs`.
Documentation: this report.

All 102 pre-existing protected files were checked against their original hashes
(reversing only this task's intended build-string changes in `index.html`). The
49 unrelated `index.html` additions and 40 `src/personalDefinitions.js` additions
remain unstaged. Artwork, faceplates, Masters, backups and untracked import work
were not removed or committed. No reset, stash, clean, Legacy edit, deployment
or release tag was used. The delivery response records the final commit and the
verified matching `origin/engine-prototype` SHA.

Limitations: acceptance uses fresh headless real-Chrome profiles and deterministic
fixtures, not the user's live project/browser. Cable connections are seeded;
real pointer connect/rewire initiation and cancellation are tested without
rewriting them. Publish is prepared but not deployed. Image-backed canvas nodes
are not an existing supported renderer mode and were not added. Large-scene
latency and physical hardware behavior are outside this focused correction.
