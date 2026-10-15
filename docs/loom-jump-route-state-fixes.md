# Loom / Jump route and state corrections

## Baseline

Starting local and fetched remote SHA were both
`08f01592608a6daddfc4e199bf25ec0e833ab987` (54.38.93).
This correction uses build **54.38.94 - Loom Jump Route and State Fixes**.

## Causes and fixes

### Route geometry

`attachDrawingLoomToJump` already retained clicked corners and `routeStyle` in
canonical project data. The straight-line reproduction was in `loomGeometry`:
the terminal Jump anchor was passed to `splitLoomRouteAtAttachment` as another
spline control, followed by a duplicate terminal endpoint. A normal two-point
Bezier therefore became a collinear custom spline. Before the fix, a reproduction
from (100,100) to (600,350) had maximum deviation from its chord of 29.043 units
before attachment and approximately zero afterward.

The same whole-route sampling let controls beyond the teleport gap influence the
first section's tangents. The baseline did not discard the authored `routePoints`
array; it interpreted the stable boundary anchor incorrectly.

`loomGeometry` now treats `entryAnchorId` as the endpoint boundary and samples each
visible section with the existing `loomTrunkPoints`. Section A uses only its
original authored controls; section B uses only continuation controls. No new
routing algorithm, saved mode or Portal type is introduced. Canonical route points,
ordering, IDs, counter, style and association remain unchanged. Orthogonal paths
retain their elbows, with no diagonal sections. The old dedicated Portal splitter
is unchanged.

### Pairing lifecycle

`completeJumpLinkCreate` now finds a waiting Loom on either member only after the
validated pair has been persisted, added to the scene, recorded in history and
marked committed. It calls the existing `beginLoomContinuation` at the owner's
partner. Initial preview uses the pair gesture's current pointer world position,
not a deferred pointer move. Preview activation creates no history command.

Loom placement commits corners on pointerdown, so the pair's pointerup cannot
place one. An additional `awaitingPointerDown` guard prevents the completion click
or synthetic double-click from finalizing the newly activated preview. The next
deliberate pointerdown clears the guard and becomes the first corner. Invalid pair
validation does not enter continuation.

Escape retains the pair, Loom and first section. Undoing attachment or pairing
invalidates the transient continuation through `refreshLoomComposition`, without
removing cables. Redo restores the saved routing/association; after an intentional
cancellation or history replay, the existing simple-click resume remains available.

### Shared visual derivation

`jumpNodeVisualState` derives occupancy from an ordinary local cable **or** a Loom
association. Renderer helpers all consume that model. Unpaired occupied Jumps
show a centered red dot; paired empty ordinary Jumps still show centered purple.
Paired occupied Jumps use the normal directional presentation, without purple.

`sceneJumpNodeRole` uses the Loom's entry identity to derive Output/blue
(`#32b6ff`) and its actual partner to derive Input/orange (`#fb7904`). It does not
depend on pair gesture direction, device wires, or completion of the far section.
Electrical base roles and connector compatibility remain unchanged. Existing 2.4x
Loom sizing, hit targets, ring design and hover animation remain in place.

## Verification

- Full Node suite: **1,303 passed, 0 failed, 0 skipped**.
- Focused Loom/Jump/bidirectional suite: **167 passed, 0 failed, 0 skipped**.
- Eleven new focused regressions cover 0/1/2 corners in both styles, section
  independence, reload, output parity, waiting red/ordinary purple, blue/orange,
  larger bodies, both pair directions, rejection and completion-click guarding.
- Chrome acceptance covers already-paired Bezier with two corners, later-paired
  Orthogonal with two corners, and the reverse pair gesture. It checks attach,
  pair and continuation undo/redo, Escape/resume, stable saved route data, member
  cable preservation, movement, deletion and dissolution. Ordinary purple/red
  states are tested separately.
- The same completed scenes are checked in network-blocked HTML, simulated hosted
  HTML and downloaded production PDFs. No live hosted deployment was performed.
- All three generated bundle checks pass; Output Viewer is reproducible/current.
  PDF and Cable Schedule bundles are unchanged/current. Syntax and diff checks pass.
- Production PDF inspection: **23 passed, 0 failed**. Engine vector PDF inspection:
  **7 passed, 0 failed**, including deterministic repeat, report and pagination checks.
- No PDF navigation implementation was changed. New Loom PDFs retain internal
  reciprocal navigation and are rendered for visual inspection.

Existing script matrix: **14 passed, 2 baseline failures, 0 skipped**:

| Script under `scripts/` (`.mjs`) | Result |
| --- | --- |
| jump-node-validation | Pass |
| connector-operational-status-validation | Pass |
| preview-ownership-validation | Pass |
| canvas-layout-objects-validation | Baseline failure |
| output-pipeline-validation | Pass |
| jump-node-hold-smoke | Pass |
| bidirectional-jump-smoke | Baseline failure |
| jump-node-glow-browser-smoke | Pass |
| jump-scoped-connector-browser-smoke | Pass |
| loom-portal-browser-smoke | Pass |
| managed-loom-stability-smoke | Pass |
| loom-tool-jump-browser-smoke | Pass |
| output-viewer-smoke | Pass |
| engine-output-html-smoke | Pass |
| engine-output-pdf-smoke | Pass |
| engine-pdf-browser-smoke | Pass |

Both baseline failures were run on untouched `08f0159` before editing and again
afterward. Their assertion messages match:

- `canvas-layout-objects-validation.mjs:298`: old literal project-load snapshot
  expression, while the baseline includes `useEngineRoot: false`.
- `bidirectional-jump-smoke.mjs:106`: missing versus explicitly undefined
  `manualRouteStyle` after JSON reload. The same six pairing/navigation/playback
  checks pass before this assertion on both baseline and corrected versions.

Evidence logs: `/tmp/wirenexus-four-baseline-*.log`,
`/tmp/wirenexus-four-validation-results.json`, `/tmp/wirenexus-four-full.tap`,
`/tmp/wirenexus-four-focused-all.tap`, and `/tmp/wirenexus-four-browser-accepted.log`.
Screenshots/PDFs: `/tmp/wirenexus-unified-jump-loom/`, including
`later-paired-waiting-red.png`, `reverse-paired-auto-resume.png`,
`pass-b-paired-completed.png`, `pass-b-later-paired-completed.png`, and their
offline-viewer and rendered PDF counterparts.

## Scope

Changed production functions are confined to Engine `loomGeometry`,
`sceneJumpNodeRole`/`jumpNodeVisualState`, renderer Jump visual helpers, and the
pair/continuation lifecycle in `productionBridge`. Other changes are focused
tests, build/cache fingerprints, the generated viewer bundle and this report.
Legacy, Rack, PDF navigation, Device Editor, connector compatibility, factory data,
and unrelated faceplates/artwork/backups/Masters are untouched.

Real Google Chrome was used. Acrobat, macOS Preview, Safari and physical mobile
viewers were not manually tested.

## Performance fixture diagnosis

The initial combined run stalled restoring the 64-cable waiting scene. Fresh Chrome
processes reproduced it, so this was not dismissed as browser cleanup. A native
sample showed a busy renderer, and a debugger attached before restore captured
`restoreSnapshot -> setWireMode -> freezeOrthogonalRoute -> orthogonalRoutePoints
-> findOrthogonalGridRoute`. Those Legacy functions are unchanged from `08f0159`.
The fixture had inherited global Orthogonal ordinary-wire mode, with 64 parallel
test cables on the same connector pair. Restore was freezing those ordinary-wire
routes before Engine continuation could run.

The stress fixture now uses Bezier for ordinary cables while explicitly asserting
that the **Loom's saved style remains Orthogonal**. This separates the requested
Loom preview measurements from Legacy ordinary-wire route freezing; no production
Legacy code or Loom assertion was removed or weakened. Each size also starts in a
fresh Chrome process. This task does not claim to fix that Legacy restore stall.
Diagnostic evidence: `/tmp/wirenexus-four-stall-stack.log` and
`/tmp/wirenexus-four-renderer-stall.sample.txt`.

Final Chrome run exited successfully with zero page errors:

| Loom circuits | Drag geometry mean (ms) | Pointer update max (ms) | Per-frame composition/index/full-renderer rebuilds |
| --- | --- | --- | --- |
| 8 | 0.047 | 0.40 | 0 / 0 / 0 |
| 32 | 0.129 | 0.50 | 0 / 0 / 0 |
| 64 | 0.165 | 0.30 | 0 / 0 / 0 |

Each fixture sampled 17 changed drag-preview frames plus continuation and hover
input. A drop performs one canonical geometry/index rebuild and two existing
renderer buffer updates. Pointer-update timings are in-browser CPU measurements;
Playwright input round trips (about 17-18 ms) are not presented as render time.
Cached composition/snapping sessions remain in use; no per-frame schedule or
whole-project normalization was added.

## Changed files

- `src/engine/loomGeometry.js`
- `src/engine/jumpNodeModel.js`
- `src/engine/productionBridge.js`
- `src/engine/renderer.js`
- `src/engine/generated/outputViewerBundle.json` (generated)
- `test/loomJumpAssociation.test.mjs`
- `test/loomJumpRegressions.test.mjs`
- `scripts/unified-jump-loom-browser-smoke.mjs`
- `scripts/canvas-layout-objects-validation.mjs` (build identity only)
- `scripts/connector-operational-status-validation.mjs` (build identity only)
- `scripts/jump-node-validation.mjs` (build identity only)
- `scripts/preview-ownership-validation.mjs` (build identity only)
- `index.html` (build/cache identity only)
- `docs/loom-jump-route-state-fixes.md`
