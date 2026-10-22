# Prompt 4/8: Animated Modular Card Reordering

Build 54.38.126. Starting local and fetched remote HEAD were both
`870b26e66af07e7d2e3b31c766c8546523f2ef8c`, branch `engine-prototype`.
This phase changes Engine card reordering only. No deployment, release tag,
Prompt 5, new modular schema, or PDF production repair.

## Architecture and baseline

The existing Device Editor already had stable card-slot drag sessions, compact
authoring insertion, collision chains in `modularDeviceLayout.js`, screen-space
lane hysteresis, pointer capture, and a 150 ms placement-motion interpolator.
Dynamic SVG card owners temporarily replace baked Engine card artwork. Installed
connector IDs are derived from slot ID and card-local connector ID, and card-local
coordinates are projected into the resolved chassis layout.

The old card gesture used compact insertion while chassis connector dragging used
persistent lanes. It could compact intentional gaps and move reservations without
distinguishing authored physical bays from flexible assemblies. The generic snap
guide returned early during a drag, so it did not show a card insertion target.
Outside releases were converted into clamped placement instead of rejected.
Motion frames also rebuilt the editor preview, normalizing a cloned template and
recreating SVG owners rather than retaining the card graphics.

Before production edits, the native Chrome regression recorded zero target
indicators and a changed draft after releasing outside the chassis. Its original
outside-drop assertion failed. Evidence: `/tmp/wirenexus-prompt4/baseline-browser.log`.
The baseline log's additional `unchanged` field compared different snapshot shapes;
it is not evidence of canonical mutation during hovering. That comparison was
replaced with like-for-like template comparisons. Existing collision-chain and
connected-card tests supplied the other architecture/safety baseline coverage;
not every matrix scenario was independently reproduced in baseline Chrome.

## Ownership policy

This operation is **reordering a flexible slot/card assembly**, not moving a card
assignment between physical bays. Only the slot's placement changes. Slot ID,
installed definition reference, card IDs, connector IDs, connector overrides,
capabilities, card-local geometry, labels and cable endpoints remain unchanged.

- An occupied historical slot without an explicit `physicalLayout` is movable.
- An authored `physicalLayout` is conservatively treated as a fixed reservation.
  Its position, side and span are never changed by this gesture.
- Empty slots and slots with `locked: true` stay fixed. A locked device cannot
  start or commit a card reorder. Chassis connectors also stay fixed.
- Cards cannot be dragged into fixed empty bays as an assignment shortcut.
  Existing Insert/Replace/Remove Card and Delete Card Slot operations remain the
  way to change assignments. Existing compatibility/card-safety validation applies.
- Prompt 3 card `editingBounds` remain authoring-only and do not determine the
  physical placement footprint. Structural spans and side masks still come from
  the existing modular layout resolver.

There is no ID regeneration, delete/reinsert, endpoint rewriting, physical-slot
migration, or new persisted animation state. Legacy retains its old drag path.

## Solver, interaction and rendering

`resolveModularCardReorder` wraps the existing insertion collision-chain solver.
Optional fixed-ID reservations and a maximum end lane filter its candidates and
fallback; omitted options preserve prior solver behavior. Candidates that move
reservations or extend the chassis reject rather than silently choosing another
target. Local collision repair preserves unaffected cards and intentional gaps.
The result is an immutable layout snapshot used for both preview and commit.

Drag ownership resolves the clicked slot's stable ID rather than relying on a
potentially stale array index. The existing captured screen/local coordinate frame
and anchor offset make the card follow the pointer. Existing persistent screen-space
hysteresis chooses lanes, including its minimum screen-pixel step at distant zoom.
No arbitrary pointer delay was added. Returning to the original lane restores the
baseline snapshot; invalid targets never become commits of the last valid target.

A green dashed band shows the accepted position; red indicates rejection, with
the reason sent to the existing status surface when it changes. Outside-chassis,
capacity, fixed/locked and stale-editor/configuration conflicts reject. The pointer
position is revalidated on release. Connected-card validation runs on a cloned
candidate before mutation, then one existing metadata-history transaction commits
the exact accepted placement without changing chassis height.

The existing 150 ms motion system samples current interpolated positions when
retargeted, so rapid target changes do not restart from obsolete positions. The
dragged card follows the cursor while neighbors consume solver-approved targets.
Once the dynamic card owners are mounted, motion frames update their transforms
and the target guide only; they do not normalize connectors, rebuild the topology,
or recreate every card's SVG nodes and captions. Final rendering returns to the
normal Engine preview after settlement. Temporary overlap with the pointer-following
card can occur during a transition; accepted/committed layouts remain nonoverlapping.

Existing capture and cleanup handle Escape, pointer cancellation, editor close,
device switching and settlement. Rejected/canceled gestures leave no draft edit or
history entry. Valid drops participate in Save, Discard Changes, Keep Editing,
exact undo/redo, reopen and project save/reload. Installed connector selection keeps
priority over card dragging, and Card Editor resize/node gestures retain their
separate paths. At very distant zoom, use the card body away from connector hit
targets or zoom in; port hit targets intentionally retain priority.

## Verification

**VERIFIED PASS:** isolated staged production tree, excluding unfinished import
work, tested at `/tmp/wirenexus-prompt4-isolated-GdUxfZ`:

- `node --test test/*.test.mjs`: **1,845 passed**, zero failed/skipped.
- Focused `deviceEditorUiPreview`, `modularDeviceLayout`, and new `cardReorder`
  suites: **351 passed**. Eight new tests cover movable policy, local collision
  repair, fixed/empty reservations, bounds, mixed spans/sides, immutable IDs,
  hysteresis at 0.15/1/3 zoom, interruptible motion and dense layouts.
- All **16** `scripts/*-validation.mjs` validators passed.
- `build-output-viewer.mjs --check`, `build-pdf.mjs --check` and
  `build-cable-schedule.mjs --check` passed. Viewer and XLSX bundles changed due
  to their shared module graph/minification; PDF bundle remained unchanged.
- Embedded classic script compilation, five scoped JS syntax checks, and
  `git diff --cached --check` passed.

The full suite includes modular insertion/movement, card-swap safety and slot
preservation, editor sizing/naming, node replacement, shared buses, Exclusive
Connections, SFP/DAC, compatibility, personal-library, unsaved changes, history,
save/reload, schedules/signal chains, HTML/Publish and output-viewer coverage.
No existing behavioral assertions were weakened.

**VERIFIED PASS, Chrome:** `scripts/card-reorder-smoke.mjs` uses actual Google
Chrome mouse/keyboard interactions, with fixtures loaded through the application
snapshot API. It verifies outside rejection, a visible target, connected-card
move-aside, unchanged draft during movement, exact preview/commit agreement,
stable card/slot definitions and cable data, one history entry, undo/redo,
Escape, pointer cancellation, Keep Editing, Save/reopen, Discard Changes,
zoomed cancellation, fixed conflict/reentry, slot/device locks, fixed empty bays,
closing during animation and device switching. Pointer cancellation and close
during capture use dispatched events to exercise the actual handlers.

**VERIFIED PASS, prior phases in isolated Chrome:**
`card-safety-browser-smoke.mjs`, `jump-node-replacement-smoke.mjs`, and
`card-area-names-smoke.mjs`. The node-replacement harness retains its previously
documented null-module fixture exclusions; this does not claim those cases pass.

**VERIFIED PASS, outputs:** actual `.avd` save/reload preserves slot positions;
hosted-viewer preparation and standalone HTML have matching installed-port IDs
and Y coordinates. The HTML opens with network access blocked. Actual vector PDF
download succeeds and its rasterized page was inspected: moved card, neighbor,
labels and connected cable are in their committed positions, with no preview
guide or duplicate connector graphics. Engine canvas and editor/export screenshots
were inspected. No temporary placement is written into output data.

Evidence is local under `/tmp/wirenexus-prompt4/isolated/`: `initial.png`,
`moving.png`, `outside.png`, `move-aside.png`, `committed.png`, `redo.png`,
`fixed-conflict.png`, `offline.png`, `reordered.avd`, `reordered.html`,
`reordered.pdf`, and `animation-frames.json`. The final frame trace records 26 RAF
samples, including intermediate neighbor transforms; it is not only an assertion
against final geometry. Logs and the baseline comparison are in the parent folder.

## Performance

**VERIFIED PASS, first isolated-run local smoke measurements:**

| Slots | Fit zoom | Five native target moves | Mean solver call (50 runs) |
| --- | --- | --- | --- |
| 4 | 0.658 | 450 ms | 0.101 ms |
| 12 | 0.251 | 458 ms | 0.131 ms |
| 24 | 0.130 | 472 ms | 0.126 ms |

Native timings include Playwright input dispatch, animation-frame waits and
assertion overhead; they are not frame-rate guarantees. All three cases retained
the same card DOM owner and made zero full template-normalization calls during
the four rapid target changes measured after initial drag setup. Unit coverage
also exercises an 80-slot layout. Initial setup and final commit still perform
normal validation/rendering. Work is not represented as a fabricated solver
operation counter; solver wall time and native interaction time are reported
separately.

## Known pre-existing failure and limits

**PRE-EXISTING ISSUE, VERIFIED FAILURE:** running
`node scripts/engine-pdf-production-smoke.mjs` on an untouched archive of starting
commit `870b26e66af07e7d2e3b31c766c8546523f2ef8c` and on the isolated implementation
exits 1 with the same stack:

```text
TypeError: Cannot read properties of null (reading 'installedModule')
  installedModuleCapabilities       transceiverModules.js:69:28
  installedModuleDetailsForEngine   connectorCompatibility.js:362:19
  engineConnectorFiberMode         connectorCompatibility.js:514:19
  jumpInfoFromLocal                 jumpNodeModel.js:787:16
  jumpNodeConnectionInfo            jumpNodeModel.js:405:12
  SceneGraph.jumpNodeConnectionInfo sceneGraph.js:237:12
  drawJumpNodeInfoBox               renderer.js:4822:13
  renderer.js:3793:33
  Array.forEach
  drawEngineOutputLabels            renderer.js:3791:17
```

Impact: affected Jump-label fixtures abort before PDF generation. The focused
reordered-card PDF succeeds. Logs: `pdf-baseline.log` and `pdf-final.log`.
No unrelated PDF production source or failing test was modified.

**KNOWN LIMITATION:** no card reassignment across fixed bays; explicit physical
footprints are deliberately immovable in this gesture. No destructive migration
or reclassification is performed to make such slots draggable. The existing
solver can conservatively reject a constrained arrangement it cannot resolve;
there is no new global repacking/search engine.

**NOT TESTED:** every historical personal chassis, every browser/OS, live hosted
deployment, long-duration performance profiling, or every possible mixed-card
geometry in native Chrome. Mixed structural spans and sides are model-tested;
Chrome fixtures use output cards plus physical/locked/empty reservations. Existing
tests, not exhaustive new UI scenarios, cover custom artwork, shared-bus and SFP
variants. No unsupported assignment transfer is exposed.

## Scope and protection

Production changes: `index.html` Engine drag/preview integration and
`src/engine/modularDeviceLayout.js` reservation-aware reuse of the existing solver.
Additional files: the new model/browser regressions, this report, build/cache
fingerprints in the shell/bridge/renderer and four validators, and generated
viewer/XLSX bundles. Renderer production logic beyond the fingerprint is unchanged.

The original 49-line Device JSON Import shell patch and 40-line personal-definition
patch remain excluded. All 101 initial protected files (including artwork,
faceplates, Masters, backups, unfinished import files and probes) retain their
recorded hashes. The unstaged shell diff matches the original import patch after
ignoring shifted hunk offsets. No reset, stash, clean, or Legacy behavior change.

Final commit and verified remote SHA are returned after push. Stop before Prompt 5.
