# Multi-Core Jump Integration (Phase 6)

## Pre-change Ownership Audit

Baseline local and fetched remote: `ecdb35eb76f04104f2e323f121e6e8e5a92203d8`, build 54.38.108.

- Ordinary Jump objects live in `jumpNodes`; `jumpLinks` pairs them. Physical signal leads live separately in `connections`.
- A Loom owns ordinary Jumps through its `jumpRouting` association. Dedicated Loom Portals instead live in `loom.portalPairs`; these are not ordinary Jump objects.
- Multi-Core ends/trunks are projected scene primitives, never canonical devices/connections. Patch leads use typed `multi-core-port` endpoints. The passive connectivity graph already resolves these endpoints without depending on trunk geometry.
- Loom membership groups ordinary physical connection records. The Multi-Core trunk must remain excluded. Cable Schedule consumes physical connections, not projected trunk sections.
- The same Engine scene projection feeds canvas, snapshots, HTML/Publish and vector PDF. Ordinary Jump relationship curves are transient overlays; PDF navigation uses the established Jump-link annotations.

## Association Contract

Optional `multiCores[].trunk.jumpRouting`: `kind: multi-core-jump`, `schemaVersion: 1`, stable `id`, `entryJumpId`, and `sections.A/B`, each with stable `id` and `pointIds`. Coordinates remain on existing Jump objects; ordered authored controls remain in `trunk.routePoints`.

The ordinary Jump pair determines the exit gateway. An unpaired entry is a valid waiting association. No exit, cable or channel is fabricated. Only the incident section changes when an end or gateway moves. Deliberate assembly selection includes both owned gateways; ordinary Jump movement remains independent.

Invalid imports remain stored and diagnosed. No destructive migration of Looms, Jump pairs, definitions or circuit correspondence is permitted. Gateway edits pass the existing Multi-Core validation gate. Presentation data does not enter the passive electrical graph.

## Phase 6 Delivery Report

1. **Starting revision.** Local and fetched `origin/engine-prototype` both resolved to `ecdb35eb76f04104f2e323f121e6e8e5a92203d8`. Build moves from 54.38.108 to **54.38.109 - Multi-Core Jump Routing**. A second fetch before delivery confirmed the remote had not advanced.
2. **Ownership findings.** Ordinary Jumps, Loom-owned ordinary Jump pairs, and dedicated Loom Portal records are distinct. This phase reuses only ordinary `jumpNodes`/`jumpLinks`. No existing portal migrations or changes to Loom membership were needed.
3. **Gateway model.** `trunk.jumpRouting` is a typed, optional version-1 association, with one entry Jump and two stable section IDs. The exit is resolved from the existing pair. Each authored point ID belongs to exactly one section. Association/section IDs use the existing monotonic child-ID allocator.
4. **Canonical storage.** One assembly remains in `multiCores`. The original ends, circuits, port references, route points and trunk length remain canonical. Projected sections never enter `connections`; projected ends never enter `devices`. Personal definitions do not capture project-specific gateway associations.
5. **Patch-lead Loom support.** Existing grouping accepts real physical patch leads with typed Multi-Core endpoints. Browser acceptance creates a Loom and assigns one connected lead through the existing inspector. There are still two physical cables and one assembly; the trunk cannot be a Loom member.
6. **Association workflow.** Select a trunk or termination, choose **Route Through Jump**, then click an ordinary Jump. Existing pairing works before or after association. The Trunk tab also offers gateway assignment. Occupied pairs are not stolen.
7. **Waiting continuation.** An unpaired entry shows only section A and the existing red center dot. Pairing produces section B automatically, with no extra click or re-created assembly. End B and its external cable remain intact while waiting.
8. **Waiting deletion.** Deleting the waiting entry validates detachment, restores a continuous selectable trunk, clears temporary route placement, and retains authored points, circuits and physical cables. Undo restores the exact association and section IDs.
9. **Section movement.** Dragging a visible section moves only its incident termination, owned gateway and authored controls. The opposite section stays unchanged. The test exercises both sections in Bezier and orthogonal modes.
10. **Gateway movement.** Gateway coordinates remain owned by their existing Jump records, not copied into the Multi-Core. Ordinary gateway drags remain independent. Explicit **Select Assembly** includes both terminations and the exclusively associated gateways, allowing deliberate whole-assembly movement without moving unrelated Jumps.
11. **Visual parity.** Existing enlarged Loom gateway sizing, blue/orange roles, selection feedback and red waiting-center semantics are reused. Hover uses the transient paired-Jump curve with assembly name and trunk thickness. No new symbol or persistent cross-gap wire is introduced. The production inspector identifies the assembly and waiting/connected status.
12. **Geometry.** Both route modes use the existing wire geometry implementation. Section controls are ID-owned, not inferred from samples. Gateway and end moves only affect incident geometry. Explicitly authored backtracking controls are retained, not silently smoothed away.
13. **Selection.** Visible section click, Shift-add, mixed marquee, intentional whole-assembly selection and movement are covered. The empty discontinuity has no projected wire and is not a trunk hit target.
14. **Diagnostics.** Missing/ambiguous Jumps, missing partners, invalid anchors, duplicate ownership, unsupported versions and ordinary signal/Loom conflicts produce recoverable diagnostics. Failed associations do not mutate history or project data. Historical section-key collisions do not overwrite real cable primitives. Unknown gateway versions remain opaque; unrelated safe edits still work.
15. **History.** Existing commands handle association, detachment, pair/unpair, end/gateway/section moves, route edits, gateway deletion and restoration. Escape cancels assignment without a history entry. Real Chrome verifies exact undo/redo and repeated pairing/deletion. A stale Jump-placement pointer flag found during testing was fixed and regression-tested.
16. **Save/reload.** Real Save Project and file-input reopen preserve exact Multi-Core records, both external cable IDs and typed endpoints. `state` and `project` envelopes retain gateway ownership. Reopened output paths match the editor's paths.
17. **Editor.** The existing Trunk tab adds only a Jump selector, paired/waiting status and section identities/point counts. Real mouse acceptance verifies that assignment changes remain draft-local, Cancel preserves project/history, and Save detachment can be undone exactly. The existing detached draft and validation gate own these edits; no second editor or personal database was added.
18. **Signal Chain.** Trunk-only Jump pairs are excluded from passive electrical edges. Continuous versus split fixtures have identical connectivity edges: 14 channels, two external cables, one occupied channel in the accepted path. Browser Signal Chain remains valid after movement and pairing changes.
19. **Cable Schedule.** It still consumes canonical physical connections. Neither the two projected trunk sections nor the transient pair curve adds cable rows. The accepted example remains two cable rows. Assembly reporting is deliberately left for Phase 7.
20. **HTML/Publish.** Standalone and actual hosted-viewer preparation are exercised with all asset/network requests blocked (the simulated hosted document response alone is supplied). Their projected paths match the live editor exactly; gateway roles and embedded model data survive. No public hosted project was uploaded in this verification.
21. **PDF.** The production toolbar exports a two-page vector PDF. Its two Jump annotation rectangles match the actual exported scene to 0.02 pt, reciprocal actions are internal `GoTo /XYZ`, and trunk text is extractable. Real Chrome passes ten reciprocal offline clicks at 900x650, 1200x800, 1500x1000, 1920x1080 and 1000x1400, keeping 300% zoom and the target visible. Both rendered pages were visually inspected; no trunk crosses the gap. This does not claim manual Acrobat or Preview acceptance.
22. **Performance.** The reproducible timing table below covers 8/16/32/64 circuits. Drag previews use existing transient offsets; they do not rebuild the passive graph. Signal lookup uses a verified two-cable/one-channel path on a cached graph. Hover does not rebuild Cable Schedule.
23. **Screenshots.** Captured and inspected paired sections, both route styles after movement, waiting/red-center state, gateway hover, mixed marquee, save/reload, offline HTML, hosted preparation, both PDF pages and PDF click navigation. Acceptance artifacts are in `/tmp/wirenexus-multi-core-jump`; existing Loom visual artifacts are in `/tmp/wirenexus-unified-jump-loom` and `/tmp/wirenexus-loom-jump-presentation`. They are local QA artifacts, not application assets.
24. **Node suite.** Final full suite: **1,550 passed, 0 failed, 0 skipped**. This includes 23 focused Multi-Core Jump tests and the new stale-pointer-ownership test, plus all prior Multi-Core, editor, personal-library, faceplate, card, routing, Signal Chain, schedule and output tests.
25. **Static checks.** All 16 `scripts/*-validation.mjs` validators pass. Output-viewer, Cable Schedule and PDF generated bundle checks pass. Changed/new JavaScript syntax checks and `git diff --check` pass.
26. **Browser regressions.** All **25 existing regression scripts pass on the final run**. Coverage includes Phase 2-5 Multi-Core, Device Editor/shared bus, card shared bus/kind reset/node dragging/identity, personal definitions, relationship metadata, power-distribution marquee, Loom interaction/Portal/unified Jump behavior, ordinary Jump hold/persistence, rack patch panels, matrix routing, Signal Chain, Cable Schedule, HTML and production PDF. One initial Jump persistence run failed its timed hold assertion; the unchanged test passed on retry and on the complete final rerun. Results are recorded in `/tmp/wirenexus-phase6-regressions-final`.
27. **Files.** Runtime changes are scoped to the Engine Multi-Core model/projection/validation/editor/canvas modules, Jump/Loom ownership checks, scene/mutations/bridge/render/hit/caption/output integration, and the production Jump inspector/build fingerprints in `index.html`. New helpers, fixture, unit/browser/performance/PDF tests and this report accompany them. Generated viewer/schedule bundles and four existing fingerprint validators are updated. No Legacy implementation was changed.
28. **Commit.** The delivery commit containing this report is identified in the final chat response; `git log -1 --format=%H -- docs/multi-core-jump-integration.md` also identifies it without a self-referential hash in the commit.
29. **Remote.** The final response records the pushed hash after verifying `origin/engine-prototype` and `git ls-remote` agree with local HEAD. No force push is used.
30. **Unrelated files.** Artwork/faceplates, `Masters/`, backups and the unrelated PDF compatibility probe scripts remain untracked and outside the delivery commit. No settings or user projects are rewritten by QA; Chrome uses isolated test contexts.
31. **Boundary/limitations.** Phase 6 supports one ordinary Jump pair per trunk, with two visible sections. It does not add multiple discontinuities, a new portal type, realistic end faceplates, rack docking, strand fanout or reporting redesign. Unsupported imported gateway schemas are retained but not editable. Phase 7 has not been started.

## Performance Measurements

Node v24.4.1, local macOS; five warmups and thirty measured samples per operation. Values are **median / p95 milliseconds**. These are model/geometry timings, not end-to-end browser paint times. The 64-channel regeneration p95 includes a 43 ms outlier; regeneration occurs at commit boundaries, not each drag frame.

| Operation | 8 circuits | 16 circuits | 32 circuits | 64 circuits |
| --- | --- | --- | --- | --- |
| Association validation | 1.813 / 1.963 | 3.210 / 3.381 | 6.010 / 6.366 | 11.658 / 12.845 |
| Scene regeneration | 1.865 / 2.301 | 2.658 / 2.902 | 4.274 / 4.612 | 7.867 / 43.134 |
| Section preview | 0.022 / 0.042 | 0.014 / 0.022 | 0.011 / 0.022 | 0.010 / 0.012 |
| Gateway preview | 0.006 / 0.010 | 0.004 / 0.007 | 0.003 / 0.012 | 0.003 / 0.004 |
| End A preview | 0.024 / 0.066 | 0.015 / 0.029 | 0.010 / 0.013 | 0.010 / 0.011 |
| End B preview | 0.016 / 0.030 | 0.013 / 0.023 | 0.010 / 0.017 | 0.009 / 0.010 |
| Route-point geometry | 0.011 / 0.024 | 0.007 / 0.011 | 0.007 / 0.017 | 0.006 / 0.007 |
| Gateway hover lookup | 0.005 / 0.009 | 0.003 / 0.003 | 0.003 / 0.013 | 0.003 / 0.003 |
| Cached Signal Chain lookup | 0.030 / 0.039 | 0.029 / 0.045 | 0.030 / 0.048 | 0.031 / 0.046 |

## Reproduction

Use the repository's existing local HTTP server and installed Chrome. Override `AVDESIGNER_BASE_URL` and `AVDESIGNER_CHROME_PATH` as appropriate; the focused acceptance default is `http://127.0.0.1:8773`.

```sh
node --test test/*.test.mjs
node scripts/multi-core-jump-smoke.mjs
node scripts/multi-core-jump-performance.mjs
python3 scripts/inspect-multi-core-jump-pdf.py /tmp/wirenexus-multi-core-jump
node scripts/multi-core-jump-pdf-smoke.mjs /tmp/wirenexus-multi-core-jump
```

The PDF inspector requires `pypdf`. The browser test drives real mouse/keyboard creation, routing, patch cabling, grouping, section movement and undo/redo. It uses file import only to load setup/negative fixtures and reads canonical state for assertions. It also exports the actual acceptance project, HTML, SVG and PDF plus the PDF annotation expectations, so navigation tests do not substitute a different fixture.

## Changed File Inventory

```text
index.html
docs/multi-core-jump-integration.md
fixtures/multi-core-jump.mjs
scripts/canvas-layout-objects-validation.mjs
scripts/connector-operational-status-validation.mjs
scripts/jump-node-validation.mjs
scripts/preview-ownership-validation.mjs
scripts/inspect-multi-core-jump-pdf.py
scripts/multi-core-jump-pdf-smoke.mjs
scripts/multi-core-jump-performance.mjs
scripts/multi-core-jump-smoke.mjs
src/engine/cableCaption.js
src/engine/generated/cableScheduleBundle.js
src/engine/generated/outputViewerBundle.json
src/engine/hitTest.js
src/engine/jumpNodeModel.js
src/engine/loomJumpAssociation.js
src/engine/multiCoreCanvas.js
src/engine/multiCoreConnectivity.js
src/engine/multiCoreEditValidation.js
src/engine/multiCoreEditor.js
src/engine/multiCoreEditorDraft.js
src/engine/multiCoreJumpRouting.js
src/engine/multiCoreModel.js
src/engine/multiCoreProjection.js
src/engine/outputViewerModel.js
src/engine/productionBridge.js
src/engine/projectMutations.js
src/engine/renderer.js
src/engine/sceneGraph.js
test/jumpNodeGesture.test.mjs
test/multiCoreJump.test.mjs
```
