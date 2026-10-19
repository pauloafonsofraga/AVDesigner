# Multi-Core Phase 4: Canvas, Placement and Interaction

## Baseline and scope

Started on `engine-prototype`, with both local HEAD and fetched
`origin/engine-prototype` at `6375fd6f182abc02561349c51be33bf5caf5002e`.
Build: **54.38.103 / Multi-Core Canvas**. Engine only; no Phase 5 editor,
channel-remapping interface, rack docking, artwork editor or trunk teleportation.
Schema 1, Phase 2 identities and Phase 3 passive topology remain authoritative.

## Ownership and projection

`src/engine/multiCoreProjection.js` deterministically projects each valid
`project.multiCores[]` aggregate into two existing device rendering primitives
and one existing wire rendering primitive. These are explicitly tagged with
`multiCoreIdentity`, `sourceKind` and the canonical aggregate/end identities.
They are **not** ordinary devices or physical cables in saved project data.

- End key: JSON tuple `["multi-core-end", multiCoreId, endId]`.
- Trunk key: JSON tuple `["multi-core-trunk", multiCoreId]`.
- End identity retains `kind`, `multiCoreId`, `endId`, and role `A`/`B`.
- Connector IDs, local coordinates and authored anchors are preserved.
- Trunk points retain their authored stable IDs, rather than sampled-path IDs.
- Projection keys are checked against existing owners and connection IDs.

The existing SceneGraph, renderer, connector layout, spatial indexes and hit
tests consume these tagged primitives. Simple bodies show name, end role and
termination style. All seven Phase 2 termination styles use the same body.
No termination face image is copied into the canvas visual or decoded.
Connector text follows existing zoom/detail rules.

The trunk uses restrained two-stroke bundle styling and the existing Bezier or
Orthogonal routing geometry. Its anchors are the bottom centers of the two
bodies, separate from signal ports. Labels include name, capacity and authored
length. Canvas distances never replace physical length metadata.

## Placement and interaction

`Place Multi-Core` opens a minimal selector containing valid saved definitions
and the Phase 2 Hybrid 14 reference definition. The first click places a
transient End A; movement previews End B and the trunk; the second click commits
one aggregate. Escape discards all placement state without a history entry.
Undo removes the insertion; redo restores the exact IDs and geometry.

`multiCoreCanvas.js` supplies a small set of ProductionEngineBridge methods;
there is no separate canvas, drag solver or interaction framework.

- Drag either end to move only that termination and its attached patch leads.
- `Select Assembly` deliberately selects both ends. Dragging moves both ends
  and all authored trunk points by the same delta, leaving other devices alone.
- ObjectSnapSession uses frozen targets, existing zoom-aware snap settings and
  axis locking. The moving aggregate is excluded from self-snapping.
- DragSession owns transient offsets; canonical positions stay unchanged until
  release. Existing dynamic/static suppression prevents the old geometry from
  remaining under a moving end or trunk.
- Connector hits precede bodies; bodies precede the tagged trunk hit region.
  Ordinary Device, Jump, Loom and Rack tool precedence is retained.
- End selection, Shift-add, trunk selection, clear and mixed marquee use existing
  Engine selection sets. Shell selection stores typed Multi-Core identities.
- Selecting only a trunk does not drag the assembly implicitly. Use the explicit
  `Select Assembly` action for whole-assembly movement.

The Inspector shows aggregate, part, style/ports or circuit count, position,
physical length and occupied-channel count. It provides routing style, add,
move, remove and reset actions. Points can also be dragged through existing
route handles. New points append in authored route order; existing IDs survive
movement, removal of other points, undo and redo. Structural commands and
completed drag gestures each create one Engine history command.

Direct end deletion is blocked. Connected aggregate deletion is blocked until
patch leads are disconnected/remapped. Disconnected aggregate deletion removes
only the aggregate. Mixed selections containing ends cannot cascade-delete
unrelated devices/cables. No new destructive confirmation system was introduced.

## Connectivity and persistence

New and rewired external leads persist exactly:

```json
{"kind":"multi-core-port","multiCoreId":"...","endId":"...","connectorId":"..."}
```

Projection keys are not saved as ordinary `deviceId` endpoints.
ProjectMutationAdapter writes end positions and trunk points to their aggregate,
and explicitly refuses to create or rewire the schematic trunk as a canonical
connection. Fallback serialization also excludes projected devices/trunks.

Phase 3 resolution, channel eligibility, occupancy and physical compatibility
run before committing a connection. Known mismatches, disabled channels and
occupied ports are rejected. Unknown physical specifications retain diagnostics;
they are not reported as verified compatibility. The connectivity snapshot is
cached through pointer movement and invalidated on commits/loads.

The two real external leads retain their independent IDs, lengths and typed
endpoints. A passive channel is derived, not persisted as a third cable. The
Cable Schedule remains two physical rows for the tested channel. Signal Chain
retains the same circuit mapping before/after moves and save/reopen.

Invalid imports remain canonical data, not repaired definitions. Missing ends
or ports, ambiguous identities, bad geometry, unsupported schemas and unresolved
leads do not cause fake owners to be fabricated. Unsafe geometry is skipped;
diagnostics are exposed at load/output and invalid Inspector records are
read-only. End/trunk coordinates outside the supported range are not included
in Fit View. Valid Multi-Core bounds include the ends, trunk and patch leads.

## Shared output

The project adapter and outputSceneSnapshot use the same projection. The shared
output contract carries the tagged geometry and Phase 3 modelData. Viewer code
does not implement another Multi-Core geometry model. Trunks are excluded from
physical-cable playback lists and cable-hop computation.

Verified live versus standalone/offline and simulated hosted HTML polylines are
identical, including the two patch leads and one trunk. Offline network requests
were blocked. Hosted validation used the shared Publish preparation payload at
a simulated HTTPS origin; no project was uploaded to a real hosting account.

The real PDF toolbar/download path succeeded. Its drawing page has 8,261 vector
path operations, 836 text operations and zero raster images. Both ends, port
numbers, trunk label and patch leads were inspected in the rendered PDF. Output
uses the existing vector PDF path and existing light-theme/detail conventions.

## Verification

- Full Node suite: **1,443 passed, 0 failed, 0 skipped**.
- All **16 static validators** passed, including catalogue byte validation,
  compatibility, preview ownership, real-project adapter and output pipeline.
- Output Viewer bundle regenerated and reproducibility checked. Cable Schedule
  and PDF bundle checks passed without changing their bundles.
- Changed JavaScript syntax and inline-script validation passed; diff whitespace
  check passed.
- Real Chrome Multi-Core mouse workflow: insertion/cancellation, exact insertion
  undo/redo, two typed cable connections, independent A/B movement, aggregate
  movement, route add/drag/remove/reset, Orthogonal mode, mixed marquee, blocked
  end/connected deletion, real Save/reopen, passive Signal Chain, offline/hosted
  geometry parity and actual PDF download. No page errors.
- During Chrome drag previews the canonical aggregate is asserted unchanged
  before mouse release. A transient screenshot was inspected for duplicate
  body/trunk/lead geometry.
- Existing browser smokes passed: Loom creation priority (18 cases), Loom
  interaction stability, unified Loom/Jump, dedicated Loom Portal, Jump link
  persistence, Output Viewer and Phase 3 Multi-Core connectivity. Historical
  device, matrix, rack, LED and Jump fixture checks are included.
- Pure negatives cover incompatible, unknown, occupied, disabled, missing port,
  future schema, ambiguous identities, invalid positions and delete protection.
- The existing production PDF regression generator and pypdf inspector passed
  **23 cases**, including page sizes, margins, cross-page links and dense Jumps.
- Phase 2 persistence assertions that previously required no Multi-Core visuals
  now distinguish canonical records from intentionally added render projections.
  Historical projects without Multi-Cores retain their prior output assertions.

The preview validator logs an asset-ready subscriber `refCount` warning despite
passing. It was reproduced with exit status 0 in an isolated archive of the
untouched starting commit, and is not changed by this phase. The optional large
private-project performance branch of the Output Viewer smoke was skipped
because `AVDESIGNER_REAL_PROJECT_PATH` was not supplied. `pdfimages` and
`pdftotext` were unavailable; bundled pypdf inspected vector/text operations and
Poppler rendered the PDF successfully (with a nonfatal Fontconfig warning).

## Performance

Mean milliseconds per update over 100 iterations, measured locally in Node.
Ports are spaced in representative 8/16/32/64-channel bodies. A/B/assembly
movement includes snap preview and affected wire geometry; hover includes hit
testing and cached Phase 3 compatibility. These are CPU model-path measurements,
not GPU-frame or large-private-project benchmarks.

| Circuits | End A | End B | Assembly | Route point | Connector hover |
| --- | ---: | ---: | ---: | ---: | ---: |
| 8 | 0.020 | 0.055 | 0.028 | 0.017 | 0.047 |
| 16 | 0.008 | 0.137 | 0.011 | 0.010 | 0.031 |
| 32 | 0.009 | 0.006 | 0.083 | 0.011 | 0.032 |
| 64 | 0.007 | 0.027 | 0.201 | 0.016 | 0.055 |

No full project normalization, Cable Schedule rebuild or passive graph rebuild
occurs per drag-preview frame. Full projection rebuilds are limited to committed
structural changes; ordinary end movement uses the existing incremental path.

## Acceptance artifacts

Local artifacts are in `/tmp/wirenexus-multi-core-canvas/`:

- `placement-preview.png`, `placed.png`, `connected.png`
- `end-a-transient-preview.png`, `end-drag.png`, `end-b-moved.png`
- `orthogonal-route.png`, `route-point-drag.png`, `assembly-moved.png`
- `mixed-marquee.png`, `offline-html.png`, `simulated-publish.png`
- `multi-core.pdf`, `pdf-preview.png`

Node TAP logs: `/tmp/wirenexus-phase4-node-release.tap`.
Validator/browser logs: `/tmp/phase4-*.log`.

## Files and review decisions

New files: `src/engine/multiCoreProjection.js`, `src/engine/multiCoreCanvas.js`,
`test/multiCoreCanvas.test.mjs`, `scripts/multi-core-canvas-smoke.mjs`, this report.

Updated Engine files: projectAdapter, projectMutations, sceneGraph,
productionBridge, renderer, objectSnapping, cableCaption, cableHops,
multiCoreConnectivity (exports of existing equipment compatibility/index),
outputSceneSnapshot, outputViewerModel and generated/outputViewerBundle.json.
Also updated index.html, multiCorePersistence tests, the Phase 3 browser smoke
and four build-fingerprint validators. Toolbar overflow is scrollable so the
additional insertion control does not overlap branding or other commands.

Unrelated faceplates, artwork, Masters, local backups and PDF investigation
scripts remain unmodified and unstaged. No catalogue definition/artwork changes.

Before Phase 5, review these deliberate choices:

1. Reuse tagged device/wire render primitives, with explicit canonical write
   guards, instead of introducing a second scene-primitive hierarchy.
2. Use a temporary reference/saved-definition selector and bottom-center trunk
   anchors. Phase 5 can replace the picker without changing aggregate identity.
3. Reuse existing route geometry, including its lack of obstacle avoidance and
   possible backtracking for waypoints beyond both ends. Stable authored points
   are never silently dropped to prettify the route.
4. Keep direct end deletion and connected aggregate deletion blocked. Mixed
   selection is supported independently of destructive actions.
5. Do not expand the legacy playable-cable animation into a new passive-channel
   diagram. Phase 3 Signal Chain topology remains authoritative.

Final commit and verified remote hashes are reported in the delivery message.
Stop here for architectural review before implementing the Multi-Core Editor.
