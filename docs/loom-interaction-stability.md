# Loom interaction and rendering stability

Build: **54.38.96**, tested 2026-10-16 on macOS with real Google Chrome (headless).

## Baseline and scope

- Branch: `engine-prototype`.
- Starting local and fetched remote SHA: `78a58720e766a68288e636396c64cb1909e9a200`.
- Tracked tree was clean. Existing untracked faceplates, `Masters/`, backups,
  artwork and unrelated PDF probe scripts were not modified or staged.
- No Legacy behavior, factory data, project files or electrical topology changed.
- The existing first-priority Loom creation dispatch remains in place.
- No persisted schema migration, extra Loom records or synthetic conductor links.

## Findings and fixes

### Waiting Jump deletion

The delete path detached the persisted Jump association but did not explicitly
clear an affected active continuation. In addition, moving a waiting Jump updated
the rendered terminal anchor but left the saved `sideB` at its old location.
Detaching could therefore change the final spline shape. The terminal anchor also
became a duplicate spline control at the standalone endpoint.

Deleting the entry Jump now copies its current center to the stable terminal
anchor and, for a waiting Loom, to `sideB`. Authored point records and IDs remain;
duplicate endpoint coordinates are omitted only from effective spline controls.
The affected continuation/tool, button, cursor, hover and temporary preview are
cleared. Deleting an unrelated Jump does not cancel a new Loom drawing session.
Existing deletion history restores the Jump, association and exact geometry in
one undo step; undo does not restart the tool.

Important reproduction limit: on the starting commit, the simple unpaired
attach/move/delete sequence already left the tool inactive in our fixture. We
confirmed the endpoint/shape defect and separately exercised deletion during an
active affected continuation. We do not claim the exact stale-tool symptom was
reproduced by that simple sequence on every project.

Real gestures now verify normal click selection, Inspector, rename, save/reload,
Delete and context-menu dissolve after detachment. Cables survive dissolution.
Paired Jump A/B deletion, moving before deletion, unpair/re-pair and Loom deletion
with remaining Jumps also pass.

### Shadow rendering

The baseline's static Loom body was already suppressed during preview. The actual
old-route shadow was its **hover outline**, which still read the canonical plan
while the body and selected outline used the moving preview. A before-fix Chrome
screenshot captured that separate blue old path.

`loomRenderPresentation()` selects the matching transient plan or canonical plan
for hover, selection, controls and labels. An unrelated preview cannot mask the
correct Jump preview. Static canonical Loom ranges remain suppressed while the
replacement is drawn. Browser instrumentation checks actual GL submissions for
overlap with suppressed ranges, not only intended flags.

Transient buffers are cached per physical section. After the initial allocation,
only changed section vertices upload. Pointerup, Escape and disposal release the
preview buffers. Escape now includes `loomHeadDrag` in active-interaction cleanup;
previously it could allow mouseup to commit a supposedly cancelled drag.
No perpetual repaint loop was added.

### Independent physical sections

Existing `jumpRouting.entryAnchorId` partitions the ordered authored points:
section 0 owns Side A and points before the anchor; section 1 owns Side B and
points after it. Trunk hit testing supplies the actual section index. Dragging
translates only that section's editable coordinates, with existing snapping and
axis locking. Both Jump gateways stay fixed unless dragged themselves.

Breakout spread normals now use each section's local head/gateway geometry,
instead of the distant pair of free heads. Explicit `loomEntrySide` remains
authoritative; otherwise Jump-routed conductors use stable logical endpoint
order, preventing a large move from swapping the unaffected section's cable fan.
Standalone endpoint proximity behavior remains unchanged.

During drag the canonical root is unchanged. Release commits one command and one
SceneGraph Loom rebuild. Exact unchanged-section trunk and breakout coordinates,
Jump A/B movement, undo/redo and save/reload are asserted for both route styles.
Dedicated older Loom Portal behavior remains supported and tested.

### Marquee and deletion

Engine marquee intersects visible physical trunk segments only. It never selects
a Loom just because a rectangle crosses the teleport gap or hidden conductors.
`selectedLoomIds` provides multi-selection while `selectedLoomId` remains a
single-selection compatibility accessor. Existing Shift-toggle behavior applies.
Orange selection outlines use visible sections. One Loom gets its Inspector;
multiple/mixed objects get a count/name summary.

Mixed Delete reuses existing device/rack/wire removal records inside one command.
Dissolving selected Looms does not add their cables to the deletion set. A selected
device still deletes its cables under existing semantics. Undo/redo restores the
complete mixed state. Injected failures after cable removal and after object
removal restore root data, selection and Engine history position. UI notifications
run outside rollback so a later presentation exception cannot undo data behind
an already recorded history command.

### Jump hover

Enlarged Loom-associated Jumps now use their rendered circular radius for pointer
hit testing. Ordinary paired-Jump hover overlays are allowed for Loom pairs; other
permanent/selection pair indicators remain suppressed. Both directions reveal
the curved connection and leaving the region hides it. No physical cable is
created. Blue entry/orange exit colors, enlarged gateways, centered red occupied
unpaired status and purple paired-empty status remain covered by Chrome checks.

## Verification

### Automated checks

- `node --test test/*.test.mjs`: **1,314 passed; 0 failed; 0 skipped**.
- New `test/loomInteractionStability.test.mjs`: 11 focused tests, including
  exact section/breakout parity, stable IDs, reload/output, marquee, rendering
  ownership, buffer upload/disposal and extreme section translation.
- New `scripts/loom-interaction-stability-smoke.mjs`: 37 result entries covering
  actual creation/deletion, both route styles, whole/end/section/Jump movement,
  Escape, history, reload, enlarged hover, multiple/mixed marquee, atomic deletion
  and rollback, context dissolve, active/unrelated tool state and performance.
  Zero page errors; one committed geometry rebuild and command per release.
- `managed-loom-stability-smoke.mjs`: passed, including 64-circuit drag, endpoint
  movement, hover priority, rewiring and no-prompt dissolution.
- `unified-jump-loom-browser-smoke.mjs`: passed empty pairing, centered status dots,
  already/later/reverse pairing, route preservation, unpair/re-pair, deletion,
  history, save/reload, output and 8/32/64-circuit stress.
- `loom-portal-browser-smoke.mjs`: passed old dedicated Portal editing, exact
  anchors, history/reload, offline output and stress coverage.
- `loom-tool-jump-browser-smoke.mjs` and
  `loom-creation-priority-browser-smoke.mjs`: passed tool lifecycle, mutual
  exclusion, snapping, waypoints, repeated cancellation and creation priority.
- `output-pipeline-validation.mjs`, `jump-node-validation.mjs`,
  `preview-ownership-validation.mjs`, `connector-operational-status-validation.mjs`:
  passed.
- `npm run check:output-viewer`, `check:pdf`, `check:cable-schedule`: passed.
  Viewer JS: 350,324 bytes, 49 modules, reproducible, current hash
  `5a48d7c18087fb8491ea89ed2c3565a5a2117aee6307126b6e19bc4413c4af6d`.
- Syntax checks: changed Engine modules, fixture and browser/Node tests; inline
  application syntax covered by output validation. `git diff --check`: clean.

Cable records are compared deeply, including IDs, source/destination endpoints,
types, numbers, lengths and notes. Section edits preserve the entire Cable
Schedule and Signal Chain results. Dissolution preserves cables while releasing
Loom membership. Mixed device deletion intentionally retains normal device/cable
deletion semantics. No transient preview data is serialized.

### Output and PDF

`loom-stability-output-smoke.mjs` tests the actual moved Bezier and Orthogonal
saved projects through the app's HTML download and production PDFKit toolbar.
Local-file HTML opens with network requests blocked. Simulated hosted HTML uses
the same project. Both match committed section geometry and label settings.
Float32 GPU Loom vertices equal Output Viewer/vector primitives exactly. Static
outputs have no paired-Jump teleport line or stale prior-route geometry.

`engine-output-html-smoke.mjs` also passes offline download, simulated Publish
storage/authentication, reports, Jump navigation and 100/400-device output cases.
`engine-output-pdf-smoke.mjs` plus `inspect-engine-output-pdf.py`: 7 checks passed.
`engine-pdf-production-smoke.mjs` plus `inspect-pdf-production.py`: 23 passed.
`engine-pdf-browser-smoke.mjs`: toolbar download and failure recovery passed.

The two moved-Loom PDFs have two pages each. Drawing pages contain 4,076/2,478
move-to operations (Bezier/Orthogonal), 8,158/4,962 line-to operations, 108 curves
and no image `Do` operations in these vector-only fixtures. Each drawing has two
Jump navigation annotations. Poppler rendered both, and drawing/report pages
were visually inspected. Adobe Acrobat, macOS Preview and native Chrome PDF
navigation were not manually tested in this pass. No live production Publish
upload was performed; hosted tests used local interception/simulated storage.

### Performance

Measured on the final focused Chrome run, milliseconds (not whole-frame FPS):

| Circuits | Section preview mean/max | Jump preview mean | Whole preview mean/max | Hover max | Marquee |
| --- | --- | --- | --- | --- | --- |
| 8 | 0.088 / 0.200 | 0.063 | 0.050 / 0.100 | 0.100 | 0.600 |
| 32 | 0.075 / 0.200 | 0.063 | 0.025 / 0.100 | 0.100 | 0.300 |
| 64 | 0.038 / 0.100 | 0.025 | 0.025 / 0.100 | 0.100 | 0.200 |

Eight pointer updates per drag. Timer precision and machine load affect these
small measurements. All three sizes recorded zero composition, Loom geometry,
wire-index, static-wire and static-scene rebuilds during dragging, hover and
marquee. At release: one SceneGraph Loom rebuild; existing paired-Jump commit
paths invoke the renderer wire rebuild twice (also seen on baseline), standalone
once. No per-frame schedule or project normalization work was added. The separate
64-circuit managed-Loom smoke used 15 frames and measured 0.140 ms mean trunk
preview / 0.200 ms maximum, also one canonical rebuild per drop.

### Baseline failures, not weakened

Both failures were rerun against an independently archived `78a5872` application
and against this change:

1. `canvas-layout-objects-validation.mjs:298` expects a literal
   `projectSnapshotData({ forEngine: true })`; the existing code also supplies
   `useEngineRoot: false`. Same assertion fails on both revisions.
2. `bidirectional-jump-smoke.mjs:106` compares an original explicit
   `manualRouteStyle: undefined` property with its JSON-reloaded absent property.
   Same failure on both revisions, after six ordinary Jump gesture, role,
   pairing, history, reload and playback checks pass.

The assertions remain unchanged. The unified Loom/Jump suite separately verifies
ordinary Jump status colors and the relevant unpair/re-pair workflows.

## Evidence and changed files

Local acceptance artifacts (not committed):

- `/tmp/loom-recording-contact.png`: supplied recording sampling.
- `/tmp/loom-baseline-mid.png`: reproduced baseline old-route hover shadow.
- `/tmp/wirenexus-loom-interaction-stability/`: initial, mid-drag, pointerup,
  second movement, redo, hover, mixed selection, detached Inspector and viewer
  screenshots; `results.json`; moved `.avd`, `.html`, `.svg`, `.pdf` fixtures.
- `/tmp/loom-stability-bezier-contact.png` and
  `/tmp/loom-stability-orthogonal-contact.png`: inspected movement contact sheets.
- `/tmp/loom-bezier-pdf-1.png`, `/tmp/loom-orthogonal-pdf-1.png`: inspected PDF pages.
- `/tmp/loom-release-node.log`, `/tmp/loom-final-*.log`: test output.
- `/tmp/loom-baseline-layout.log`, `/tmp/loom-baseline-ordinary-jump.log`:
  independently reproduced baseline failures.

Scoped files: `index.html`; `src/engine/{productionBridge,renderer,sceneGraph,
hitTest,loomGeometry}.js`; generated output viewer bundle; new stability fixture,
Node test, two Chrome scripts and this report; four validators' cache fingerprints;
existing LED marquee test harness dependency; unified Jump/Loom smoke hover setup.
The LED assertions remain intact. The unified smoke moves off the gateway before
asserting no resting pair overlay, consistent with the newly requested hover rule.
