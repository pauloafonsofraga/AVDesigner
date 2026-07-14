# AV Designer Engine Mode Feature Parity Matrix

Iteration 40.4 diagnoses and fixes the low-resolution Engine device texture
path. It keeps the Iteration 40.3 live connector overlays and Legacy-style glow,
but raises the cached texture budget for tall modular chassis, records the
logical-to-physical texture scale, and adds `debugDeviceTexture=1` HUD rows so
soft device graphics can be traced to source PNG size, GPU limits, or texture
pixel budget instead of guesswork.

Iteration 39 was the Legacy interface and visual fidelity audit pass. It keeps
the Iteration 36.1 Legacy connector compatibility rules, the Iteration 36.3
installed SFP/SFP+/QSFP module scene sync, restores
Legacy SFP/QSFP fiber module compatibility plus fiber cable colors, and
restores Legacy orthogonal segment dragging plus Legacy segment snap/spacing in
the Engine Editor. Iteration 37.5 deepened that orthogonal pass by auditing the
full Legacy 90-degree routing block, rendering the live snap guide in Engine,
and preventing endpoint-adjacent vertical doglegs from collapsing into
uneditable endpoint stubs. Iteration 37.6 now ports Legacy conservative
route cleanup and moved-endpoint repair more directly, so short overlapping
route runs survive, one-ended device moves preserve middle doglegs, and
endpoint-adjacent doglegs can cross to the opposite connector side without
getting stuck. Iteration 37.7 replaces the browser interaction path that treated
orange route handles as segment drags. A shared immutable
`OrthogonalRouteModel` now distinguishes protected connector stubs, editable
dogleg segments, and true corner handles. Both drag paths calculate from the
route captured at pointer-down, which preserves point identity and prevents
frame-by-frame route collapse. Iteration 37.8 restores the Legacy wire-body and
route-handle context-menu actions for creating, deleting, and resetting custom
routes in both Bezier and 90-degree modes. The Engine commands write through to
the existing `routePoints` and `orthogonalRoutePoints` fields without changing
the project format. Iteration 38 restores Legacy endpoint reassignment by
grabbing an occupied connector. It mutates the existing wire in place, keeps
all cable metadata and routes, uses shared compatibility feedback, and records
one `MoveWireEndpointCommand` for undo/redo.
Viewer, PDF, and report visual migration remains paused. The current
functional audit lives in
[`docs/legacy-functional-parity.md`](legacy-functional-parity.md) and uses
Legacy commit `8301fbf23c82f3e3f2496cb90234019c7bf47958` as the source of
truth for pre-engine behaviour.
The current interface/visual audit lives in
[`docs/legacy-interface-parity.md`](legacy-interface-parity.md).

The previous Iteration 34 standalone technician-viewer wire parity work remains
committed, but no additional output migration should happen until the high-risk
functional gaps in the audit are restored.

Engine editing writes through to the production project data model, and
downstream outputs still read from `projectSnapshotData()`.

Wire routing mode remains a project-level/toolbar setting, matching Legacy:
Bezier is the default, 90-degree mode is stored as `wireMode: "orthogonal"`,
and Engine-created 90-degree wires write interior bend points to
`orthogonalRoutePoints`. Existing custom route points remain untouched.
Switching the toolbar mode syncs the current production connection route data
back into the Engine scene.

Iteration 37.1 ports the Legacy endpoint-stub and route-point repair rules into
shared Engine helpers. During route-point drag, device/jump-node/LED-surface
drag, multi-drag, undo/redo, and production write-through, orthogonal wires now
preserve horizontal connector exits and keep stored handles in
`orthogonalRoutePoints`.

Iteration 37.2 adds the Legacy direct segment-drag interaction for 90-degree
wires. Route-point handles still have priority, endpoint-attached stubs remain
protected, and dragging a middle vertical or horizontal segment moves its two
adjacent interior route points together on the constrained axis.

Iteration 37.3 ports the Legacy segment snap behaviour used by
`wireSegmentSnapTargetsForDrag(...)` and `wireSegmentSnap(...)` at Legacy commit
`8301fbf`. Legacy did not expose a separate spacing UI; it used the global
Object Snapping toggle during temporary segment drag. The default orthogonal
spacing constant is `15px`, and the snap offsets are exactly
`10, 15, 20, 25, 30px`. Engine segment dragging now caches parallel segment
targets at drag start and snaps vertical doglegs or horizontal middle spans to
matching endpoint/parallel lanes before writing final route point coordinates.

This is a narrow output-renderer pass, not a full viewer rewrite. The exported
standalone HTML viewer now embeds Engine-style wire path and cable-hop geometry
helpers for Bezier, custom-routed, and orthogonal/custom-corner wires. Cable-hop
geometry remains runtime-only and is not saved into `.avd` or JSON project data.
PDF and report drawing paths are deliberately unchanged.

The legacy production SVG editor remains available as a safe fallback behind
explicit URL flags.

Current visible build label: `Iteration 40.4`.
The app top bar must show one of these labels:

- `Iteration 40.4 — Engine Editor — iteration40-4`
- `Iteration 40.4 — Legacy Editor — iteration40-4`

The commit/build identity is a static standalone HTML label, so use the actual
Git commit as the final source of truth when reviewing a pushed change.

## How To Test

1. Open the default engine editor: `index.html`.
2. Open the default engine editor with cache busting:
   `index.html?v=iteration40-4`.
3. Open the explicit engine editor: `index.html?engine=1&v=iteration40-4`.
4. Open the compatibility default-test alias:
   `index.html?engineDefaultTest=1&v=iteration40-4`.
5. Open the legacy editor fallback:
   `index.html?legacy=1&v=iteration40-4`.
6. Open the alternate legacy fallback:
   `index.html?engine=0&v=iteration40-4`.
7. Open the debug loading guard:
   `index.html?engine=1&debugLoad=1&v=iteration40-4`.
8. Open a timed loading guard:
   `index.html?engine=1&loadDelay=1500&v=iteration40-4`.
9. Open the expanded engine HUD:
   `index.html?engine=1&debugHud=1&v=iteration40-4`.
9a. Open the device visual diagnostic HUD/layer view:
   `index.html?engine=1&debugDeviceVisual=1&v=iteration40-4`.
10. Open the Device Library drag/drop debug overlay:
   `index.html?debugLibraryDrag=1&v=iteration40-4`.
11. Open the explicit Engine drag/drop debug overlay:
   `index.html?engine=1&debugLibraryDrag=1&v=iteration40-4`.
12. Open the Legacy drag/drop debug overlay:
   `index.html?legacy=1&debugLibraryDrag=1&v=iteration40-4`.
13. Open compatibility diagnostics while drawing wires:
    `index.html?engine=1&debugCompatibility=1&v=iteration40-4`.
14. Open routing diagnostics while selecting or editing orthogonal wires:
    `index.html?engine=1&debugHud=1&debugRouting=1&v=iteration40-4`.
15. Open endpoint-rewire diagnostics:
    `index.html?engine=1&debugRewire=1&debugRouting=1&v=iteration40-4`.
16. Confirm the top bar build label matches the mode you intended to test.
16. Switch from engine to legacy with the toolbar mode switch; switch back by
   using the same control in legacy mode.
17. Disable engine temporarily by using `legacy=1` or `engine=0`.
18. Load a real `.avd` or `.json` project.
19. During project loading, confirm the Engine Editor loading overlay appears,
   shortcut/delete/drag interaction is blocked, and the overlay hides only after
   the first engine frame is ready.
20. Use **Validate Engine Scene** after loading and after edits.
21. Run the compatibility validation:
   `node scripts/engine-compatibility-validation.mjs`
22. Run the fixture validation:
   `node scripts/engine-real-project-validation.mjs --fixture`
23. Run the real-project validation:
   `node scripts/engine-real-project-validation.mjs "/path/to/project.avd"`
24. The validation script now includes a long mixed undo/redo chain. Confirm the
   JSON output contains a `longChain` section and all `checks` are `ok: true`.
25. Compare Engine and Legacy connector behavior with the same project:
   `index.html?v=iteration40-4` beside
   `index.html?legacy=1&v=iteration40-4`.
25. In `index.html?engine=1&debugHud=1&v=iteration40-4`, confirm the HUD
   `load phase`, `load ready`, `wire paths`, `connector overlay`, and
   `connector tooltips` rows update.
26. Hover and select wires in Engine mode. Confirm hover/selection feedback is
   visibly distinct, selected/hovered labels appear, route-point handles are
   round orange controls, and labels do not block wire selection.
27. Hover connectors in Engine mode. Confirm the cursor changes to a crosshair,
   circular connector hover feedback appears, and a small tooltip follows the
   hovered connector.
28. Click a connector. Confirm the inspector shows connector details, selected
   connector state is orange, and selecting a device or wire clears connector
   selection.
29. Start a wire from a connector. Confirm the source connector highlights blue,
   valid target connectors highlight green, and dropping back on the same
   connector is treated as invalid.
30. Create a new wire, then click empty canvas. Confirm the wire deselects and
   loses the orange selected glow.
31. Create another new wire, then select an existing wire, device, and connector
   in turn. Confirm only the actual current selection is highlighted.
32. Delete, undo, and redo a newly created wire. Confirm the restored/redone wire
   can still be selected and deselected normally.
33. Hover normal devices, jump nodes, LED surfaces, and adapters. Confirm a
   lightweight blue object outline appears without texture rebuilds.
34. Select one object and several objects. Confirm selected objects use the
   orange multi-layer outline and selected labels stay readable.
35. Zoom out below the detail threshold and hover a device. Confirm the fast
   black hover tooltip follows the pointer and does not block selection.
36. Hover and click jump nodes. Confirm the jump node renders as one circular
   object, not a square body plus separate selected connector ring.
37. Start a wire from a normal connector and hover/drop on a jump node. Confirm
   the jump endpoint can still act as the wire target without leaving a stale
   connector selection overlay.
38. Open `index.html?engine=1&debugHud=1&debugLayers=1&v=iteration40-4`, drag
   a connected jump node with its connected wire selected, and confirm no stale
   selected or hovered wire remains at the original jump-node position.
39. In the debug layer panel for that same drag, confirm the connected wire has
   `staticWireLayer: skipped`, `selectedWireOverlay: suppressed-affected` when
   selected, `hoverWireOverlay: suppressed-affected` when hovered,
   `liveDragWireOverlay: drawn-moving-selected` or `drawn-moving-hover`, and
   endpoint owner details that resolve the jump endpoint to the jump object.
40. Drag a normal connected device and a multi-selection with connected wires.
   Confirm those wires still follow live and do not leave static ghosts.
41. Select an idle wire connected to a jump node. Confirm the selected orange
   wire emphasis remains visible but does not cover the jump-node body, ring,
   or readable label. Repeat after pan/zoom and with hovered wire emphasis.
42. Zoom out on devices with long names. Confirm device labels are clipped or
   truncated inside their device bounds, then hidden when the device is too
   small to hold readable text.
43. At low zoom, hover a device with a hidden/truncated label. Confirm the fast
   black hover tooltip still shows the full device name.
44. With the expanded engine HUD open, confirm `device labels hidden` and
   `device labels truncated` update as zoom changes.
45. Compare cable crossings in Engine and Legacy with the same project:
    `index.html?v=iteration40-4` beside
    `index.html?legacy=1&v=iteration40-4`.
46. In Engine, inspect Bezier, custom-routed, orthogonal/custom-corner, and
    jump-node-connected wire crossings. Confirm hops are visible and stable
    after pan/zoom.
47. Drag a connected device or jump node through a dense crossing area. Confirm
    affected moving wires draw once, without stale hop marks, and final hops
    return after drop.
48. Drag a route point near a crossing. Confirm the wire remains editable while
    moving and cable hops finalize after release.
49. Open `index.html?engine=1&debugHud=1&v=iteration40-4` and confirm the HUD
    rows `cable hops`, `cable hop calc`, `cable hop candidates`, and
    `cable hop dirty` update.
50. Open `index.html?engine=1&debugHud=1&debugRouting=1&v=iteration40-4`,
    create or load a 90-degree wire, and press-drag the middle vertical dogleg
    segment directly. Confirm the segment moves left/right, both adjacent
    orange corner handles move together, connector endpoint stubs stay locked
    to the connector Y positions, and no diagonal spans appear.
51. Click-drag either orange corner handle on that same middle vertical dogleg.
    Confirm it enters corner-handle mode, keeps both adjacent spans orthogonal,
    and does not leave a stationary ghost dot. Drag the wire span itself when
    you want the paired bends to move together as one dogleg.
52. Repeat with a middle horizontal segment and confirm it moves only up/down.
53. Try dragging the first and last endpoint-attached stubs. Confirm they do
    not start segment drag and only select the wire. The HUD `route segment`
    row should report `blocked:endpoint-stub`.
54. Drop a moved segment, undo, redo, save, and reload. Confirm the same
    `orthogonalRoutePoints` are restored and the route remains 90-degree.

55. Run the fixture validation and confirm the JSON output includes
    `outputVisual` rows for `initial`, `final`, and `chain final redo state`.
56. Run the real-project validation and confirm each `outputVisual` row reports
    finite base polylines, finite hopped polylines, and `deterministic: true`.
57. Drag a normal device from the Device Library into the Engine Editor canvas.
    Confirm it appears under the cursor, is selected, has connectors, can move
    immediately, and Validate Engine Scene still passes.
58. Drag a project custom device or paired device entry if available. Confirm
    the Engine Editor creates the expected one or two placed device instances
    as one selection and one undoable command.
59. Undo and redo the created device. Confirm undo removes it, redo restores
    the same device ID/data, the viewport does not move, and the device remains
    save/reload compatible.
60. Repeat a Device Library drag/drop in `index.html?legacy=1&v=iteration40-4`
    to confirm Legacy fallback behaviour is unchanged.
61. Export a standalone HTML viewer from an Engine-edited project. Confirm
    Bezier wires, custom-routed wires, orthogonal/custom-corner wires, cable
    hops, wire labels, and jump-node z-order look closer to the Engine Editor.
62. Export a PDF report from the same project. Confirm the PDF still opens and
    uses the previous PDF path; Iteration 35 does not migrate PDF rendering.

## Iteration 40.4 Focus

- Legacy source of truth: commit
  `8301fbf23c82f3e3f2496cb90234019c7bf47958`.
- This is an Engine cached-texture sharpness and diagnostics pass, not another
  audit and not a viewer/PDF/report migration.
- Confirm the visible top-bar label shows either
  `Iteration 40.4 — Engine Editor — iteration40-4` or
  `Iteration 40.4 — Legacy Editor — iteration40-4`.
- Open `index.html?debugDeviceTexture=1&debugHud=1&v=iteration40-4`.
- In the HUD, confirm the texture debug rows show device ID, logical size,
  physical texture size, current screen/DPR scale, magnification, scale limit
  reason, source PNG dimensions, smoothing state, WebGL filters, cache event,
  build time, and estimated memory.
- For the built-in E2 Gen2, the current source faceplate is
  `Devices/faceplates/library/barco-e2-gen2-barco-e2-gen2.png` at
  `1140 x 420`, while the logical device is `380 x 4269`.
- The old modular cap limited that full-device texture to roughly
  `730 x 8192` (`1.92x`). Iteration 40.4 allows taller modular textures to use
  a `16384` side budget when the GPU supports it, which gives this E2 roughly
  `1459 x 16384` (`3.84x`) before the GPU side limit applies.
- Load or place an E2 Gen2-style modular chassis and verify the Engine texture
  shows the real faceplate image, installed card names, card caption
  background/text colors, and compact card connector field boxes instead of
  empty dashed slot rectangles.
- Confirm the Engine device shell is one rounded shape only. There should be no
  square/corner rectangle behind the rounded cached texture.
- Confirm selected devices use one smooth orange Legacy-style glow behind the
  white device shell instead of hard repeated orange rectangles.
- Confirm connector circles are full circles outside the shell, not half-circles
  clipped into the cached device texture.
- Confirm connector labels stay visible beside the live connector circles.
- Confirm adapter/breakout devices are compact dashed transparent objects with
  their name above the dashed rectangle and internal fan-out wires visible.
- Confirm moving, selecting, hovering, panning, zooming, and wire edits do not
  rebuild device textures. Texture rebuilds should be caused by visual content
  changes or async faceplate image readiness only.
- Keep normal Engine checks active: drag/drop, compatibility, endpoint rewire,
  Bezier and 90-degree routing, custom corners, undo/redo, save/reload, and
  Legacy fallback.
- Do not migrate viewer/PDF/report visuals as part of this pass.

## Iteration 39 Focus

- Legacy source of truth: commit
  `8301fbf23c82f3e3f2496cb90234019c7bf47958`.
- This is an audit pass, not a renderer migration. The main deliverable is
  [`docs/legacy-interface-parity.md`](legacy-interface-parity.md).
- Confirm the visible top-bar label shows either
  `Iteration 39 — Engine Editor — iteration39` or
  `Iteration 39 — Legacy Editor — iteration39`.
- Review the interface matrix before starting the next UI migration pass. It
  maps Legacy functions, Engine functions, data fields, renderer impact,
  inspector impact, undo/save/report impact, risk, and recommended iteration.
- Keep normal Engine checks active: drag/drop, compatibility, endpoint rewire,
  Bezier and 90-degree routing, custom corners, undo/redo, save/reload, and
  Legacy fallback.
- Do not migrate viewer/PDF/report visuals as part of this pass.

## Iteration 38 Focus

- Legacy source of truth: commit
  `8301fbf23c82f3e3f2496cb90234019c7bf47958`, specifically
  `startConnection`, `connectionForEndpoint`, `restoreRewireConnection`,
  `preserveConnectionWithNewEndpoints`, `finishConnection`,
  `createConnectionBetween`, `createConnectionToJump`, and
  `createConnectionFromJumpToDevice`.
- Grab an occupied connector to begin a rewire. The original connection is not
  deleted; the fixed endpoint remains attached and the moving endpoint follows
  the pointer in one live preview.
- Engine suppresses the original wire from static, selected, hover, label, and
  route-handle layers during preview, preventing wire ghosts.
- Hover feedback and commit both use `engineCompatibilitySummary`. Jump nodes
  are validated as portals through the existing wire cable type; SFP/QSFP,
  CAT/USB, fiber-family, power/signal, direction, same-connector, and occupied
  target rules remain shared.
- `SceneGraph.rewireWireEndpoint` updates the existing wire and connector-owner
  indexes in place. `ProjectMutationAdapter.commitRewiredWire` changes only raw
  `from`/`to` on commit.
- `MoveWireEndpointCommand` is one undo step. Undo/redo restore the complete raw
  Legacy connection record, preserving custom metadata, cable type, label,
  length, notes, fiber mode, colors, and route arrays.
- Bezier route points and orthogonal stored doglegs stay unchanged. Orthogonal
  preview and post-commit rendering repair only the moving endpoint side through
  `orthogonalWirePoints`, so the route remains horizontal/vertical and editable.
- Escape, pointer cancel, lost capture, invalid targets, and empty-canvas drops
  cancel without mutating project data and restore the pre-rewire selection.
- Run model validation with `node scripts/engine-rewire-validation.mjs`.
- Test interactively with
  `index.html?engine=1&debugRewire=1&debugRouting=1&v=iteration40-4`.

## Iteration 37.8 Focus

- Legacy source of truth: commit
  `8301fbf23c82f3e3f2496cb90234019c7bf47958`, specifically
  `showWireContextMenu`, `showWireCornerContextMenu`, `createWireCornerAt`,
  `deleteWireCorner`, `resetWireRoutes`, `routePointInsertIndex`, and
  `routePointInsertion`.
- The restored wire menu uses the exact Legacy actions: `Create Corner`,
  `Select All Wires of Same Type`, and `Reset Wire Route(s)`. A visible route
  handle uses `Delete Corner` and `Reset Wire Route`.
- Bezier `Create Corner` projects the pointer onto the sampled rendered path,
  inserts that projected point in path order, and stores only the result in
  `routePoints`.
- Orthogonal `Create Corner` first materializes the automatic dogleg when the
  wire has no stored route, then inserts the single projected Legacy route
  point at the selected segment. The shared orthogonal model expands and
  repairs that state into strictly horizontal/vertical rendered segments; it
  does not invent a new two-point menu action.
- `Delete Corner` removes only the selected stored point and conservatively
  repairs an orthogonal route. `Reset Wire Route` clears Bezier custom points
  or rebuilds a clean editable automatic orthogonal dogleg while preserving the
  wire ID, endpoints, and metadata.
- The Engine actions are one undo step each:
  `AddRoutePointCommand`, `RemoveRoutePointCommand`, and
  `ResetWireRouteCommand`. They preserve the current wire selection and update
  only that wire in the Engine renderer and production project data.
- Route handles remain visible and hit-testable only while their wire is
  selected or actively edited. `debugRouting=1` records the target wire,
  projected point, segment, action, before/after points, command, validity,
  orthogonality, and selected wire.
- Test with
  `index.html?engine=1&debugHud=1&debugRouting=1&v=iteration37-8`.
- Endpoint rewiring is deliberately deferred to Iteration 38. Broader device,
  connector, chassis, faceplate, PD, output, and report context-menu migration
  is also outside this pass.

## Iteration 37.7 Focus

- Legacy source of truth: commit
  `8301fbf23c82f3e3f2496cb90234019c7bf47958` and its
  `previewOrthogonalWirePoints`, `freezeOrthogonalRoute`,
  `routeForConnection`, `connectionRouteSegments`,
  `startWireCornerDrag`, `moveOrthogonalCornerPoints`,
  `startWireSegmentDrag`, `wireSegmentSnapTargetsForDrag`,
  `wireSegmentSnap`, `repairMovedEndpointOrthogonalRoute`,
  `compactExcessOrthogonalRouteRuns`, `setSnapGuides`, and
  `renderSnapGuides` paths.
- Open
  `index.html?debugHud=1&debugRouting=1&orthogonalTest=1&v=iteration37-8`.
  The routing test buttons select the first 90-degree wire and copy the live
  Engine/production diagnostics.
- Orange handles now enter a true corner drag. Dragging a middle vertical or
  horizontal wire span enters a separate dogleg drag and moves its two adjacent
  corners together.
- The first and last connector stubs are protected. Live corner and dogleg
  edits are calculated from immutable pointer-down route points, not the route
  mutated by the previous pointer frame.
- Object Snapping uses the exact audited Legacy values: direct alignment plus
  `10, 15, 20, 25, 30px` lanes; `15px` is the default spacing. There is no
  `5px` lane in the reference commit.
- During an active segment snap, the Engine renderer receives the same blue
  temporary guide data via `interaction.snapGuides`. Drop, Escape, pointer
  cancel, and lost pointer capture clear it without saving it.
- `OrthogonalRouteModel` is data-only and shared by segment metadata, direct
  segment movement, true corner movement, rendering geometry, and route
  diagnostics. Existing `orthogonalRoutePoints` serialization is unchanged.

## Iteration 37.6 Focus

- Iteration 37.6 keeps the full Legacy 90-degree routing audit from commit
  `8301fbf` and tightens the Engine port around cleanup and moved-endpoint
  repair.
- Legacy snap distances are `[0, 10, 15, 20, 25, 30]`; `0` means direct
  parallel alignment and the other values are fixed spacing lanes. The audited
  Legacy commit does not include a `5px` segment-snap lane.
- Open `index.html?engine=1&debugHud=1&debugRouting=1&v=iteration37-8`, turn
  Object Snapping on, set the wire mode to 90 DEG, select an orthogonal wire,
  and drag a middle vertical dogleg near another parallel vertical wire.
  Confirm the blue guide/measurement helper appears while snapping.
- Drag the first editable vertical dogleg toward its connector/output node.
  Confirm the route keeps endpoint exit clearance, remains editable, and can be
  pulled through to the opposite side instead of getting stuck.
- Create or load a route with overlapping/collinear sections. Move devices and
  drag doglegs, then confirm useful orange corner handles do not disappear just
  because short straight runs overlap.
- Move only one endpoint device of a custom orthogonal route. Confirm the middle
  doglegs remain intact while only the endpoint side repairs.
- Drop the edited segment, undo, redo, save, and reload. Confirm the route
  remains orthogonal and the same dogleg can still be dragged again.

## Iteration 37.5 Focus

- Iteration 37.5 audited the full Legacy 90-degree routing block from commit
  `8301fbf`, including initial route creation, route freezing, segment drag,
  corner drag, moved-endpoint repair, route cleanup, wire labels, and snap
  helper rendering.
- Iteration 37.5 added `debugRouting=1` diagnostics for route normalization,
  snap, cleanup, orthogonality, endpoint clearance, and active segment edit
  state.

## Iteration 37.3 Focus

- Legacy spacing/snap was inspected at `8301fbf`: `ORTHOGONAL_WIRE_SPACING`
  is `15`, `WIRE_SEGMENT_SNAP_STEPS` is `[10, 15, 20, 25, 30]`,
  `wireSegmentSnapTargetsForDrag(...)` caches other connection segments at
  drag start, and `wireSegmentSnap(...)` snaps only during live segment drag
  when Object Snapping is enabled.
- Engine now stores the same constants in `src/engine/orthogonalRouting.js` and
  applies them through `snapOrthogonalSegmentFixed(...)`.
- `SceneGraph.orthogonalSegmentSnapTargetsForDrag(...)` gathers other
  orthogonal wire segments once per drag, and
  `SceneGraph.snapOrthogonalSegment(...)` applies endpoint and parallel-lane
  snap before `moveOrthogonalSegment(...)` mutates route points.
- `debugHud=1&debugRouting=1` reports default spacing, snap steps, target
  count, snap source, and before/after dogleg fixed coordinate.
- No new spacing UI was added because Legacy used the existing global Object
  Snapping toggle and stored only the resulting route point coordinates.

## Iteration 37.2 Focus

- Engine orthogonal wire hit-testing now promotes draggable middle segments to
  a segment-drag interaction instead of only selecting the wire.
- Segment drag moves the two adjacent stored interior route points together on
  one constrained axis: vertical doglegs move left/right and horizontal middle
  spans move up/down.
- Endpoint-attached stubs are protected with the same Legacy rule and remain
  locked to connector positions.
- Segment drops write through to production route data as one command,
  preserving save/load, undo/redo, and custom route state.
- Orthogonal corner-handle drags now promote to the adjacent segment-drag path
  where possible, and selected/hovered route handles on live affected wires are
  suppressed so old-position orange dots do not ghost during drag.
- Route handles are no longer baked into base wire geometry. They appear only
  as selected-wire or actively edited handles, and starting an object drag
  clears wire/route-point edit selection so selected cable dots cannot remain
  behind a moving device.
- `debugHud=1&debugRouting=1` exposes hovered segment state, active segment
  drag axis/fixed value, and before/current route point lists.

## Iteration 37.1 Focus

- Engine orthogonal routing now uses `src/engine/orthogonalRouting.js` as the
  shared data-only repair helper.
- Route-point drag, live device/jump-node/LED-surface drag, multi-drag, drop
  commit, undo/redo, and production write-through all preserve 90-degree
  orthogonal routes through the same helper path.
- Saved connections with `orthogonalRoutePoints` load as orthogonal wires
  regardless of the current toolbar drawing mode.
- Move commands now capture affected wire route states as well as device
  positions, so undo/redo restores exact orthogonal/custom route handles.
- `debugHud=1&debugRouting=1` exposes selected route mode, stored/rendered
  point counts, endpoint positions, endpoint owners, and hop count in the HUD.

## Iteration 37 Focus

- Engine wire creation now uses a shared data-only connector compatibility
  helper based on Legacy commit `8301fbf23c82f3e3f2496cb90234019c7bf47958`.
- Hover target feedback and final wire-create commit use the same rule, so a
  red temporary wire cannot be committed accidentally.
- The helper covers effective connector type, dead SFP/SFP+/QSFP cages, active
  transceiver modules, CAT-family compatibility, USB-family compatibility,
  paired-network and two-way direction exceptions, same-connector blocking, and
  input/output direction blocking.
- Iteration 36.1 specifically hardens installed SFP/SFP+/QSFP module handling:
  empty cages remain invalid, installed LC modules expose `fiber-lc`, installed
  MPO modules expose `fiber-mpo`, RJ45 modules expose the CAT family, and
  incompatible installed modules remain rejected.
- Iteration 37 preserves that installed module metadata through
  `SceneGraph.setData()` and syncs connector inspector module/fiber changes into
  the active Engine scene without a full scene reload.
- Iteration 37 restores Legacy fiber-mode semantics for SFP/SFP+/QSFP modules:
  empty cages remain invalid, LC singlemode cages only connect to singlemode LC
  endpoints, LC multimode cages only connect to multimode LC endpoints, RJ45 SFP
  modules behave as CAT/network, and QSFP MPO modules connect only to MPO fiber.
- Iteration 37 also carries `fiberMode` through Engine wire creation,
  production mutation write-through, save/load normalization, undo/redo command
  data, and debug compatibility diagnostics. Fiber wire colors use the Legacy
  mapping: OS1/OS2 yellow, OM1/OM2 orange, OM3 aqua, OM4 violet, and OM5 lime.
- `debugHud=1` or `debugCompatibility=1` exposes compatibility rule/type
  diagnostics while drawing a new wire, including raw cage type, installed
  module id/name/type/value, effective connector type, direction, rule, and
  rejection reason.
- `scripts/engine-compatibility-validation.mjs` covers the standalone rule
  matrix. `scripts/engine-real-project-validation.mjs` now creates validation
  wires only from a genuinely compatible connector pair.

## Iteration 35.3 Focus

- `debugLibraryDrag=1` shows a visible Library Drag Debug panel during real
  Device Library pointer drags. It reports mode/build state, active Engine and
  Legacy canvas bounds, pointer location, drop world coordinates, create command
  status, created IDs, renderer insert status, selection status, validation, and
  a capped event log.
- The **Copy drag diagnostics** button copies the current snapshot plus the last
  drag events so a failed manual workflow can be pasted back without relying on
  browser devtools.
- A successful Engine device drop should show this sequence: `library
  pointerdown`, `library drag start`, `pointermove`, `document pointerup while
  library dragging`, `canvas drop received`, `create-device command called`,
  `create-device command received`, `renderer insert called`, `validation
  result`, `selected new device`, and `create-device command success`.
- The overlay is diagnostic-only and is enabled only by URL flag. Normal Engine
  and Legacy editor sessions do not show it.

## Iteration 35.2 Focus

- The real Device Library pointer-drop path now tests against the active Engine
  canvas, not the hidden Legacy SVG canvas.
- Engine drops use the Engine bridge's client-to-world conversion, so panned or
  zoomed Engine canvases place the device at the intended world coordinate.
- The document pointerup handler is captured before Engine canvas handlers can
  consume the event, which keeps the existing floating drag ghost workflow
  connected to Engine canvas drops.

## Iteration 35 Focus

- Engine mode now intercepts successful Device Library drops after Legacy has
  done the existing pointer tracking, ghost movement, canvas hit testing, and
  `getCanvasPoint(...)` coordinate conversion.
- The new drop path reuses the Legacy preparation semantics for normal devices,
  project custom devices, and paired-device entries:
  `prepareDeviceInstanceFromTemplate(...)` and
  `prepareDevicePairInstances(...)` hydrate the same production-shaped
  instances that Legacy uses.
- `ProductionEngineBridge.createDeviceFromLibraryDrop(...)` and
  `createDevicesFromLibraryDrop(...)` commit those production-shaped instances
  through a first-class Engine create-device command.
- The command writes into production `devices[]`, inserts normalized devices
  into the Engine `SceneGraph`, updates connector ownership/spatial indexes,
  appends the new device geometry/texture to the WebGL renderer, selects the
  created device(s), and records one undo step.
- Undo removes the created device(s); redo restores the same device data and ID
  at the original insertion index where practical.
- The validation script now includes a create-device execute/undo/redo cycle and
  serializes/reloads after each stage, guarding unique IDs, connector
  normalization, production compatibility, and runtime-field leakage.
- Rack library creation is still intentionally deferred to the rack parity
  iteration. LED screen/import creation is also not changed here unless it is
  represented as a normal device template in the Device Library.
- Connector compatibility is still the next functional blocker. Iteration 35
  does not change the existing Engine wire compatibility behaviour.

## Iteration 34 Focus

- Standalone HTML export and hosted publish still generate a self-contained
  viewer through `buildStandaloneHtml(...)`, but that viewer now embeds a copied
  Engine-style wire geometry helper block for Bezier, custom-routed, and
  orthogonal/custom-corner wires.
- Viewer cable hops are now calculated from sampled wire polylines with a
  runtime-only spatial grid, then applied as point geometry before the SVG path
  is drawn. Hop information is not serialized into `.avd`, JSON, publish
  payloads, or saved project files.
- Viewer wire labels now use the same sampled route polyline used for drawing,
  so labels track Bezier/custom/orthogonal wire shapes more consistently.
- Jump nodes are still drawn after wires in the standalone viewer layer order,
  so jump-node bodies and labels remain above regular and selected wires.
- `src/engine/wirePath.js` and `src/engine/cableHops.js` remain the canonical
  helper shape. The standalone viewer uses an embedded copy because exported
  HTML must open locally and hosted without module imports.
- PDF export still snapshots the production SVG canvas through
  `wirechartSvgMarkup(..., { forceLight: true })`. Moving PDF drawing onto the
  shared Engine helpers would require a separate data-driven SVG output path,
  not a clone of the live canvas.
- Report tables are data-only; the visual wirechart section in the printable
  PDF is the only report path that currently depends on SVG wire rendering.
- Iteration 34 deliberately avoids saving cable-hop data. Cable hops remain a
  runtime/output calculation and do not change the `.avd` or JSON format.
- PDF visual migration remains deferred until a dedicated data-driven PDF output
  renderer can be introduced without breaking the current printable PDF
  workflow.

## Iteration 32 Focus

- Save, Save As, standalone HTML export, hosted publish, editor report, and PDF
  report still use `projectSnapshotData()` as the compatibility boundary.
- Engine runtime-only fields such as cable-hop maps, drag sessions, selection
  sets, WebGL buffers, and texture/cache fields must not appear in saved,
  exported, or published project payloads.
- The validation script now checks duplicate IDs, orphan connection endpoints,
  finite custom route points, compact viewer template coverage, report cable
  quantity totals, and runtime-field leakage on each command round trip.
- Standalone HTML export and hosted publish still compact the device library to
  templates used by placed devices and rack devices, then inline required image
  assets for viewer portability.
- PDF export still snapshots the production SVG canvas through
  `wirechartSvgMarkup(..., { forceLight: true })`. This preserves the current
  PDF pipeline while the Engine renderer remains focused on interactive editing.
- The hosted `viewer.html` page is still a password gate and iframe wrapper. It
  does not contain the production renderer itself; it loads the generated
  standalone HTML returned by the publish API.
- If a project edited in Engine mode opens correctly in Legacy mode and the
  validation script reports no compatibility leaks, downstream output data is
  considered safe for this iteration.

## Iteration 31 Focus

- Engine Editor now calculates cable-hop visuals from sampled wire polylines at
  runtime. Hop information is not saved in project data and does not change the
  `.avd`/JSON format.
- The hop owner is deterministic and mirrors Legacy: the later wire in the
  scene wire order hops over the earlier wire.
- Engine hop detection supports default Bezier wires, custom-routed wires, and
  orthogonal/custom-corner wires because it runs on the common sampled render
  polyline.
- A spatial grid limits crossing candidates before segment intersection tests.
  This avoids the obvious full pairwise segment scan in dense projects.
- Static wire geometry, selected-wire overlays, hovered-wire overlays, and
  route-point handles all use the same runtime hop map when idle.
- During active device/jump-node drags, affected wires intentionally skip hop
  geometry in the live drag overlay. The final dirty update recalculates and
  restores hops after drop.
- During route-point drags, the affected wire keeps the previous hop map while
  the pointer is moving, then finalizes with recalculated cable hops on release.
- Debug HUD rows report hop count, wires with hops, calculation time, crossing
  candidates, actual crossings, changed wires, affected recalculation count,
  and whether the last hop update was deferred.
- Export, reports, and the technician viewer are not migrated in Iteration 31;
  they keep using the existing production/export hop logic.

## Iteration 30.3 Focus

- Engine low-zoom detail hit-testing is suppressed below 50% zoom. Connector
  nodes, port hotspots, and route-point handles no longer steal hover, click,
  or context targets when the user is zoomed far out.
- Jump nodes are exempt from the low-zoom detail-target rule. They remain
  object-level hover, selection, drag, and marquee targets at every zoom.
- Active wire creation keeps connector hit-testing enabled while a wire is being
  dragged, so existing wire-create target behavior is preserved.
- Legacy Editor, export, reports, viewer, and save/load data remain unchanged.

## Iteration 30.2 Focus

- Engine marquee selection now includes jump nodes at normal editing zooms.
  Devices, adapters, and LED surfaces remain marquee-selectable at every zoom.
- Idle node-level hit-testing is suppressed below 40% zoom. Connector nodes,
  jump nodes, and route-point handles no longer steal hover, click, or context
  targets when the user is zoomed far out.
- Active wire creation keeps connector hit-testing enabled while a wire is being
  dragged, so existing wire-create target behavior is preserved.
- Below 40% zoom, marquee selection intentionally ignores jump nodes to match
  the low-zoom node suppression rule.
- Legacy Editor, export, reports, viewer, and save/load data remain unchanged.

## Iteration 30.1 Focus

- Engine marquee selection is visible again. Empty-canvas left-drag now creates
  a screen-space overlay with a blue translucent fill and border above the
  WebGL/label canvases.
- Marquee selection uses the same additive modifier helper as click selection:
  Shift, Cmd/Meta, and Ctrl.
- Marquee selection currently includes devices, adapters, and LED surfaces.
  Wires and route-point corners are deliberately excluded from marquee
  selection in this cleanup pass to avoid mixing object selection with wire
  edit state.
- A normal empty-canvas click below the drag threshold keeps the Iteration 30
  empty-canvas clear behavior.
- Ctrl-left-click additive selection suppresses only the browser context menu
  caused by that Ctrl-left-click. Real right-click/contextmenu still forwards
  to the existing production menus.
- Marquee state is cleaned up on Escape, pan start, zoom, context menu,
  pointercancel, pointerleave without capture, lost pointer capture, and scene
  refresh.

## Iteration 30 Focus

- Engine Editor selection now keeps one active selection family at a time:
  object selections clear stale wire/connector/route-point selections, wire
  selections clear object/connector state, and Escape clears selection when no
  interaction is active.
- Empty-canvas clicks still start the existing Engine marquee path and clear the
  current selection unless a selection modifier is held.
- Shift, Cmd, and Ctrl act as Engine multi-select modifiers for object and wire
  toggling. This is intentionally broader than the older Shift-only path and is
  documented as an Engine convenience.
- Pointer capture is now taken only for left-button Engine interactions or
  middle-button pan. Right-click no longer starts or captures a drag path.
- Right-clicks in Engine mode use Engine hit testing, then forward device, LED
  surface, wire, and wire-corner targets to the existing production context
  menus. Connector and jump-node context menus remain intentionally limited:
  they select/update the inspector but do not open a new menu yet.
- Hover state is cleared on pan start, zoom, empty-canvas selection changes,
  completed/cancelled drags, completed wire creation, Escape, pointercancel, and
  lost pointer capture.
- Cursor state is centralized in the bridge and reported in the optional HUD:
  loading uses wait, pan/drag uses grabbing, objects/route points use grab,
  connectors/wire creation/marquee use crosshair, and wires use pointer.
- Engine hit-test priority is explicit in the bridge: route-point handles,
  connectors, wires, objects/jump nodes/LED surfaces, then empty canvas.
  Wire/device labels are rendered on the label canvas and are not hit targets.
- No renderer, export, viewer, report, or save/load format migration is part of
  Iteration 30.

## Iteration 29.9 Focus

- Engine device labels are constrained to the device screen rectangle so
  constant-screen-size text cannot overflow across nearby devices at low zoom.
- Device labels truncate when enough room remains for a useful caption, and hide
  when the device becomes too small to contain readable text.
- The existing zoomed-out hover tooltip remains the full-name reveal path.
- Wire labels, route-point labels, jump-node z-order, and Legacy rendering are
  intentionally unchanged.

## Iteration 29.8 Focus

- Idle selected and hovered wire emphasis is drawn below a lightweight
  jump-node foreground pass, so selected wires remain readable without covering
  jump-node bodies or rings.
- Connector feedback, wire-create previews, route-point handles, and marquee
  overlays still draw after the jump-node foreground pass so edit affordances
  remain visible.
- Wire labels remain on the label canvas after WebGL geometry, so selected wire
  labels remain readable while jump-node labels are not duplicated.
- Debug layer mode now records `jumpForegroundLayer` for visible jump nodes so
  selected-wire z-order issues can be diagnosed directly.

## Iteration 29.7 Focus

- If a wire is affected by an active drag, every stale/static representation of
  that wire is suppressed, including static wire geometry, selected-wire
  overlays, hover-wire overlays, and stale labels.
- Affected selected/hovered wires are drawn once in the live drag overlay using
  selected/hover styling at the moving endpoint positions.
- Jump nodes remain visually above affected wires during drag. Wire hover or
  selection overlays must not be drawn after the dragged jump-node body.
- Debug layer mode now lists selected wires, affected selected wires, and the
  affected hovered wire so duplicate selected/hover ghosts can be diagnosed.

## Iteration 29.6 Focus

- Affected wires are resolved through connector ownership, not only through
  normal device IDs. Jump nodes, LED surfaces, and future virtual connector
  owners must all use the same lookup path.
- During drag, every affected wire must be skipped by the static wire layer and
  drawn once by the live drag wire overlay.
- During drag, every unaffected wire must remain in the static wire layer and
  must not be drawn by the live drag wire overlay.
- Debug layer mode now lists affected wire endpoint owners (`from owner` and
  `to owner`) so stale/duplicate wire layer bugs can be diagnosed directly.
- Test with `index.html?debugHud=1&debugLayers=1&v=iteration29-9`, drag a
  connected jump node, and confirm each connected wire reports
  `staticWireLayer: skipped` and `liveDragWireOverlay: drawn-moving`.
- Bezier and custom-routed wires connected to jump nodes must keep their route
  points and follow the moving jump node without leaving a stale static copy.
- Legacy Editor remains unchanged.

## Iteration 29 Focus

- Engine Editor is the default editing path.
- Legacy Editor remains the fallback through `legacy=1` or `engine=0`.
- The Iteration 27.5 loading overlay remains intact. Pointer and keyboard canvas
  actions stay blocked while the engine is loading.
- Connector markers in Engine are drawn as Legacy-style circular nodes with a
  white rim instead of square placeholders.
- Connector hover is rendered as a lightweight blue live overlay.
- Connector selection is rendered as a lightweight orange live overlay and now
  updates the temporary Engine Inspector with connector details.
- Wire creation highlights the source connector, target connector, and invalid
  same-connector target without changing save/load data.
- Connector hit testing uses the existing spatial connector index and a
  Legacy-sized screen-space tolerance.
- Connector tooltips are drawn on the label canvas for hovered/selected/target
  connectors only, so labels do not block hit testing.
- Cursor feedback changes to crosshair over connectors and during wire creation.
- Normal/default engine wires render as fixed-sample Bezier curves using the
  same control-point rule as Legacy.
- Engine wire hover and selection render as live overlays without rebuilding the
  static scene.
- Engine wire labels use the existing label canvas so captions do not intercept
  pointer events.
- Engine object hover and selection outlines are drawn as live overlays, not as
  texture changes.
- Engine object labels use the label canvas, with stronger selected/hovered
  treatment and a zoomed-out hover tooltip.
- Jump nodes and LED surfaces use the same object hover/selection overlay path
  as regular devices.
- Wire labels follow the legacy detail rule: visible at close zoom, and always
  visible for selected/hovered wires.
- Custom route-point handles use the legacy orange circular handle affordance.
- Custom route-point wires remain routed through their stored points.
- Orthogonal route-point wires remain straight-segment orthogonal paths.
- Wire hit-testing and spatial indexing use the same sampled render path.
- Debug HUD and layer diagnostics remain opt-in through the HUD button,
  `debugHud=1`, or `debugLayers=1`.
- Validation covers isolated command cycles and a longer mixed edit chain.
- Cable-hop rendering is not migrated into the engine visual path yet; existing
  production/export/viewer hop logic remains untouched.
- Export, reports, and viewer rendering are not migrated in Iteration 29.9.
- Newly created wires now use only the central wire-selection state for orange
  selection glow. Dirty GPU update IDs remain internal bookkeeping and no longer
  paint stale selected-wire overlays or forced stale labels.

## Status Legend

- `covered`: tested and expected to match production-compatible behavior.
- `partial`: useful coverage exists, but not enough to make engine default.
- `not covered`: no reliable validation yet.
- `not intended yet`: deliberately outside the current engine-bridge scope.

## Feature Parity Matrix

| Feature | Production behavior | Engine behavior | Status | Test method | Risk level | Notes |
|---|---|---|---|---|---|---|
| project load | Loads `.avd`/JSON into production state and SVG canvas. | Normalizes production state into `SceneGraph` behind `?engine=1`. | covered | Manual load plus validation script. | medium | Real project currently validates with 141 objects and 267 wires. |
| project save/reload | Existing save reads production state. | Engine commands write through to production state. | covered | Validation script serializes/reloads after every command stage. | medium | Uses JSON serialization directly to avoid mutating debug stats. |
| production mode opening engine-edited files | Production renderer opens saved project data. | Engine edits mutate existing production format. | partial | Script round-trips project data; manual production visual check still needed. | medium | Export/viewer migration is not part of engine bridge yet. |
| device selection | Click selects one device and inspector updates. | Engine hit-test selects one object and syncs selection. | covered | Manual engine smoke. | low | Repeated-click offset bug fixed before this pass. |
| multi-device selection | Marquee/keyboard selection selects several objects. | Engine marquee selects multiple objects. | partial | Manual smoke and drag session checks. | medium | Advanced production selection gestures need broader manual coverage. |
| wire selection | Click wire selects it for inspector/delete. | Engine wire hit-test selects wire. | covered | Manual smoke and validation script delete cycle. | medium | Dense projects still need UX tuning, but data path is covered. |
| connector selection | Click connector selects connector / starts wire draw with circular node feedback. | Engine connector hit-test selects connector, starts wire create, shows circular overlay feedback, and updates the temporary inspector. | covered | Manual Engine vs Legacy connector compare plus HUD connector metrics. | medium | Deeper cable-type compatibility feedback remains future work. |
| device move | Drag updates device and connected wires. | Drag session commits one position update. | covered | Validation script single move execute/undo/redo. | low | No texture rebuild should happen for position-only move. |
| multi-device move | Selected group moves together. | One drag session and one mutation for selected group. | covered | Validation script 20-device move execute/undo/redo. | medium | Visual/manual stress remains useful on very large projects. |
| route point move | Custom route points can move and save. | Route point command writes back to production connection. | covered | Validation script route point move execute/undo/redo. | medium | Custom corner geometry is preserved as data points. |
| custom route point preservation | Route points survive redraws, save/load, undo/redo. | Validator checks parity against production data after each command. | covered | Validation script route point and delete/restore cycles. | low | Route points should only change in route point command or deletion. |
| wire create | Connector-to-connector creates production connection. | Engine creates scene wire and production connection. | covered | Validation script create wire execute/undo/redo. | medium | Compatibility rules are still production-owned. |
| wire delete | Selected wire deletes from canvas and project. | Engine deletes selected scene wire and production connection. | covered | Validation script delete wire execute/undo/redo. | medium | Restored wire keeps original ID and metadata. |
| wire undo/redo | Undo/redo restores/deletes one wire step. | Command-shaped script validates undo/redo boundaries. | covered | Validation script create/delete cycles. | medium | Browser command stack smoke still useful. |
| device move undo/redo | One move is one undo step. | Engine command stores before/after positions. | covered | Validation script single move cycle. | low | Bridge command stack tested manually in previous pass. |
| multi-device undo/redo | One group move is one undo step. | Engine command stores batch before/after positions. | covered | Validation script 20-device move cycle. | medium | Script verifies no unrelated devices move. |
| route point undo/redo | Restores previous route points. | Engine command stores before/after route point arrays. | covered | Validation script route point cycle. | low | Script verifies unrelated wires unchanged. |
| selection sync to inspector | Production inspector reflects selected object. | Temporary engine inspector reflects engine selection. | partial | Manual engine smoke. | medium | Full production inspector parity is not the end-state yet. |
| engine temporary inspector | Not present in production. | Shows current engine selection details. | covered | Manual engine smoke. | low | Intended debug surface, not final UI. |
| production inspector compatibility | Inspector edits production data. | Engine mode should not corrupt production inspector data. | partial | Script validates production state; manual UI editing still separate. | medium | Production inspector is not migrated. |
| keyboard shortcuts | Delete, Escape, undo/redo work in production. | Delete/Backspace, Escape, Cmd/Ctrl-Z work in engine mode. | partial | Manual smoke. | medium | More platform/browser shortcut checks needed. |
| Delete/Backspace selected wire deletion | Deletes selected wire. | Deletes selected engine wire and writes through. | covered | Manual smoke and delete wire script. | low | Selection clears/updates through engine inspector. |
| Escape cancel behavior | Cancels tools/drag state. | Cancels active engine interactions. | partial | Manual repeated-click/drag checks. | medium | Automated browser interaction test is still useful. |
| pan/zoom behavior | Production SVG pan/zoom. | WebGL pan/zoom with engine renderer. | covered | Manual real project testing. | low | User confirmed speed is good enough. |
| WebGL visual path | Default editor path, with legacy fallback available. | Engine renderer draws scene in WebGL. | covered | Manual `index.html` and `?engine=1`; HUD shows engine active. | medium | Still not export/viewer path. |
| default Bezier wires | Production default wires use Bezier curves. | Engine default wires now use sampled legacy-style Bezier geometry. | covered | Visual compare Engine vs Legacy and HUD wire-path counts. | medium | Fixed sample count avoids drag/drop buffer churn. |
| custom routed wires | Production route points draw routed paths. | Engine custom route-point wires render through stored route points. | covered | Fixture/real project validation plus route point drag smoke. | medium | Stored data is unchanged. |
| orthogonal route wires | Production orthogonal points draw straight segments. | Engine preserves orthogonal route-point provenance and straight segments. | partial | Data validation and visual smoke. | medium | Global orthogonal auto-routing is not migrated. |
| texture rebuild behavior | Production SVG has no texture cache. | Engine tracks texture counts and warnings. | partial | HUD metrics and manual drag checks. | medium | No continuous validation during drag. |
| cable hops | Production supports runtime visual cable hops. | Engine calculates runtime hop geometry from sampled wire polylines, with affected wires simplified during drag and finalized after drop. | partial | Engine vs Legacy visual compare plus `debugHud=1` hop metrics. | high | Export/viewer/report hop paths remain production-owned for now. |
| rack/internal wires | Production supports rack/internal wires. | Engine adapter maps supported production connections. | partial | Scene validation catches missing endpoints. | high | Deep rack editor parity remains future work. |
| jump nodes | Production jump nodes and source/destination boxes. | Engine maps jump nodes as objects/connectors. | partial | Fixture includes jump node connection. | medium | Full jump-node UI parity is future work. |
| LED surfaces | Production LED grid object and signal ports. | Engine maps LED surfaces with virtual surface ports. | covered | Scene validation accepts virtual `surface-port-*` endpoints. | medium | Visual fidelity still production-only. |
| reports compatibility | Production reports read project state. | Engine write-through should keep report data readable. | partial | Script validates production data shape. | medium | Reports are not migrated to engine renderer. |
| viewer/export compatibility | Production export/viewer use existing renderer/data. | Engine does not change export/viewer. | not intended yet | Keep normal export tests separate. | high | Do not migrate until engine parity is stronger. |
| normal `index.html` without flags | Engine editor path. | Engine bridge mounts and uses production data. | covered | Browser smoke. | low | Iteration 27 default engine path. |
| `index.html?engine=1` | Explicit engine editor path. | Engine bridge mounts and uses production data. | covered | Browser smoke. | low | Kept for existing test links. |
| `index.html?legacy=1` / `?engine=0` | Legacy production SVG editor. | Engine bridge does not mount. | covered | Browser smoke. | low | Safe fallback if engine default breaks. |
| debug loading overlay | Not production behavior. | `debugLoad=1` / `loadDelay=` holds readiness. | covered | Browser smoke. | low | Diagnostic only. |
| manual scene validation | Not production behavior. | Button runs shared validator on demand. | covered | Browser smoke and script. | low | Does not run during drag. |
| performance HUD | Not production behavior. | Available through HUD button or `debugHud=1`. | covered | Browser smoke. | low | Diagnostic only and hidden by default in engine editor. |
| real-project validation script | Not production behavior. | Script validates data operations without browser. | covered | Node script against real `.avd`. | low | Uses private local project path only when explicitly run. |
| synthetic fixture validation | Not production behavior. | Committed synthetic fixture covers command cycles. | covered | `--fixture` script run. | low | No private project data committed. |

## Guardrails

- Do not remove legacy fallback until production/export/viewer parity is proven.
- Keep `?engine=1`, `?engineDefaultTest=1`, `?legacy=1`, and `?engine=0`
  routing working during Iteration 27 visual parity work.
- Do not run validation during drag.
- Do not rebuild device textures for position-only moves.
- Do not add report/export recalculation to pointermove or drag/drop paths.
- Keep custom route points, jump-node data, cable hops, and rack/internal wire data intact.
- Treat engine HUD warnings as diagnostics only, not blocking errors.
