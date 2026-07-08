# AV Designer Engine Mode Feature Parity Matrix

Iteration 33 audits the visual-output boundary between the default Engine Editor
and the existing save, report, PDF, hosted publish, and standalone technician
viewer paths. Engine editing writes through to the production project data
model, and those downstream outputs still read from `projectSnapshotData()`.

This is a compatibility-hardening pass, not a renderer migration. The existing
viewer/export/report/PDF code paths stay in place. Engine cable-hop geometry is
runtime-only and is not saved into `.avd` or JSON project data. The exported
viewer and PDF drawing still use the existing production/export rendering paths.
Iteration 33 adds shared-helper output diagnostics before any renderer migration,
so small visual differences from the Engine canvas are expected until those
outputs are migrated deliberately.

The legacy production SVG editor remains available as a safe fallback behind
explicit URL flags.

Current visible build label: `Iteration 33`.
The app top bar must show one of these labels:

- `Iteration 33 — Engine Editor — iteration33`
- `Iteration 33 — Legacy Editor — iteration33`

The commit/build identity is a static standalone HTML label, so use the actual
Git commit as the final source of truth when reviewing a pushed change.

## How To Test

1. Open the default engine editor: `index.html`.
2. Open the default engine editor with cache busting:
   `index.html?v=iteration33`.
3. Open the explicit engine editor: `index.html?engine=1&v=iteration33`.
4. Open the compatibility default-test alias:
   `index.html?engineDefaultTest=1&v=iteration33`.
5. Open the legacy editor fallback:
   `index.html?legacy=1&v=iteration33`.
6. Open the alternate legacy fallback:
   `index.html?engine=0&v=iteration33`.
7. Open the debug loading guard:
   `index.html?engine=1&debugLoad=1&v=iteration33`.
8. Open a timed loading guard:
   `index.html?engine=1&loadDelay=1500&v=iteration33`.
9. Open the expanded engine HUD:
   `index.html?engine=1&debugHud=1&v=iteration33`.
10. Confirm the top bar build label matches the mode you intended to test.
11. Switch from engine to legacy with the toolbar mode switch; switch back by
   using the same control in legacy mode.
12. Disable engine temporarily by using `legacy=1` or `engine=0`.
13. Load a real `.avd` or `.json` project.
14. During project loading, confirm the Engine Editor loading overlay appears,
   shortcut/delete/drag interaction is blocked, and the overlay hides only after
   the first engine frame is ready.
15. Use **Validate Engine Scene** after loading and after edits.
16. Run the fixture validation:
   `node scripts/engine-real-project-validation.mjs --fixture`
17. Run the real-project validation:
   `node scripts/engine-real-project-validation.mjs "/path/to/project.avd"`
18. The validation script now includes a long mixed undo/redo chain. Confirm the
   JSON output contains a `longChain` section and all `checks` are `ok: true`.
19. Compare Engine and Legacy connector behavior with the same project:
   `index.html?v=iteration33` beside
   `index.html?legacy=1&v=iteration33`.
20. In `index.html?engine=1&debugHud=1&v=iteration33`, confirm the HUD
   `load phase`, `load ready`, `wire paths`, `connector overlay`, and
   `connector tooltips` rows update.
21. Hover and select wires in Engine mode. Confirm hover/selection feedback is
   visibly distinct, selected/hovered labels appear, route-point handles are
   round orange controls, and labels do not block wire selection.
22. Hover connectors in Engine mode. Confirm the cursor changes to a crosshair,
   circular connector hover feedback appears, and a small tooltip follows the
   hovered connector.
23. Click a connector. Confirm the inspector shows connector details, selected
   connector state is orange, and selecting a device or wire clears connector
   selection.
24. Start a wire from a connector. Confirm the source connector highlights blue,
   valid target connectors highlight green, and dropping back on the same
   connector is treated as invalid.
25. Create a new wire, then click empty canvas. Confirm the wire deselects and
   loses the orange selected glow.
26. Create another new wire, then select an existing wire, device, and connector
   in turn. Confirm only the actual current selection is highlighted.
27. Delete, undo, and redo a newly created wire. Confirm the restored/redone wire
   can still be selected and deselected normally.
28. Hover normal devices, jump nodes, LED surfaces, and adapters. Confirm a
   lightweight blue object outline appears without texture rebuilds.
29. Select one object and several objects. Confirm selected objects use the
   orange multi-layer outline and selected labels stay readable.
30. Zoom out below the detail threshold and hover a device. Confirm the fast
   black hover tooltip follows the pointer and does not block selection.
31. Hover and click jump nodes. Confirm the jump node renders as one circular
   object, not a square body plus separate selected connector ring.
32. Start a wire from a normal connector and hover/drop on a jump node. Confirm
   the jump endpoint can still act as the wire target without leaving a stale
   connector selection overlay.
33. Open `index.html?engine=1&debugHud=1&debugLayers=1&v=iteration33`, drag
   a connected jump node with its connected wire selected, and confirm no stale
   selected or hovered wire remains at the original jump-node position.
34. In the debug layer panel for that same drag, confirm the connected wire has
   `staticWireLayer: skipped`, `selectedWireOverlay: suppressed-affected` when
   selected, `hoverWireOverlay: suppressed-affected` when hovered,
   `liveDragWireOverlay: drawn-moving-selected` or `drawn-moving-hover`, and
   endpoint owner details that resolve the jump endpoint to the jump object.
35. Drag a normal connected device and a multi-selection with connected wires.
   Confirm those wires still follow live and do not leave static ghosts.
36. Select an idle wire connected to a jump node. Confirm the selected orange
   wire emphasis remains visible but does not cover the jump-node body, ring,
   or readable label. Repeat after pan/zoom and with hovered wire emphasis.
37. Zoom out on devices with long names. Confirm device labels are clipped or
   truncated inside their device bounds, then hidden when the device is too
   small to hold readable text.
38. At low zoom, hover a device with a hidden/truncated label. Confirm the fast
   black hover tooltip still shows the full device name.
39. With the expanded engine HUD open, confirm `device labels hidden` and
   `device labels truncated` update as zoom changes.
40. Compare cable crossings in Engine and Legacy with the same project:
    `index.html?v=iteration33` beside
    `index.html?legacy=1&v=iteration33`.
41. In Engine, inspect Bezier, custom-routed, orthogonal/custom-corner, and
    jump-node-connected wire crossings. Confirm hops are visible and stable
    after pan/zoom.
42. Drag a connected device or jump node through a dense crossing area. Confirm
    affected moving wires draw once, without stale hop marks, and final hops
    return after drop.
43. Drag a route point near a crossing. Confirm the wire remains editable while
    moving and cable hops finalize after release.
44. Open `index.html?engine=1&debugHud=1&v=iteration33` and confirm the HUD
    rows `cable hops`, `cable hop calc`, `cable hop candidates`, and
    `cable hop dirty` update.

45. Run the fixture validation and confirm the JSON output includes
    `outputVisual` rows for `initial`, `final`, and `chain final redo state`.
46. Run the real-project validation and confirm each `outputVisual` row reports
    finite base polylines, finite hopped polylines, and `deterministic: true`.
47. Export a standalone HTML viewer and a PDF report from an Engine-edited
    project. Confirm they still open and render using the existing output paths;
    this pass validates helper safety but does not replace those renderers.

## Iteration 33 Focus

- Engine wire geometry is now exercised from the real validation script as a
  data-only output helper smoke test. It samples Engine wire polylines, runs the
  runtime cable-hop helper, applies hop geometry, and checks that the result is
  finite and deterministic.
- `src/engine/wirePath.js` and `src/engine/cableHops.js` remain DOM/WebGL-free
  enough to be used by scripts and future output-renderer work. They do not need
  live Engine renderer state, textures, selection state, debug HUD state, or
  browser DOM nodes.
- Standalone HTML export and hosted publish still generate a self-contained
  viewer through `buildStandaloneHtml(...)`. That generated viewer currently
  contains its own inline wire path, label, and cable-hop functions so it can be
  opened locally or hosted without module imports.
- PDF export still snapshots the production SVG canvas through
  `wirechartSvgMarkup(..., { forceLight: true })`. Moving PDF drawing onto the
  shared Engine helpers would require a separate data-driven SVG output path,
  not a clone of the live canvas.
- Report tables are data-only; the visual wirechart section in the printable
  PDF is the only report path that currently depends on SVG wire rendering.
- Iteration 33 deliberately avoids saving cable-hop data. Cable hops remain a
  runtime/output calculation and do not change the `.avd` or JSON format.
- Direct viewer/PDF visual migration is deferred until a dedicated output
  renderer can be introduced without breaking the portable standalone viewer or
  the current printable PDF workflow.

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
