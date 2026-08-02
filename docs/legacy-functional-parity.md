# Legacy Functional Parity Audit

Source of truth for this audit:

- Legacy reference: `8301fbf23c82f3e3f2496cb90234019c7bf47958`
- Current branch audited: `engine-prototype`
- Current build label: `Iteration 50`

Iteration 50 is a shell-layer parity pass. Toolbar state, side-panel widths,
active editor tabs, open menus/modals, focus, and diagnostic HUD state are
editor runtime state only; they are not new project save data and should not
change `.avd` or JSON project compatibility. Canvas-mutating toolbar and
shortcut actions continue to call existing Engine/Legacy command paths, while
`debugShell=1` verifies shell interactions do not cause full Engine scene
rebuilds.

Iteration 49 restores Matrix Routing as an Engine-owned logical state path.
Legacy marks matrix-capable templates with `isMatrixRouter`, enumerates eligible
input/output connectors through `effectiveTemplateConnectors` and
`connectorIncludedInMatrix`, stores routes as
`instance.matrixRoutes = { [outputConnectorId]: inputConnectorId }`, and treats
crosspoints as internal logical routes rather than canvas cables. Engine now
normalizes the same route object, uses one `MatrixRoutingCommand` per modal
change, writes through to production data without a full render, preserves
modal scroll/focus on undo/redo refresh, and validates route parity during
fixture and real-project validation.

Iteration 48.2 restores the Legacy exposed-rack-port contract in the Engine
path. Placed rack child connectors are main-canvas endpoints only when their
rack definition exposes `{ id, deviceId, connectorId, name, type, direction }`;
hidden child connectors are excluded from hit-testing, and rack-internal
definition wires are always normalized as orthogonal derived wires.

Iteration 48 restores the Rack Builder data split in the Engine path. Rack
definitions still own rack-local devices, internal connections, and rack-local
route points. A placed rack owns a hidden rack instance record plus child canvas
device instances with `rackId` and `sourceRackDeviceId`; that explicit mapping
drives group selection/movement, context-menu routing, placed-rack deletion,
and the transformed internal wiring overlay. Internal rack wires remain derived
visuals and are not written into the normal `connections` array.

Iteration 46 restores the Legacy Power Distribution generated faceplate render
path in the default Engine Editor. Power Distro templates are normalized as a
dedicated `power-distro` kind, generated plug geometry is derived through
`src/engine/powerDistroModel.js`, and Engine cached device textures use the
real Legacy SVG plug/socket artwork from `Nodes/PowerPlugs/`.

Iteration 45 restores the Legacy adapter/breakout internal mapping path in the
Engine canvas. A shared `src/engine/adapterMapping.js` helper now derives
source connectors, destination connectors, fan-out/fan-in branches, gradient
endpoints, connector branch metadata, and scene validation stats. Internal
adapter links remain visual derived branches and are not exported as duplicate
reportable project cables; real external connector sockets keep the Legacy
single-cable guard.

Iteration 39 adds a separate Legacy interface and visual fidelity audit in
[`docs/legacy-interface-parity.md`](legacy-interface-parity.md). This document
continues to track functional parity and data/command behavior, while the new
audit tracks device visuals, faceplates, cards, connectors, inspectors, panels,
and remaining Legacy UI surfaces.

Iteration 40.2 implements the first post-audit modular-device visual pass in the
Engine texture path. It keeps functional command behaviour unchanged while
preserving installed card IDs, per-slot overrides, card caption colors, card
lane geometry, connector field values, and faceplate placement metadata through
normalization. The renderer then bakes those details into cached device
textures and invalidates only affected device textures when a faceplate image
finishes loading or a device visual key changes.

Iteration 40.3 kept the same data path but fixed the remaining visual
regressions from screenshot comparison: adapter/breakout templates using
`objectType: "adapter"` normalize as Engine adapters, connector circles and
connector labels draw in live world-space layers instead of the clipped device
texture, and selected devices use a soft Legacy-style glow layer.

Iteration 40.4 does not change command/data behavior. It only improves the
cached device texture resolution budget for tall modular chassis and adds
`debugDeviceTexture=1` diagnostics for the Engine texture pipeline.

Iteration 40.5 also keeps command/data behavior unchanged. It restores Legacy
faceplate placement metadata through the Engine visual path, strengthens the
live selected-device glow, and maps adapter/breakout library categories back to
the compact adapter renderer without changing save/load, commands, reports, or
viewer output.

Iteration 41 restores the Legacy modular chassis/card editing workflow while
keeping the Device Editor modal as the source-of-truth DOM UI. Applying a
device/card edit now captures a narrow before/after snapshot for the device
library, placed devices, and wires, warns before removing connections attached
to generated card connectors that no longer exist, and records one
`DeviceEditorApplyCommand` in Engine mode. Undo/redo restores those snapshots
without calling the old full project restore path, and the Engine scene swaps
only affected device connector models plus affected wires before invalidating
their cached textures.

Iteration 42.2 adds the July 2026 built-in device library update without
changing save/load format or the Legacy/Engine editing contract.

Iteration 42.2 corrects the Project Custom Devices workflow. Create New Device
and Device Editor duplication remain Master Device Library workflows; the
main-library right-click menu no longer exposes `Duplicate the Device`. Project
Custom Devices are created only from the canvas context-menu **Duplicate
Device** action on an already placed device. That action copies the placed
device's effective current template into exactly one project-scoped custom
template, while the source placed instance and source master template remain
unchanged. Project Custom drag/drop suppresses the follow-up click event so a
drop creates one selected canvas instance without opening Device Editor. Engine
Delete/Backspace deletes selected placed devices and connected wires in one
undoable command; deleting a placed custom instance does not delete its template.
Editing a custom template updates the Project Custom Devices entry and its
visual revision for future drops only; existing placed instances keep their
saved override snapshot and are not silently mutated.

Iteration 37.5 builds on Iteration 37, which restored Legacy connector compatibility rules in Engine wire
creation, including installed SFP/SFP+/QSFP modules, SFP/QSFP fiber-mode family
compatibility, RJ45 module CAT behaviour, Legacy fiber cable colors, and the
project-level Bezier vs 90-degree wire routing mode. Iteration 37.1 deepened the
Engine orthogonal route editing path by porting Legacy endpoint-stub repair,
route-point repair, moved-endpoint repair, and move-command route-state sync.
Iteration 37.2 restores the Legacy direct segment-drag interaction for
orthogonal middle doglegs. Iteration 37.3 restores the Legacy spacing/snap pass
used while dragging those doglegs. Iteration 37.5 completed the deep Legacy
audit for 90-degree wires and tightened Engine segment editing so endpoint-
adjacent doglegs cannot collapse into uneditable endpoint stubs. Iteration 37.6
ports the remaining fragile parts of the Legacy orthogonal route model: short
overlapping/collinear route runs are no longer aggressively simplified,
moved-endpoint repair now works on the stored interior route points like Legacy,
and endpoint-adjacent doglegs can cross to the opposite side of a connector
without becoming trapped. Snap guides are rendered during segment drags, and
`debugRouting=1` exposes route normalization, snap, cleanup, orthogonality, and
endpoint-clearance diagnostics.
Iteration 37.7 replaces the Engine's loose point-edit interaction with one
shared `OrthogonalRouteModel`. The model owns protected endpoint stubs,
editable interior segments, corner identity, orientation, and the route used by
rendering/hit-testing. Clicking an orange handle now enters a true corner drag;
grabbing an interior wire segment enters a dogleg drag. Both use immutable
pointer-down route geometry, while save/load continues to use the existing
`orthogonalRoutePoints` field.
Iteration 37.8 restores the Legacy custom-route context-menu workflow through
the Engine bridge. The audited functions are `showWireContextMenu`,
`showWireCornerContextMenu`, `createWireCornerAt`, `deleteWireCorner`,
`resetWireRoutes`, `routePointInsertIndex`, and `routePointInsertion`. Wire-body
menus again provide `Create Corner`, `Select All Wires of Same Type`, and
`Reset Wire Route(s)`; route-handle menus provide `Delete Corner` and
`Reset Wire Route`. Bezier clicks are projected onto the sampled path and
stored in `routePoints`. Orthogonal clicks materialize the automatic dogleg if
needed, insert the single Legacy projected point in segment order, and use the
shared route model to retain horizontal/vertical geometry in
`orthogonalRoutePoints`. Add, remove, and reset are incremental one-step Engine
commands and preserve the selected wire, endpoint identity, and existing save
format.
Iteration 38 restores the Legacy occupied-connector rewire workflow. The
audited Legacy functions are `startConnection`, `connectionForEndpoint`,
`restoreRewireConnection`, `preserveConnectionWithNewEndpoints`,
`finishConnection`, `createConnectionBetween`, `createConnectionToJump`, and
`createConnectionFromJumpToDevice`. Grabbing an occupied connector now keeps
the opposite endpoint fixed, suppresses the old wire in every Engine render
layer, and shows one live preview. A valid drop mutates only the matching
`from` or `to` endpoint on the existing wire. Empty canvas, incompatible
targets, Escape, pointer cancellation, and lost capture leave the original
connection unchanged. One `MoveWireEndpointCommand` restores the exact raw
Legacy connection record for undo/redo.
Viewer/PDF/report visual
migration remains paused while the remaining Legacy functional gaps are worked
through.

Iteration 39 is intentionally documentation-first. It does not migrate any
remaining Legacy UI systems; it maps those systems, their code anchors, their
Engine ownership class, and the recommended follow-up iteration order.

## Executive Summary

The current Engine Editor is strong for loaded-project interaction: fast
pan/zoom, selection, device moves, route-point edits, wire create/delete,
undo/redo, wire labels, connector hover, object hover, jump-node visuals, and
cable-hop visuals.

The biggest gaps are functional workflows that still live only in the Legacy
single-file editor:

1. Rack library creation is still Legacy-only; normal Device Library drops now
   work in Engine mode through a create-device command.
2. Endpoint rewire and modular card/chassis apply are restored; remaining card
   work is visual polish and broader edge-case testing.
3. Modular card/chassis, faceplate, power-distro, and rack-builder behaviours
   are mostly normalized for display, but not fully controlled by Engine.
4. Custom wire route actions are restored, but broader device/connector menu
   parity is still only partially delegated back to Legacy menus.

### Bezier / 90-Degree Wire Routing Mode Is Restored

Legacy exposes one global toolbar toggle for wire drawing mode. The project
stores it as `wireMode`, with `"bezier"` as the default and `"orthogonal"` for
90-degree wires. It is not a per-wire user setting.

In Legacy, switching to 90-degree mode freezes existing connections into
`orthogonalRoutePoints` where needed. Bezier/custom route data remains in
`routePoints`. Engine now reads the same global setting, uses the existing
Legacy preview-route helper for live wire creation, writes new 90-degree wires
back to `orthogonalRoutePoints`, and syncs route changes when the toolbar mode
changes.

Iteration 37.1 adds a shared Engine `orthogonalRouting` helper so route-point
drag, device/jump-node/LED-surface drag, multi-drag, undo/redo, and production
write-through all use the same Legacy-style 90-degree repair rules. Saved wires
with `orthogonalRoutePoints` load as orthogonal wires even if the current toolbar
mode is Bezier.

Iteration 37.2 adds direct segment dragging for Engine orthogonal wires. The
Engine hit-test path can now distinguish a selected route-point handle from a
middle vertical/horizontal segment. Dragging that segment moves the two adjacent
interior route points together on the constrained axis while endpoint-attached
stubs remain protected, matching the Legacy `startWireSegmentDrag(...)` rule.

Iteration 37.3 ports the Legacy temporary spacing/snap helpers:
`ORTHOGONAL_WIRE_SPACING = 15`, `WIRE_SEGMENT_SNAP_STEPS = [10, 15, 20, 25, 30]`,
`wireSegmentSnapTargetsForDrag(...)`, and `wireSegmentSnap(...)`. Legacy did not
store a per-wire spacing value or expose a separate spacing UI; it used the
global Object Snapping toggle during segment drag and saved the resulting
coordinates in route points. Engine now follows that same approach for 90-degree
segments only.

Iteration 37.5 audited the complete Legacy orthogonal block in commit
`8301fbf`:

- initial route creation: `previewOrthogonalWirePoints(...)`,
  `freezeOrthogonalRouteFromPreview(...)`, `freezeOrthogonalRoute(...)`,
  `orthogonalRoutePoints(...)`, `findOrthogonalGridRoute(...)`, and
  `fallbackOrthogonalRoute(...)`
- rendering and labels: `routeForConnection(...)`, `manualRouteForConnection(...)`,
  `pointsToPath(...)`, `labelPlacementForRoute(...)`, and
  `wireLabelTransform(...)`
- cleanup and stored route state: `cleanRoutePoints(...)`,
  `routePointsWithoutCollinearCollapse(...)`,
  `compactExcessOrthogonalRouteRuns(...)`, `normalizedWireRoutePoints(...)`,
  `setWireRoutePoints(...)`, and `storeCleanRoutePoints(...)`
- route-point/corner editing: `moveOrthogonalCornerPoints(...)`,
  `startWireCornerDrag(...)`, and the `wireCornerDrag` pointermove block
- segment editing: `connectionRouteSegments(...)`,
  `wireSegmentSnapTargetsForDrag(...)`, `wireSegmentSnap(...)`,
  `startWireSegmentDrag(...)`, and the `wireSegmentDrag` pointermove/pointerup
  blocks
- moved endpoint repair: `repairMovedEndpointOrthogonalRoute(...)`,
  `repairOrthogonalRouteForMovedEndpoint(...)`,
  `repairOrthogonalRoutesForMovedSelections(...)`, and
  `moveWireRoutePointsWithSelection(...)`
- visual helper: `setSnapGuides(...)`, `clearSnapGuides(...)`,
  `renderSnapGuides(...)`, and `renderSnapMeasurement(...)`

Legacy segment dragging computes every pointer frame from the drag-start
`wireSegmentDrag.routePoints`, not from the already-mutated live route. That is
why a segment can be pushed near an endpoint and then pulled back without being
reclassified as an endpoint stub mid-drag. Engine now follows that stable-start
geometry rule and also enforces endpoint exit clearance for first/last editable
vertical doglegs before committing the route. This keeps the dogleg visible and
movable instead of saving a collapsed one-point route. The exact Legacy snap
values are `[0, 10, 15, 20, 25, 30]`: `0` aligns parallel segments directly, and
the listed offsets create fixed spacing lanes. There is no `5px` wire segment
snap step in the audited Legacy commit.

Iteration 37.6 makes the Engine helper match the more conservative Legacy
cleanup and repair rules. Legacy `compactExcessOrthogonalRouteRuns(...)` only
collapses a straight run when it grows beyond four points; shorter straight or
overlapping runs are intentionally preserved because they may be user-created
corners/doglegs. Engine previously compacted any run of three collinear points,
which could erase meaningful handles after device movement or segment edits.
Legacy `repairMovedEndpointOrthogonalRoute(...)` repairs the stored interior
route points directly, then calls `storableRoutePointsWithoutCollinearCollapse`.
Engine now follows that same path instead of repairing a pre-normalized full
endpoint path. The endpoint-clearance guard still prevents first/last editable
vertical doglegs from collapsing into the connector, but it now derives the
clearance side from the proposed dragged coordinate, so dragging through the
connector dead-zone snaps to the opposite side instead of getting stuck.

Existing custom routed wires keep their stored points. Save/load format remains
unchanged.

Iteration 37.7 also exposes the real browser path through
`debugHud=1&debugRouting=1&orthogonalTest=1`. The HUD reports raw, normalized,
rendered, and production route points; active corner-versus-dogleg editing;
hovered indices; snap candidates and chosen spacing; and whether the blue guide
is active. The test toolbar can select the first 90-degree wire and copy the
current routing diagnostics. The blue helper remains runtime-only and is drawn
from `wireSegmentDrag.lastSnap.guides`; it is never serialized or included in
viewer/report output.

## Root Causes Of The Known Blockers

### Device Selector Drag/Drop Is Restored For Device Templates

Legacy creates devices through DOM library drag state and direct `state.devices`
mutation:

- `renderDeviceLibrary()` wires library cards to `startLibraryDrag(...)`.
- `startLibraryDrag(...)` creates a floating ghost and document-level pointer
  listeners.
- `finishLibraryDrag(...)` converts the pointer through `getCanvasPoint(...)`.
- `addDeviceInstanceFromTemplate(...)` hydrates the device, finds a clear
  position, pushes undo, appends to `state.devices`, selects the instance, and
  calls `render()`.
- Device pairs use `addDevicePairInstances(...)`.
- Rack library drops use `startRackLibraryDrag(...)` and
  `addRackInstanceToCanvas(...)`.

Iteration 35.2 keeps the Legacy drag ghost, non-overlap placement, and
hydration semantics, but tests real drops against the active Engine canvas and
converts client coordinates through the Engine camera before routing successful
Engine-mode device drops through
`ProductionEngineBridge.createDeviceFromLibraryDrop(...)` or
`createDevicesFromLibraryDrop(...)`.

Iteration 35.3 adds a debug-only overlay at
`index.html?debugLibraryDrag=1&v=iteration35-3` so a real manual pointer drag can
show pointerdown/session state, template payload validity, Engine and Legacy
canvas hit testing, drop world coordinates, create command success/failure,
renderer insertion, selection, validation, and the last drag events. Use **Copy
drag diagnostics** if a manual drop still fails.

The restored Engine path writes the new production-shaped device instance into
`state.devices`, inserts the normalized device into the Engine scene graph,
updates connector/spatial indexes, appends device geometry/texture to the
renderer, selects the created object, and records one undoable create command.

Rack library drops still need their own command because rack placement copies a
rack definition, member devices, internal wiring, exposed ports, and shifted
route data rather than a single device template.

### All Nodes Can Connect To All Nodes

Legacy validates connection targets through:

- `effectiveConnectorType(...)`
- `areConnectorTypesCompatible(...)`
- `isDeadCageConnector(...)`
- `isPairedNetworkConnector(...)`
- `isTwoWayConnector(...)`
- `connectionError(...)`
- `endpointHasConnection(...)`
- `pairedConnectionForUnusedSide(...)`

Current Engine wire creation in `ProductionEngineBridge.completeWireCreate()`
only blocks missing endpoints and the exact same connector. It then calls
`scene.addWire(...)` with `source.connector.type || target.connector.type`.
There is no shared compatibility check in the Engine create path yet.

### Cards / Faceplates / PDs Are Display-Normalized, Not Functionally Migrated

Legacy generates effective connectors and visuals from templates every time:

- chassis connectors
- generated card connectors
- per-slot card connector overrides
- faceplate placement and deleted-state logic
- power-distro plug SVG layout and manual placement
- adapter/breakout special rendering

Current Engine normalization reads much of that data through
`src/engine/projectAdapter.js`, `src/engine/sceneGraph.js`, and
`src/engine/deviceVisualBuilder.js`. That is enough for many loaded devices to
render and edit positions quickly, but it is not the same as restoring the
Legacy editor workflows for creating/changing cards, faceplates, power plugs,
PD geometry, and special template behaviours.

## Functional Parity Matrix

| Feature / workflow | Legacy behaviour at `8301fbf` | Current Engine behaviour | Status | Legacy code locations | Engine code locations | Data structures involved | Save/load impact | Undo/redo impact | Report/export/viewer impact | Risk | Restore in | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Device library drag/drop | Library cards start a pointer drag, convert pointer to canvas coordinates, hydrate a device, avoid overlaps, push undo, append to `state.devices`, select, render. | Engine now uses the active Engine canvas as the real drop target, converts through the Engine camera, commits the hydrated instance through `CreateDeviceCommand`, and can expose a live `debugLibraryDrag=1` overlay for the real pointer workflow. | covered | `renderDeviceLibrary`, `startLibraryDrag`, `moveLibraryGhost`, `finishLibraryDrag`, `prepareDeviceInstanceFromTemplate`, `addDeviceInstanceFromTemplate` | `ProductionEngineBridge.clientPointToWorld`, `ProductionEngineBridge.createDeviceFromLibraryDrop`, `ProjectMutationAdapter.restoreDeviceInstance`, `SceneGraph.insertDevice`, `WebglGraphRenderer.appendDevice` | `deviceLibrary`, `state.devices`, template overrides, connector overrides | New device persists as production `devices[]` entry | One undo removes it; redo restores same data/ID | Reports/export/viewer see placed devices through production data | medium | 35.3 | If manual drops fail, open `index.html?debugLibraryDrag=1&v=iteration35-3` and copy diagnostics. |
| Device pairs | Legacy pair library entry drops two hydrated devices with `DEVICE_PAIR_GAP`, non-overlap search, multi-selection, one undo snapshot. | Engine now prepares both instances through Legacy pair placement and commits them as one `CreateDevicesCommand`. | covered | `deviceLibraryEntries`, `pairedTemplateFor`, `prepareDevicePairInstances`, `addDevicePairInstances` | `ProductionEngineBridge.createDevicesFromLibraryDrop` | two `devices[]` instances, pair metadata in templates | Saves as two real devices | One group undo | Reports count two devices | medium | 35 | Does not create a linking wire; same as requested Legacy behaviour. |
| Project custom device drag/drop | Edited project devices appear in Project Custom Devices, can be dragged as `templateOverride` copies or clicked to frame. | Project Custom Devices now lists project custom templates, and dragging one creates a new Engine device with a fresh `templateOverride` snapshot from the current template data. | covered | `renderProjectCustomDevices`, `startProjectCustomDeviceDrag`, `selectAndFrameDevice`, `finishLibraryDrag` | `startProjectCustomTemplateDrag`, `ProductionEngineBridge.createDeviceFromLibraryDrop`, `normalizeAvDesignerDevice` | `deviceLibrary` custom templates, `instance.templateOverride`, `instance.name`, `projectCustomRevision` | Preserves override in production data; save/reload restores both template and placed snapshot | One undo for created copy | Export can include compact template override | medium | 42 | Editing a custom template intentionally does not update already placed/wired instances. Drag a new copy to use the edited version. |
| Rack library drag/drop | Rack entries drop a rack instance with copied member devices, internal connections, exposed ports, route-point shifts, and rack bounds. | Engine can load many project objects, but rack library creation is not an Engine command. | missing | `renderRackLibraryList`, `startRackLibraryDrag`, `addRackInstanceToCanvas` | no Engine rack-create command | `state.racks`, rack member `devices[]`, `internalConnections`, exposed ports | Must persist rack instance and internal data | One undo | Viewer/report depend on production state | high | 42 | Depends on rack parity work. |
| Connector compatibility | Exact type match, CAT-family match, USB-family match, cage active module type, dead-cage blocking, input/output blocking, paired network and two-way exceptions. | Engine create and rewire paths use the shared compatibility helper for hover and commit. | covered | `effectiveConnectorType`, `areConnectorTypesCompatible`, `connectionError`, `isDeadCageConnector`, `isTwoWayConnector`, `isPairedNetworkConnector` | `src/engine/connectorCompatibility.js`, `ProductionEngineBridge.completeWireCreate`, `ProductionEngineBridge.completeWireRewire`, `SceneGraph.addWire` | connector `type`, `direction`, `installedModuleType`, fiber mode, cable type metadata | Engine-created and rewired connections save through production data | One undo per created wire or endpoint rewire | Reports/export read the production connection data | medium | 38 | Iteration 38 reuses the same compatibility rules for endpoint rewiring, including jump portals. |
| Wire hover target feedback | Preview highlights only compatible, unoccupied targets and shows blocked states/status text. | Engine has connector hover and create feedback, but not full Legacy compatibility validity. | partial | `updateHoverConnector`, `renderPreviewWires`, `connectionError` | `ProductionEngineBridge.handlePointerMove`, `beginWireCreate`, `completeWireCreate` | same as connector compatibility | none unless committed | none | visual only | high | 36 | Should call the same shared rule used on commit. |
| Wire creation | Legacy creates production connection with ordered endpoints, cable type, custom color, fiber mode, signal index, notes, optional orthogonal frozen route. | Engine creates scene wire and writes a production connection, but ordering/metadata/compatibility are thinner. | partial | `startConnection`, `finishConnection`, `createConnectionBetween`, `freezeOrthogonalRouteFromPreview` | `ProductionEngineBridge.beginWireCreate`, `completeWireCreate`, `ProjectMutationAdapter.commitCreatedWire` | `state.connections`, endpoint refs, cable metadata | Saves because Engine writes production connection | One Engine undo command | Outputs read production data | high | 36-37 | Keep existing fast command path, add Legacy metadata/rules. |
| 90-degree segment spacing/snap | Legacy has no separate spacing UI. During Object Snapping, `wireSegmentSnapTargetsForDrag` caches other wire segments and `wireSegmentSnap` snaps a dragged dogleg/middle segment to endpoints or parallel lanes at `[10, 15, 20, 25, 30]`px offsets from `ORTHOGONAL_WIRE_SPACING = 15`. | Engine now uses shared `orthogonalRouting` helpers to cache snap targets once per segment drag, snap the proposed fixed X/Y coordinate, then persist only the resulting route point coordinates. | covered | `ORTHOGONAL_WIRE_SPACING`, `WIRE_SEGMENT_SNAP_STEPS`, `connectionRouteSegments`, `wireSegmentSnapTargetsForDrag`, `wireSegmentSnap`, `startWireSegmentDrag` | `src/engine/orthogonalRouting.js`, `SceneGraph.orthogonalSegmentSnapTargetsForDrag`, `SceneGraph.snapOrthogonalSegment`, `ProductionEngineBridge.beginWireSegmentDrag` | `wire.routePoints`, production `orthogonalRoutePoints`, global Object Snapping toggle | Coordinates persist through normal route points; no runtime snap cache is saved | One segment drag command; undo/redo restores route points and viewport stays stable | Outputs read saved route coordinates; no output renderer migration needed | medium | 37.3 | User examples mentioned 5/10/15, but Legacy source of truth is 10/15/20/25/30. |
| Endpoint rewire | Clicking an occupied device node detaches one endpoint, stores original connection, previews from fixed endpoint, then preserves original connection metadata on successful reattach or restores on failure. | Engine has create/delete/edit commands, but endpoint rewire parity is not implemented. | missing | `startConnection`, `restoreRewireConnection`, `preserveConnectionWithNewEndpoints`, `createConnectionBetween` | no dedicated rewire command | original connection object, changed endpoint only | Should preserve route points and metadata | One undo for endpoint move | Outputs should see same connection ID | high | 37 | Must not regress custom route-point preservation. |
| Jump-node wire creation | Legacy supports device-to-jump and jump-to-device, portal cable type inference, source/destination ordering, one-connection occupancy, and jump info boxes. | Engine maps jump nodes and supports loaded jump-connected wires visually; full create/reconnect compatibility is partial. | partial | `createConnectionToJump`, `createConnectionFromJumpToDevice`, `portalCableTypeForJumpNode` | Engine jump nodes in `projectAdapter`, `sceneGraph`, `ProductionEngineBridge.completeWireCreate` | `state.jumpNodes`, `connections.from/to.jumpNodeId` | Must save endpoint form unchanged | One undo | Viewer depends on jump endpoint data | high | 37 | Keep recent jump-node z-order and ghost fixes intact. |
| LED surface connection | Legacy supports LED signal multi-select, LED screen power/signal types, signal ordering, and processor registration. | Engine maps LED surfaces and virtual ports, but creation parity is not fully audited/migrated. | partial | `createConnectionToLedSurface`, LED connector selection helpers | `projectAdapter` LED surface mapping, scene validation virtual ports | `ledSurfaces[]`, `connections.to.surfaceId` | Saves through production state | Needs grouped undo for multi-connect | Reports count screens/pixels | high | 38 | Important for real projects with processors/screens. |
| Modular card generated connectors | Legacy combines chassis connectors and generated card connectors from `cardSlots`, `cardTypes`, per-slot overrides, and slot Y positions. | Engine normalizes generated card connectors for loaded templates, but Engine editing is not the owner of card changes. | partial | `generatedCardConnectors`, `effectiveTemplateConnectors`, `connectorById`, `connectorOverride` | `projectAdapter.generatedCardConnectors`, `effectiveConnectorsForTemplate`, `SceneGraph.normalizeDevice` | `template.cardSlots`, `template.cardTypes`, `slot.connectorOverrides` | Existing data saves; new Engine card edits not migrated | Needs template-level undo | Reports/export need generated connectors | high | 38 | Loaded E2-style devices rely on this. |
| Card/chassis editor workflows | Legacy Device Editor can add/reorder/delete slots/cards, assign cards, edit card connector fields, show card bands/captions, and apply library changes. | Engine is not the Device Editor; existing modal remains production/Legacy implementation. Engine canvas must stay in sync when those edits apply. | partial | `renderDeviceEditorPreview`, `renderCardEditorPreview`, editor slot/node drag functions | Bridge refresh path only | templates, project custom devices, connector overrides | Applying library can change many devices | Undo path production-owned | Outputs read final production templates | high | 38 | Decide whether to keep editor Legacy-owned but refresh Engine safely. |
| Faceplate visuals | Legacy draws custom face images, deleted faceplates, default faceplates, faceplate resize, adapter mode, and card bands. | Engine visual builder reads face image metadata and card visuals for fast rendering; not all editing paths are Engine commands. | partial | `drawDeviceBody`, `renderDeviceEditorPreview`, faceplate placement helpers | `projectAdapter.normalizeVisualMetadata`, `deviceVisualBuilder.js`, `renderer.js` | `faceImage`, natural size, scale, placement, deleted flag | Existing data should save | Editing undo production-owned | Viewer/PDF currently use production output | medium | 39 | Rendering is closer than editing parity. |
| Project custom device visuals | Legacy creates project-specific template overrides and shows them in Project Custom Devices. | Engine renders loaded custom devices and consumes restored custom-template create/duplicate/edit/delete workflows. Future drops use the latest template revision; existing placed instances remain snapshot-based. | covered | `templateForInstance`, `renderProjectCustomDevices`, `duplicateLibraryDevice` | project adapter visual normalization, `deviceVisualCacheKey`, `renderProjectCustomDevices` in `index.html` | `templateOverride`, image assets, faceplate scale/offset/deleted fields, cards, connectors, `visualRevision` | Critical for user-created devices; custom templates and snapshots persist | Template edit/delete use production history scope; placed creation is Engine undoable | Export compacts templates | high | 42 | Texture cache keys include visual revision so edited custom templates do not reuse stale cached visuals. |
| Adapter/breakout devices | Legacy has special compact dashed rendering, no node fields, internal gradient wires, and special internal multi-connection rules. | Engine can normalize adapter visual metadata; full internal adapter wiring/editing parity not audited/migrated. | partial | `isAdapterTemplate`, `drawDeviceBody`, adapter internal wire helpers | `projectAdapter.isAdapterBreakout`, `deviceVisualBuilder` | adapter template flag, connector list, internal wires | Must preserve adapter flag and internal links | Needs adapter edit undo | Reports list as devices/adapters | medium | 39 | Keep for compact conversion devices. |
| Power distro plug layout | Legacy has PD flag, SVG plug assets, power plug layout, manual snapping/overlap warning, faceplate height rules, powerlock special full-width behaviour. | Engine now classifies PDs as `power-distro`, derives runtime plug layout from Legacy fields, preserves plug asset metadata, expands required height from generated plug bounds, and renders the generated faceplate into cached textures. The DOM editor/layout editing remains production-owned. | partial | `POWER_PLUG_TYPES`, `powerPlugMeta`, `powerPlugImageForConnector`, `powerPlugDisplaySize`, `powerDistroAutoFaceHeight`, `powerDistroFaceRect`, `sortedPowerPlugConnectors`, `powerPlugLayout`, `drawPowerDistroFaceplate`, `startEditorPowerPlugDrag` | `src/engine/powerDistroModel.js`, `projectAdapter.normalizeProjectDevice`, `sceneGraph.normalizeDevice`, `deviceVisualBuilder.drawPowerDistroFaceplate`, `productionBridge.updatePowerDistroDebugHud` | `template.isPowerDistro`, connector `powerPlug`, manual plug `x/y`, direction, connector IDs, plug SVG metadata | Existing data saves; runtime model and asset cache are not saved | Template-level edits stay production-owned; placed deletion/undo treats PD as a normal placed device | PDF/viewer use production render paths | high | 46 | Engine canvas no longer falls back to generic/simplified PD visuals, but editor preview/output parity remains a separate risk. |
| Power connector/cable colors | Legacy supports power cable families and Powerlock multicolor segments. | Engine has power/multicolor render support from previous passes, but compatibility rules are not restored. | partial | `colorSegmentsForConnector`, `connectionColorSegments`, `POWER_PLUG_TYPE_IDS` | engine color/render helpers, `projectAdapter` connector colors | cable type metadata | Color does not affect save except custom colors | none | Legend/report color consistency | medium | 40 | Split visual parity from connection validity. |
| SFP/QSFP cages | Legacy treats cages as dead until an installed module provides the active connector type. LC singlemode and LC multimode are separate fiber families; RJ45 modules behave as CAT; QSFP MPO behaves as MPO fiber. | Engine enforces dead-cage/module rules, LC single/multi family compatibility, RJ45 CAT compatibility, and QSFP MPO type compatibility during create and rewire. | covered | `isCageConnector`, `isDeadCageConnector`, `activeTypeForCageConnector`, `effectiveConnectorType`, `FIBER_MODE_OPTIONS` | `src/engine/connectorCompatibility.js`, `projectAdapter`, `projectMutations`, `SceneGraph`, `ProductionEngineBridge` | `connector.installedModuleType`, `connector.fiberMode`, `connection.fiberMode` | Fiber mode/color survives Engine creation, rewire, and save/load | Undo/redo keeps fiber mode through exact connection-state restoration | Outputs inherit production `connection.fiberMode` | medium | 38 | Existing SFP/QSFP wires can now be reassigned without changing cable metadata. |
| Device context menu | Legacy right-click device opens edit, matrix routing, duplicate, lock/unlock, delete. | Engine context hit-test delegates device target back to Legacy `showDeviceContextMenu(...)`. | partial | `showDeviceContextMenu` | `ProductionEngineBridge.handleContextMenu`, `index.html onEngineContextMenu` | selected device ID/source ID | Actions mutate production state | Depends on Legacy undo | Outputs read production state | medium | 41 | Delegation exists; each action still needs Engine scene refresh audit. |
| Wire context menu | Legacy wire menu supports create corner, select same type, length/notes via inspector, reset/delete routes, delete. | Engine delegates wire and wire-corner targets to Legacy menus, but action refresh/parity needs audit. | partial | `showWireContextMenu`, `showWireCornerContextMenu`, `createWireCornerAt`, `resetWireRoutes` | `ProductionEngineBridge.handleContextMenu`, `onEngineContextMenu` | connection route points | Route changes must write production and Engine scene | Needs one undo per action | Viewer/export uses routes | medium | 41 | Recent Engine route-point visuals should stay. |
| Empty-canvas context menu | Legacy has canvas-level actions where applicable. | Engine empty context currently clears selection and forwards `target: null`; no full menu parity. | missing | empty-canvas/context helpers in Legacy menu code | `ProductionEngineBridge.handleContextMenu` | selected state | depends on action | depends on action | depends on action | low | 41 | Lower priority than device/wire actions. |
| Rack builder/internal wires | Legacy has rack builder, rack internal 90-degree routes, route-point/segment dragging, exposed ports, show internal wiring, rack context menu. | Engine maps racks/internal data enough for project validation/visual survival, but the rack builder itself remains production-owned. | partial | `renderRackBuilder`, `createRackInternalConnection`, `rackInternalWireRoute`, `startRackBuilderWireSegmentDrag`, `showRackContextMenu` | `projectAdapter`, `sceneGraph`, Engine context delegation | `state.racks`, `internalConnections`, exposed ports | Must preserve rack data | Production-owned currently | Viewer can show rack internals via production paths | high | 42 | Needs its own focused iteration. |
| Matrix routing | Legacy conditionally exposes matrix routing menu and matrix routing modal; one output routes to one input, one input can feed many outputs, and routes are stored as `instance.matrixRoutes`. | Engine still uses the DOM modal, but route state/mutations are Engine-owned and command-based. | covered | `showDeviceContextMenu`, `matrixEndpointsForTemplate`, `ensureMatrixRoutes`, `bindMatrixRoutingInspector`, `matrixRoutingMarkup`, `matrixRoutesForReport` | `src/engine/matrixRouting.js`, `ProductionEngineBridge.commitMatrixRoute/applyMatrixRoutes`, `MatrixRoutingCommand`, matrix validation in `sceneValidation.js` | `template.isMatrixRouter`, connector `includeInMatrix`, `matrixPortTouched`, `matrixRoutes` | Same Legacy format saved; invalid references normalized | Engine undo/redo command, one step per matrix edit | Reports read production `matrixRoutes`; no canvas wires created | medium | 49 | DOM modal is intentionally retained; matrix edits should not trigger texture, wire, or full scene rebuilds. |
| Reports/export/viewer | Legacy output paths read production project data and SVG helpers. | Engine writes through to production data; output migration is paused. | partial / not intended yet | `projectSnapshotData`, `buildStandaloneHtml`, `wirechartSvgMarkup`, report renderers | Engine mutation adapter write-through | production `.avd` / JSON shape | Must remain unchanged | Not command-owned | Critical downstream path | high | after 42 | Do not resume output migration until functional parity blockers are fixed. |

## Detailed Legacy Code Path Notes

### A. Device Selector Drag/Drop And Creation

Legacy source locations:

- `renderDeviceLibrary()` around line 41929
- `renderProjectCustomDevices()` around line 42020
- `startProjectCustomDeviceDrag()` around line 42088
- `startLibraryDrag()` around line 42189
- `moveLibraryGhost()` around line 42300
- `finishLibraryDrag()` around line 42328
- `startRackLibraryDrag()` around line 42363
- `addRackInstanceToCanvas()` around line 42405
- canvas `dragover`/`drop` fallback around line 47980
- `addDevicePairInstances()` around line 48007
- `addDeviceInstanceFromTemplate()` around line 48057

Legacy fields required for a placed device:

- `instanceId`
- `templateId`
- optional `templateOverride`
- `name`
- `x`
- `y`
- `notes`
- template-derived connectors from `effectiveTemplateConnectors(...)`

What Iteration 35 restored:

- A create-device command that accepts an already hydrated Legacy-style device
  instance from a template ID or template override.
- A pair-create command that commits both devices as one undo step.
- Production write-through through `state.devices`.
- Engine scene append/update without full fallback rebuild.
- One undo command per user action.

What remains:

- Rack creation still needs a separate rack command because it involves rack
  definitions, member devices, internal wires, and exposed ports.

### B. Connector / Node Compatibility

Legacy source locations:

- `colorSegmentsForConnector(...)` around line 34525
- `cableDirection(...)` around line 34555
- `isTwoWayConnector(...)` around line 34559
- `effectiveConnectorType(...)` around line 34574
- `areConnectorTypesCompatible(...)` around line 34581
- `isPairedNetworkConnector(...)` around line 34595
- `isCageConnector(...)` around line 34599
- `isDeadCageConnector(...)` around line 34603
- `connectionError(...)` around line 35714
- `endpointHasConnection(...)` around line 43569
- `pairedConnectionForUnusedSide(...)` around line 43590

Legacy compatibility rules found:

- Missing connectors are invalid.
- Dead cages are invalid until a transceiver/module is installed.
- Cage connectors use their installed active module type.
- Exact effective cable type matches are valid.
- CAT-family connectors are compatible with each other:
  `cat5e`, `cat6`, `cat6a`, `ethercon`, `ethernet`.
- USB-family connectors are compatible with each other:
  `usb-a`, `usb-b`, `usb-c`.
- Paired network connectors bypass input/output blocking.
- Two-way connectors bypass input/output blocking when both sides are two-way.
- Otherwise output-output and input-input are invalid.

What Engine needs:

- A shared compatibility module that can run without DOM.
- The same rule should be used for hover feedback, preview target validation,
  final wire creation, rewire, and future rack/internal wire creation.
- The module should take normalized Engine connector objects plus the original
  production connector metadata where needed.

### C. Wire Creation And Rewire

Legacy source locations:

- `startConnection(...)` around line 46900
- `finishConnection(...)` around line 46981
- `finishConnectionToJump(...)` around line 46991
- `createConnectionToJump(...)` around line 47005
- `createConnectionFromJumpToDevice(...)` around line 47062
- `createConnectionBetween(...)` around line 47111
- `renderPreviewWires(...)` around line 47242
- `endConnection(...)` around line 47304

Legacy rewire behaviour:

- Clicking an occupied device endpoint removes the existing connection from
  `state.connections`.
- The fixed endpoint becomes the preview source.
- The original connection object is stored in `connectState.rewire`.
- On successful target drop, Legacy preserves the original connection metadata
  with new endpoints.
- On invalid/cancelled rewire, the original connection is restored.

What Engine needs:

- Endpoint rewire command distinct from new wire creation.
- Preserve connection ID, route points, orthogonal route points, notes, length,
  fiber mode, custom color, signal index, and cable type unless the endpoint
  change requires a deliberate metadata update.
- Compatibility and occupancy checks before commit.

### D. Modular Devices / Cards / Chassis

Legacy source locations:

- `cardTypeById(...)` around line 33900
- `cardSlotRowCount(...)`
- `cardSlotLaneCount(...)`
- `normalizeMixedDeviceRows(...)` around line 33950
- `generatedCardConnectors(...)` around line 34025
- `effectiveTemplateConnectors(...)` around line 34054
- `renderDeviceEditorPreview()` around line 40081
- `renderCardEditorPreview()` around line 40271

Legacy data fields:

- `template.hasSwappableCards`
- `template.cardTypes[]`
- `template.cardSlots[]`
- `slot.installedCardTypeId`
- `slot.connectorOverrides`
- generated connector IDs as `${slot.id}__${connector.id}`
- `sourceConnectorId`, `cardSlotId`, `cardTypeId`, `generatedFromCard`

Current Engine already reads enough of this to display many loaded devices:

- `src/engine/projectAdapter.js` has `generatedCardConnectors(...)`.
- `src/engine/projectAdapter.js` normalizes `visualCards`.
- `src/engine/sceneGraph.js` normalizes generated connector/card metadata.

Missing parity:

- Engine-owned card/slot create/edit commands.
- Engine-safe refresh after Legacy Device Editor applies card changes.
- Per-slot connector override editing from Engine interactions.

### E. Faceplates / Custom Device Visuals

Legacy source locations:

- `faceplateAspectHeightForTemplate(...)`
- `faceplateHeightForTemplate(...)`
- `connectorStartYForTemplate(...)`
- `drawDeviceBody(...)` around line 43703
- `renderDeviceEditorPreview(...)` around line 40081

Legacy faceplate data:

- `faceImage`
- natural image dimensions
- `faceImageScaleX`
- `faceImageScaleY`
- deleted/default faceplate state
- power distro generated faceplate state
- adapter/breakout mode

Current Engine paths:

- `src/engine/projectAdapter.js` normalizes face image and metadata.
- `src/engine/deviceVisualBuilder.js` builds device textures from normalized
  visuals.
- `src/engine/renderer.js` caches/draws Engine visuals.

Missing parity:

- Device library creation of custom visuals.
- Faceplate editing/resize/replace/delete as Engine commands.
- Full refresh and texture invalidation after Legacy Device Editor changes.

### F. PDs / Power Devices / Special Connectors

Legacy source locations:

- `POWER_PLUG_TYPES` around line 4433
- `POWER_PLUG_TYPE_IDS` around line 4487
- `powerPlugMeta(...)` around line 39233
- `powerPlugImageForConnector(...)` around line 39237
- `powerPlugCanExistOnSide(...)` around line 39245
- `powerPlugDisplaySize(...)` around line 39261
- `sortedPowerPlugConnectors(...)` around line 39353
- `powerPlugLayout(...)` around line 39364
- `drawPowerDistroFaceplate(...)` around line 39734
- `startEditorPowerPlugDrag(...)` around line 40674

Legacy behaviour:

- PD faceplate can be generated from power connectors.
- Plug SVGs have real sizes, snapping, overlap warnings, manual positions.
- Faceplate height expands to contain plugs and cannot shrink below required
  size.
- Powerlock has special multicolor visual treatment and layout rules.

Current Engine:

- Reads `isPowerDistro`, connector `powerPlug`, manual plug positions,
  connector direction, stable connector IDs, and plug asset metadata.
- Normalizes runtime-only `visual.powerDistro` data through
  `src/engine/powerDistroModel.js`.
- Renders generated PD faceplates with Legacy plug SVG assets in cached Engine
  textures.
- Treats PD instances as selectable/marquee-selectable/deletable placed
  devices.
- Does not own the DOM PD plug layout/edit workflow.

### G. Right-Click / Context / Action Parity

Legacy source locations:

- `showDeviceContextMenu(...)` around line 48082
- `showRackContextMenu(...)` around line 48115
- `showLedSurfaceContextMenu(...)` around line 48241
- `showLibraryDeviceContextMenu(...)` around line 48259
- Device Editor duplicate controls for Master Library template duplication
- `showWireContextMenu(...)` around line 48308
- `showWireCornerContextMenu(...)` around line 48333
- `deleteSelection(...)` around line 48378
- `createWireCornerAt(...)` around line 48598
- `resetWireRoutes(...)` around line 48616
- `duplicateSelectedObjects(...)` around line 49130

Current Engine:

- `ProductionEngineBridge.handleContextMenu(...)` identifies Engine targets.
- `index.html` `onEngineContextMenu` delegates device, LED surface, wire, and
  wire-corner targets to existing Legacy menus.

Missing parity:

- Empty-canvas actions.
- Connector-specific context actions.
- Verification that every delegated action refreshes the Engine scene and
  textures correctly.
- Verification that duplicate/delete/lock/matrix/edit actions keep Engine
  selection sane.

### H. Rack / Internal Wires / Special Cases

Legacy source locations:

- `rackById(...)` around line 33399
- `rackInternalConnections(...)` around line 33422
- `rackExposedPorts(...)` around line 33426
- `rackConnectorById(...)` around line 33707
- `renderRackBuilder(...)` around line 36181
- `startRackBuilderSourceDrag(...)` around line 36420
- `addRackBuilderDevice(...)` around line 36717
- `rackInternalWireRoute(...)` around line 36785
- `startRackBuilderWireSegmentDrag(...)` around line 36995
- `startRackBuilderWireCornerDrag(...)` around line 37081
- `renderRackBuilderInternalWires(...)` around line 37138
- `createRackInternalConnection(...)` around line 37484
- `startRackBuilderDeviceDrag(...)` around line 37548
- `startRackBuilderMarquee(...)` around line 37621

Current Engine:

- Can load and validate supported production data.
- Keeps rack data in production format.
- Does not migrate the rack builder interaction model.

Missing parity:

- Rack library drop as an Engine command.
- Rack internal wire editing and exposed-port rules.
- Context action refresh after rack edits.

## Recommended Roadmap

### Iteration 35 — Device Library Drop And Creation Command

Restore device selector drag/drop in Engine mode first.

Scope:

- Create a production/engine command for "add device from template".
- Reuse Legacy hydration and placement semantics.
- Support project custom device copies.
- Support device pairs as one grouped command.
- Append the new Engine scene object without full rebuild where possible.
- Add undo/redo for the created device(s).
- Keep Legacy fallback unchanged.

Validation:

- Drag default device to canvas.
- Drag project custom device to canvas.
- Drag paired device to canvas.
- Save/reload in Engine.
- Open same saved file in Legacy.

### Iteration 36.1 — Shared Connector Compatibility

Extract Legacy connector compatibility into a shared data-only module.

Implemented scope:

- effective connector type
- dead cage blocking
- CAT/USB family compatibility
- paired network/two-way direction exceptions
- input/output blocking
- hover validity and commit validity use the same rule
- same connector blocking
- active transceiver module type mapping for SFP/SFP+/QSFP cages
- installed-module diagnostics for `debugCompatibility=1`, including raw cage
  type, module id/name/type/value, effective type, direction, rule, and
  rejection reason

Still intentionally out of scope:

- endpoint rewire flow
- connector occupancy policy

Validation:

- HDMI-to-HDMI valid.
- HDMI-to-SDI invalid.
- CAT5E/CAT6/CAT6A/etherCON/Ethernet cross-family valid.
- USB-A/USB-B/USB-C cross-family valid.
- dead SFP/QSFP cage invalid until module is installed.
- installed LC SFP/SFP+ cages connect as Fiber LC, including label-style and
  object-style saved module data.
- installed QSFP MPO cages connect as Fiber MPO.
- installed LC cages reject incompatible RJ45/CAT module cages.
- two outputs invalid unless two-way/paired exception applies.

### Iteration 38 — Endpoint Rewire Parity

Occupied-node click/reassign behaviour is restored.

Scope:

- Grab an occupied connector to detach one endpoint while the other remains fixed.
- Preserve original wire ID and metadata.
- Preserve custom route points unless explicitly reset.
- Restore original connection on cancel/invalid drop.
- One undo step.
- Reuse shared connector compatibility, including active SFP/QSFP modules and
  fiber families.
- Treat jump nodes as portals using the existing wire cable type while still
  enforcing one-wire occupancy.

Validation:

- Source and destination rewire preserve ID and raw metadata.
- Bezier custom points remain stored unchanged.
- Orthogonal interior doglegs remain stored unchanged; endpoint-adjacent
  rendering is repaired by `orthogonalWirePoints`.
- Cancel/invalid drop does not mutate the scene or production project.
- Undo/redo restores the complete before/after connection record.
- Save/reload retains the new endpoint and original routes.

### Iteration 38 — Modular Cards / Chassis Functional Parity

Make generated card connectors and card slot changes safe in Engine mode.

Scope:

- Verify all existing card-slot generated connectors map correctly.
- Refresh Engine scene after Device Editor applies card/template changes.
- Keep per-slot connector overrides independent.
- Keep card labels/bands and connector IDs stable.

Validation:

- E2-style device with multiple cards.
- Change installed card, apply library, Engine canvas updates.
- Save/reload and Legacy opens correctly.

### Iteration 39 — Interface / Visual Fidelity Audit

Map the remaining Legacy UI and visual systems before restoring them.

Scope:

- Create the interface parity matrix in
  [`docs/legacy-interface-parity.md`](legacy-interface-parity.md).
- Identify Legacy and Engine code anchors for device visuals, faceplates,
  cards, connectors, inspectors, PD devices, adapters, racks, context menus,
  panels, reports, and exports.
- Classify each area by data, renderer, inspector, undo/redo, save/load, and
  report/export risk.

Validation:

- Build label says Iteration 39.
- Engine and Legacy fallback still open.
- Existing functional validation still passes.

### Iteration 40.2 — Modular Cards / Chassis Visual Parity

Restore card-heavy device confidence before broad visual polish, then tighten
the cached Engine body so it matches the Legacy rounded shell instead of
showing mixed square/rounded layers.

Scope:

- Generated card connector IDs and positions remain stable.
- Card labels/bands match Legacy enough for E2-style devices.
- Real faceplate PNGs draw in cached Engine textures with Legacy placement.
- Installed card caption colors and compact connector fields draw in the
  cached device texture.
- Cached device textures use sharper quality settings without rebuilding on
  pan, zoom, drag, selection, or wire edits.
- Textured devices no longer draw a static square WebGL body underneath the
  rounded cached texture.
- Selection and hover overlays use rounded Legacy-style outlines.
- Adapter/breakout devices draw their dashed transparent body, outside label,
  and internal fan-out wiring in the Engine path.
- Per-slot connector overrides remain independent.
- Device Editor Apply refreshes only affected Engine visuals.

Validation:

- E2-style device with multiple cards.
- Adapter/breakout device with one input and several outputs.
- Change installed card, apply library, Engine canvas updates.
- Save/reload and Legacy opens correctly.

### Iteration 40.3 — Connector / Glow / Breakout Visual Correction

Correct the visible differences between Legacy selected devices and the Engine
cached texture path while keeping the command/data behaviour unchanged.

Scope:

- Connector circles are no longer baked into device textures.
- Connector labels draw beside the live connector circles.
- Selected-device glow uses a soft texture layer instead of hard repeated
  outline rectangles.
- Adapter/breakout classification matches Legacy for `objectType: "adapter"`.
- Texture cache key is bumped so older soft textures are not reused.

Validation:

- E2-style selected device: one soft glow, full connector circles, no clipped
  half-nodes.
- PTZ/power breakout: dashed transparent body, outside title, internal fan-out.
- Wire routing, endpoint rewiring, SFP compatibility, save/load, viewer/PDF,
  and report paths unchanged.
- Moving/selecting/panning/zooming does not rebuild the modular texture.

### Iteration 41 — Context Menu And Canvas Actions

Audit and restore every right-click action under Engine.

Scope:

- Device edit/duplicate/lock/delete/matrix.
- Wire create corner/select same type/reset/delete.
- Route-point delete.
- Empty canvas actions.
- Connector context if any.

Validation:

- Each action updates production data and Engine scene once.
- Undo/redo works.

### Iteration 42.2 — Faceplates, Project Custom Devices, And Device Deletion

Complete custom faceplate and user-created device template parity.

Scope:

- Real faceplate PNGs render inside Engine textures.
- Faceplate replace/delete/resize updates only affected textures.
- Create New Device creates a main Master Device Library template, not a
  project custom entry and not an auto-placed instance.
- Main-library context menus no longer expose `Duplicate the Device`; Master
  Library duplication stays inside Device Editor.
- Canvas device context-menu **Duplicate Device** creates the Project Custom
  Device copy from the placed instance's effective template/configuration,
  exactly once per user action and without placing another canvas instance.
- Project custom templates can be edited, duplicated, deleted safely, searched,
  and dragged to the Engine canvas.
- Dragging a Project Custom Device to the Engine canvas suppresses the follow-up
  click/edit event, creates one selected placed instance, and does not open
  Device Editor.
- Engine Delete/Backspace deletes selected normal/modular/custom placed devices
  and their connected wires in one command, with focus exclusions for text-entry
  controls.
- Source master templates and source placed devices remain unchanged by Project
  Custom creation/edit/delete.
- Deleting a placed custom-device instance does not delete the Project Custom
  Device template.
- Editing a project custom template updates future drops only; existing placed
  instances remain unchanged.
- Project custom visual revisions invalidate stale future texture-cache entries
  without rebuilding unchanged placed snapshots.

Validation:

- Small adapter/breakout device.
- Large image faceplate.
- Deleted faceplate.
- Project custom device drag/drop.
- Canvas Duplicate Device creates one Project Custom Devices entry and no extra
  canvas instance.
- Delete/Backspace selected placed devices with and without connected wires.
- Undo/redo restores deleted devices and wires with original IDs, routes, and
  metadata.
- Duplicate custom template with unique template/connector IDs.
- Deleted source template with a placed `templateOverride` snapshot.

### Iteration 43 — Connector Visual Metadata Parity

Connector compatibility remains production-compatible, while Engine visuals now
reuse a shared connector metadata helper for:

- installed SFP/SFP+/QSFP cage display labels and effective active connector
  types;
- fiber mode colors for LC/SC/ST/MPO/OpticalCon/FiberFox connector nodes;
- Powerlock multi-color connector segments;
- Legacy node-field captions and values for cached card/device textures;
- live connector labels and tooltips that prefer field names before raw cable
  type fallback.

Deliberately unchanged: Node Builder UI, Device Editor UI, Inspector command
parity, Power Distro generated faceplate editing, Rack Builder, Matrix Routing,
PDF/viewer/report rendering, and save/load format.

### Iteration 45 — Adapter / Breakout Internal Wiring

Adapter/breakout devices now use one Engine helper for Legacy-style derived
internal mapping:

- one input to many outputs maps as fan-out;
- many inputs to one output maps as fan-in;
- unequal sides distribute in Legacy connector order;
- equal sides map one-to-one;
- internal visual branches fade from source connector color to destination
  connector color between the 25% and 75% path marks;
- connector metadata records source/destination roles and branch counts;
- external project sockets remain single-use unless a future Legacy flag
  explicitly permits multiple external reportable wires.

Deliberately unchanged: the project save format, reports/viewer/PDF visuals,
Power Distro generated faceplates, Rack Builder, Matrix Routing, and the DOM
Device Editor controls.

### Iteration 46 — Power Distro Generated Faceplates

Power Distribution devices now have a dedicated Engine normalization and
rendering path:

- classification is preserved as `kind: "power-distro"` from structured
  `template.isPowerDistro`/instance metadata, not from display name;
- Legacy plug geometry is mirrored from `POWER_PLUG_TYPES`,
  `powerPlugDisplaySize`, `sortedPowerPlugConnectors`,
  `powerDistroFaceRect`, and `powerPlugLayout`;
- plug artwork uses the real `Nodes/PowerPlugs/` SVG assets for NEMA, 13A-UK,
  Schuko, powerCON, True1, CEE 1ph/3ph variants, Socapex, Harting, and
  Powerlock source/drain;
- connector IDs stay the original connector IDs, while generated plug entries
  are runtime-only and not saved;
- cached textures are invalidated only by visual metadata changes through the
  device visual cache key, not by movement/selection/hover/pan/zoom;
- `debugPowerDistro=1` adds HUD lines for the target kind, generated model,
  face rect, and plug counts.

Deliberately unchanged: DOM Power Distro editor internals, manual plug drag
inside the editor, destructive wired-outlet prompts, Rack Builder, Matrix
Routing, PDF/viewer/report output rendering, and project save format.

### Iteration 47 — LED, Image, Area, Comment, And Title-Block Objects

Engine mode now treats the main non-device canvas objects as their own scene
objects instead of normal devices:

- `led-surface` preserves loaded PNG/image href, natural image size,
  configured object size, physical/pixel metadata, and virtual surface ports;
- `image-object` is normalized separately for future first-class image surface
  support;
- `area` renders as a low-priority background object behind wires and devices,
  with fill, opacity, and caption metadata;
- `comment` keeps its text box, anchor, leader endpoint, title/body text,
  colors, and text-size metadata;
- `title-block` keeps the Legacy title-block grid, fields, logo, and
  proportional scale data.

The Engine bridge can now sync a single canvas object from production after
Legacy DOM UI actions such as LED image replacement, `Use image size`, comment
edits, area edits, and title-block edits. Delete selection in Engine mode also
routes these objects through Engine commands so the scene graph, texture cache,
selection, and production project data stay aligned.

Texture invalidation remains object-scoped: object visual edits invalidate only
that object texture, while position-only changes, pan, zoom, hover, and
selection stay on the live overlay path. Resize handles are rendered as live
selection overlays rather than baked into object textures.

Deliberately unchanged: viewer/PDF/report output rendering, Rack Builder,
Matrix Routing, DOM editor controls, and project save format. Image objects are
supported in the Engine data path, but the current Legacy UI still does not
expose a standalone image-object inspector.

### Iteration 46+ — Continue Interface Roadmap

Follow the detailed order in
[`docs/legacy-interface-parity.md`](legacy-interface-parity.md): PD/power
editor preview edge cases, LED/title surfaces, racks, matrix UI, toolbar polish, then output
migration. Only after editor visual parity is stable should viewer/PDF/report
visual migration resume.

## Validation TODOs

Run these after each parity iteration:

1. `node scripts/engine-real-project-validation.mjs --fixture`
2. `node scripts/engine-real-project-validation.mjs "/path/to/real-project.avd"`
3. `git diff --check`
4. Browser smoke:
   - `index.html?v=iteration40-2`
   - `index.html?legacy=1&v=iteration40-2`
   - `index.html?engine=1&debugHud=1&v=iteration40-2`
   - `index.html?debugLibraryDrag=1&v=iteration40-2`
5. Manual create/edit/save/reload:
   - drag device from library
   - create compatible wire
   - attempt invalid wire
   - rewire endpoint
   - undo/redo
   - save `.avd`
   - reopen in Legacy
6. Output sanity only:
   - export HTML opens
   - PDF opens
   - report data is not corrupted

## Deliberately Not Changed In This Audit

- Runtime code was ported only for the Iteration 35 create-device path.
- No compatibility rules were migrated yet.
- No viewer/PDF/report migration was added.
- No save/load format change was made.
- No Engine default/fallback flags were removed.
- No Legacy Editor behaviour was removed.
