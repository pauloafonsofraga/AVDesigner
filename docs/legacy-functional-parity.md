# Legacy Functional Parity Audit

Source of truth for this audit:

- Legacy reference: `8301fbf23c82f3e3f2496cb90234019c7bf47958`
- Current branch audited: `engine-prototype`
- Current build label: `Iteration 36`

Iteration 36 restores Legacy connector compatibility rules in Engine wire
creation. Viewer/PDF/report visual migration remains paused while the remaining
Legacy functional gaps are worked through.

## Executive Summary

The current Engine Editor is strong for loaded-project interaction: fast
pan/zoom, selection, device moves, route-point edits, wire create/delete,
undo/redo, wire labels, connector hover, object hover, jump-node visuals, and
cable-hop visuals.

The biggest gaps are functional workflows that still live only in the Legacy
single-file editor:

1. Rack library creation is still Legacy-only; normal Device Library drops now
   work in Engine mode through a create-device command.
2. Endpoint rewire is not yet restored in Engine mode.
3. Modular card/chassis, faceplate, power-distro, and rack-builder behaviours
   are mostly normalized for display, but not fully controlled by Engine.
4. Context-menu/action parity is only partially delegated back to Legacy menus.

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
| Project custom device drag/drop | Edited project devices appear in Project Custom Devices, can be dragged as `templateOverride` copies or clicked to frame. | Engine now preserves `templateOverride` and custom display name when dropped through the create-device command. | covered | `renderProjectCustomDevices`, `startProjectCustomDeviceDrag`, `selectAndFrameDevice`, `finishLibraryDrag` | `ProductionEngineBridge.createDeviceFromLibraryDrop`, `normalizeAvDesignerDevice` | `instance.templateOverride`, `instance.name` | Preserves override in production data | One undo for created copy | Export can include compact template override | medium | 35 | Click-to-frame remains the existing selector behaviour. |
| Rack library drag/drop | Rack entries drop a rack instance with copied member devices, internal connections, exposed ports, route-point shifts, and rack bounds. | Engine can load many project objects, but rack library creation is not an Engine command. | missing | `renderRackLibraryList`, `startRackLibraryDrag`, `addRackInstanceToCanvas` | no Engine rack-create command | `state.racks`, rack member `devices[]`, `internalConnections`, exposed ports | Must persist rack instance and internal data | One undo | Viewer/report depend on production state | high | 42 | Depends on rack parity work. |
| Connector compatibility | Exact type match, CAT-family match, USB-family match, cage active module type, dead-cage blocking, input/output blocking, paired network and two-way exceptions. | Engine create path accepts any two different connectors. | broken | `effectiveConnectorType`, `areConnectorTypesCompatible`, `connectionError`, `isDeadCageConnector`, `isTwoWayConnector`, `isPairedNetworkConnector` | `ProductionEngineBridge.completeWireCreate`, `SceneGraph.addWire` | connector `type`, `direction`, `installedModuleType`, cable type metadata | Invalid connections currently can be saved if created in Engine | Undo works for created wire but should not allow invalid wire | Reports/export would inherit invalid data | critical | 36 | Extract shared compatibility module before adding more wire features. |
| Wire hover target feedback | Preview highlights only compatible, unoccupied targets and shows blocked states/status text. | Engine has connector hover and create feedback, but not full Legacy compatibility validity. | partial | `updateHoverConnector`, `renderPreviewWires`, `connectionError` | `ProductionEngineBridge.handlePointerMove`, `beginWireCreate`, `completeWireCreate` | same as connector compatibility | none unless committed | none | visual only | high | 36 | Should call the same shared rule used on commit. |
| Wire creation | Legacy creates production connection with ordered endpoints, cable type, custom color, fiber mode, signal index, notes, optional orthogonal frozen route. | Engine creates scene wire and writes a production connection, but ordering/metadata/compatibility are thinner. | partial | `startConnection`, `finishConnection`, `createConnectionBetween`, `freezeOrthogonalRouteFromPreview` | `ProductionEngineBridge.beginWireCreate`, `completeWireCreate`, `ProjectMutationAdapter.commitCreatedWire` | `state.connections`, endpoint refs, cable metadata | Saves because Engine writes production connection | One Engine undo command | Outputs read production data | high | 36-37 | Keep existing fast command path, add Legacy metadata/rules. |
| Endpoint rewire | Clicking an occupied device node detaches one endpoint, stores original connection, previews from fixed endpoint, then preserves original connection metadata on successful reattach or restores on failure. | Engine has create/delete/edit commands, but endpoint rewire parity is not implemented. | missing | `startConnection`, `restoreRewireConnection`, `preserveConnectionWithNewEndpoints`, `createConnectionBetween` | no dedicated rewire command | original connection object, changed endpoint only | Should preserve route points and metadata | One undo for endpoint move | Outputs should see same connection ID | high | 37 | Must not regress custom route-point preservation. |
| Jump-node wire creation | Legacy supports device-to-jump and jump-to-device, portal cable type inference, source/destination ordering, one-connection occupancy, and jump info boxes. | Engine maps jump nodes and supports loaded jump-connected wires visually; full create/reconnect compatibility is partial. | partial | `createConnectionToJump`, `createConnectionFromJumpToDevice`, `portalCableTypeForJumpNode` | Engine jump nodes in `projectAdapter`, `sceneGraph`, `ProductionEngineBridge.completeWireCreate` | `state.jumpNodes`, `connections.from/to.jumpNodeId` | Must save endpoint form unchanged | One undo | Viewer depends on jump endpoint data | high | 37 | Keep recent jump-node z-order and ghost fixes intact. |
| LED surface connection | Legacy supports LED signal multi-select, LED screen power/signal types, signal ordering, and processor registration. | Engine maps LED surfaces and virtual ports, but creation parity is not fully audited/migrated. | partial | `createConnectionToLedSurface`, LED connector selection helpers | `projectAdapter` LED surface mapping, scene validation virtual ports | `ledSurfaces[]`, `connections.to.surfaceId` | Saves through production state | Needs grouped undo for multi-connect | Reports count screens/pixels | high | 38 | Important for real projects with processors/screens. |
| Modular card generated connectors | Legacy combines chassis connectors and generated card connectors from `cardSlots`, `cardTypes`, per-slot overrides, and slot Y positions. | Engine normalizes generated card connectors for loaded templates, but Engine editing is not the owner of card changes. | partial | `generatedCardConnectors`, `effectiveTemplateConnectors`, `connectorById`, `connectorOverride` | `projectAdapter.generatedCardConnectors`, `effectiveConnectorsForTemplate`, `SceneGraph.normalizeDevice` | `template.cardSlots`, `template.cardTypes`, `slot.connectorOverrides` | Existing data saves; new Engine card edits not migrated | Needs template-level undo | Reports/export need generated connectors | high | 38 | Loaded E2-style devices rely on this. |
| Card/chassis editor workflows | Legacy Device Editor can add/reorder/delete slots/cards, assign cards, edit card connector fields, show card bands/captions, and apply library changes. | Engine is not the Device Editor; existing modal remains production/Legacy implementation. Engine canvas must stay in sync when those edits apply. | partial | `renderDeviceEditorPreview`, `renderCardEditorPreview`, editor slot/node drag functions | Bridge refresh path only | templates, project custom devices, connector overrides | Applying library can change many devices | Undo path production-owned | Outputs read final production templates | high | 38 | Decide whether to keep editor Legacy-owned but refresh Engine safely. |
| Faceplate visuals | Legacy draws custom face images, deleted faceplates, default faceplates, faceplate resize, adapter mode, and card bands. | Engine visual builder reads face image metadata and card visuals for fast rendering; not all editing paths are Engine commands. | partial | `drawDeviceBody`, `renderDeviceEditorPreview`, faceplate placement helpers | `projectAdapter.normalizeVisualMetadata`, `deviceVisualBuilder.js`, `renderer.js` | `faceImage`, natural size, scale, placement, deleted flag | Existing data should save | Editing undo production-owned | Viewer/PDF currently use production output | medium | 39 | Rendering is closer than editing parity. |
| Project custom device visuals | Legacy creates project-specific template overrides and shows them in Project Custom Devices. | Engine renders loaded custom devices but lacks create/duplicate/drop workflow parity. | partial | `templateForInstance`, `renderProjectCustomDevices`, `duplicateLibraryDevice` | project adapter visual normalization | `templateOverride`, image assets | Critical for user-created devices | Needs create/duplicate undo | Export compacts templates | high | 39 | Closely linked to device library drop. |
| Adapter/breakout devices | Legacy has special compact dashed rendering, no node fields, internal gradient wires, and special internal multi-connection rules. | Engine can normalize adapter visual metadata; full internal adapter wiring/editing parity not audited/migrated. | partial | `isAdapterTemplate`, `drawDeviceBody`, adapter internal wire helpers | `projectAdapter.isAdapterBreakout`, `deviceVisualBuilder` | adapter template flag, connector list, internal wires | Must preserve adapter flag and internal links | Needs adapter edit undo | Reports list as devices/adapters | medium | 39 | Keep for compact conversion devices. |
| Power distro plug layout | Legacy has PD flag, SVG plug assets, power plug layout, manual snapping/overlap warning, faceplate height rules, powerlock special full-width behaviour. | Engine marks power-distro visuals and colors, but PD editor/layout behaviour remains production-owned. | partial | `POWER_PLUG_TYPES`, `powerPlugLayout`, `drawPowerDistroFaceplate`, `startEditorPowerPlugDrag` | `projectAdapter.isPowerDistro`, `deviceVisualBuilder` | `template.isPowerDistro`, connector `powerPlug`, plug SVG metadata | Existing data saves; Engine not editing plug layout | Template-level undo needed | PDF/viewer use production render paths | high | 40 | Needs careful parity because PD devices are visually distinct. |
| Power connector/cable colors | Legacy supports power cable families and Powerlock multicolor segments. | Engine has power/multicolor render support from previous passes, but compatibility rules are not restored. | partial | `colorSegmentsForConnector`, `connectionColorSegments`, `POWER_PLUG_TYPE_IDS` | engine color/render helpers, `projectAdapter` connector colors | cable type metadata | Color does not affect save except custom colors | none | Legend/report color consistency | medium | 40 | Split visual parity from connection validity. |
| SFP/QSFP cages | Legacy treats cages as dead until an installed module provides the active connector type. | Engine compatibility does not currently enforce dead-cage/module rules. | broken | `isCageConnector`, `isDeadCageConnector`, `activeTypeForCageConnector`, `effectiveConnectorType` | no shared rule in Engine create path | `connector.installedModuleType` | Invalid cage connections could save | Undo works on invalid wire | Outputs would show bad cable | high | 36 | Should be included in shared compatibility module. |
| Device context menu | Legacy right-click device opens edit, matrix routing, duplicate, lock/unlock, delete. | Engine context hit-test delegates device target back to Legacy `showDeviceContextMenu(...)`. | partial | `showDeviceContextMenu` | `ProductionEngineBridge.handleContextMenu`, `index.html onEngineContextMenu` | selected device ID/source ID | Actions mutate production state | Depends on Legacy undo | Outputs read production state | medium | 41 | Delegation exists; each action still needs Engine scene refresh audit. |
| Wire context menu | Legacy wire menu supports create corner, select same type, length/notes via inspector, reset/delete routes, delete. | Engine delegates wire and wire-corner targets to Legacy menus, but action refresh/parity needs audit. | partial | `showWireContextMenu`, `showWireCornerContextMenu`, `createWireCornerAt`, `resetWireRoutes` | `ProductionEngineBridge.handleContextMenu`, `onEngineContextMenu` | connection route points | Route changes must write production and Engine scene | Needs one undo per action | Viewer/export uses routes | medium | 41 | Recent Engine route-point visuals should stay. |
| Empty-canvas context menu | Legacy has canvas-level actions where applicable. | Engine empty context currently clears selection and forwards `target: null`; no full menu parity. | missing | empty-canvas/context helpers in Legacy menu code | `ProductionEngineBridge.handleContextMenu` | selected state | depends on action | depends on action | depends on action | low | 41 | Lower priority than device/wire actions. |
| Rack builder/internal wires | Legacy has rack builder, rack internal 90-degree routes, route-point/segment dragging, exposed ports, show internal wiring, rack context menu. | Engine maps racks/internal data enough for project validation/visual survival, but the rack builder itself remains production-owned. | partial | `renderRackBuilder`, `createRackInternalConnection`, `rackInternalWireRoute`, `startRackBuilderWireSegmentDrag`, `showRackContextMenu` | `projectAdapter`, `sceneGraph`, Engine context delegation | `state.racks`, `internalConnections`, exposed ports | Must preserve rack data | Production-owned currently | Viewer can show rack internals via production paths | high | 42 | Needs its own focused iteration. |
| Matrix routing | Legacy conditionally exposes matrix routing menu and matrix routing modal. | Engine context delegates matrix device menu back to Legacy device menu if target maps correctly. | partial | `showDeviceContextMenu`, matrix routing modal functions | Engine context delegation only | matrix routing fields | Existing data saved by Legacy | Production-owned | Reports may include matrix data later | medium | 41 | Audit after generic context parity. |
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

- Reads `isPowerDistro` and connector colors.
- Can render existing devices through normalized visuals.
- Does not own the PD plug layout/edit workflow.

### G. Right-Click / Context / Action Parity

Legacy source locations:

- `showDeviceContextMenu(...)` around line 48082
- `showRackContextMenu(...)` around line 48115
- `showLedSurfaceContextMenu(...)` around line 48241
- `showLibraryDeviceContextMenu(...)` around line 48259
- `duplicateLibraryDevice(...)` around line 48298
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

### Iteration 36 — Shared Connector Compatibility

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

Still intentionally out of scope:

- endpoint rewire flow
- connector occupancy policy

Validation:

- HDMI-to-HDMI valid.
- HDMI-to-SDI invalid.
- CAT5E/CAT6/CAT6A/etherCON/Ethernet cross-family valid.
- USB-A/USB-B/USB-C cross-family valid.
- dead SFP/QSFP cage invalid until module is installed.
- two outputs invalid unless two-way/paired exception applies.

### Iteration 37 — Endpoint Rewire Parity

Restore occupied-node click/reassign behaviour.

Scope:

- Detach one endpoint of an existing wire.
- Preserve original wire ID and metadata.
- Preserve custom route points unless explicitly reset.
- Restore original connection on cancel/invalid drop.
- One undo step.

Validation:

- Rewire one endpoint.
- Rewire with custom route points.
- Cancel rewire.
- Undo/redo rewire.

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

### Iteration 39 — Faceplates, Project Custom Devices, Adapters

Complete custom visual creation/editing parity.

Scope:

- Faceplate replace/delete/resize updates Engine textures.
- Project custom devices remain available and draggable.
- Adapter/breakout compact visuals and internal wiring survive Engine edits.

Validation:

- Small adapter/breakout device.
- Large image faceplate.
- Deleted faceplate.
- Project custom device drag/drop.

### Iteration 40 — PD / Power Distro Parity

Restore special power-device rules in Engine workflows.

Scope:

- PD generated SVG plug layout.
- Manual plug positions.
- Powerlock special visual/compatibility treatment.
- Power connector validation.

Validation:

- PD with generated faceplate.
- Manual plug move saved/reloaded.
- Powerlock wire/node color parity.

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

### Iteration 42 — Rack Builder And Internal Wires

Restore rack creation/internal-wire special cases.

Scope:

- Rack library drag/drop.
- Rack internal wire create/rewire/route.
- Exposed rack ports.
- Show/hide internal wiring in Engine and viewer data.

Validation:

- Build rack.
- Place rack.
- Edit rack from canvas.
- Internal wires persist and export safely.

### Iteration 43+ — Resume Output Migration

Only after the above functional parity passes should viewer/PDF/report visual
migration resume.

## Validation TODOs

Run these after each parity iteration:

1. `node scripts/engine-real-project-validation.mjs --fixture`
2. `node scripts/engine-real-project-validation.mjs "/path/to/real-project.avd"`
3. `git diff --check`
4. Browser smoke:
   - `index.html?v=iteration35-3`
   - `index.html?legacy=1&v=iteration35-3`
   - `index.html?engine=1&debugHud=1&v=iteration35-3`
   - `index.html?debugLibraryDrag=1&v=iteration35-3`
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
