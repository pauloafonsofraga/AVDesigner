# Multi-Core Phase 5: Editor and Independent Terminations

## Baseline and scope

Repository: `pauloafonsofraga/AVDesigner`, branch `engine-prototype`.
Starting local HEAD and fetched remote HEAD both:
`82f2ffeba37ffcfb713a5f0d487d5ff06c9be4b2` (54.38.107, Portable Clipboard).
This preserves the newer clipboard fix after the prompt's 54.38.106 baseline.
Origin was fetched and compared again before committing.

Build: **54.38.108 / Multi-Core Editor**. Phase 5 only. No Legacy changes,
trunk teleportation, rack docking, fibre strand fanout, replacement compatibility
engine, new database, Signal Chain redesign or Cable Schedule redesign.
Unrelated artwork, `Devices/faceplates/`, `Devices/to_delete_later/`, `Masters/`,
backups and PDF investigation scripts were not edited or staged.

## Architecture and shared components

`src/engine/multiCoreEditorDraft.js` owns detached draft data, stable allocation,
local history and physical-layout operations. `multiCoreEditor.js` owns one
modal session, its listeners and its disposable preview. The existing
`multiCoreCanvas.js` bridge owns project commits and scene updates. The existing
personal-definition owner owns reusable definitions and persistence.

All accepted writes pass `multiCoreEditValidation.js`. Schema 1, Phase 2 IDs,
Phase 3 passive connectivity, and Phase 4 projection remain authoritative.
The canonical validator now also delegates optional termination connector
relationships to the existing `validateConnectorTopology`, rejecting dangling
member/source/target references before save.

Reused UI: `.modal`, `.modal-header`, `.modal-footer`, `.editor-tabs`,
`.editor-tab`, `.field`, `.tool-button`, `.primary-button`, existing theme
variables, and the Faceplate Editor's selection, marquee, overlap-warning and
snap-guide classes. Scoped CSS supplies layout and responsive scrolling only.
Device/Faceplate screenshots were compared directly, not just their colors.

`EnginePreviewSurface` owns the registered `multi-core-editor` preview. The
physical face is an authoring overlay, not a second scene renderer. Original
face artwork stays mounted during drag frames instead of being reattached and
decoded repeatedly. Preview disposal releases its observer and rendering owner.

Shared placement primitives exposed by the shell:

- `captureEditorDragCoordinateFrame` and `getEditorDragPreviewPoint`: frozen
  client-to-model conversion, including at different preview zooms.
- `snapPowerPlugCenter` and `clampPowerPlugCenter`: the same alignment, gap,
  tolerance and boundary rules, with optional supplied face/layout arguments.
- `powerPlugOverlapIds`, `rectFromPoints`, `rectContainsPoint`: collision and
  marquee behavior, without a separate placement solver.
- `legacyFaceImagePlacement`: existing padding, scale and offset logic, with
  optional physical bounds to Fit an independent face in both axes.
- `canvasWheelZoomModifierActive`: the established wheel modifier convention.

Existing helper signatures/default behavior remain intact. No card layout,
shared-bus grouping or ordinary Device Editor duplication implementation changed.
`modularDeviceLayout` remains responsible for cards; a termination does not gain
card semantics merely to share an editor window.

## Entry points and sections

Select a termination or trunk and choose **Edit Multi-Core** in the Inspector.
End A/B opens that end; the trunk opens Trunk; Select Assembly opens General.
The existing **Place Multi-Core** picker offers Create, Edit Personal,
Duplicate and Place. Its Project assemblies selector also permits inspection of
retained records that cannot produce selectable schematic geometry.
Only one Multi-Core editor can be open at a time.

| Section | Editing surface |
| --- | --- |
| General | Name, assembly ID, manufacturer, model, category, location, description, notes, provenance and instance overrides |
| Trunk | Physical length/unit, manufacturer, model, jacket, coupling, construction notes, route style and physical circuit groups |
| End A / End B | Independent style, mechanical metadata, faces, artwork, connector properties and physical placement |
| Channels | Stable circuit identity, displayed number, media/specification, explicit A/B port selectors, state, notes and ordering |
| Defaults | Ownership/revision, Save as New Personal Definition, Reload Saved Default for saved personal definitions |

All seven approved styles share one model: Fanout, Stage Box, Rack Panel,
Wall Plate, Inline Breakout, Custom Enclosure and Generic. Changing a style
does not regenerate end/port/circuit IDs or alter the opposite end.

- Fanout and Inline Breakout expose per-port tail label, length, unit and order.
  Connector type/gender and physical notes remain ordinary port metadata.
  Tails do not become independent project cable records.
- Rack Panel exposes rack units and independent panel face dimensions, labels
  and artwork. It does not dock into Rack Builder automatically.
- Stage Box, Wall Plate and Custom Enclosure use independent front/rear
  dimensions, artwork, connector layouts and physical notes.

Physical dimensions are labeled in existing model units, not incorrectly
presented as millimeters. Front/rear layouts live in `face.portPlacements`;
schematic port coordinates/anchors remain unchanged when physical ports move.
The trunk's physical length is authored metadata, never inferred from distance.

## Connector and channel workflows

Connector types come from the resolved application vocabulary plus captured
personal/project node definitions. Scoped aliases and compatibility metadata
remain available; there is no private Multi-Core connector catalogue.

Ports support add, single/additive/marquee selection, multi-port movement,
numeric X/Y, duplicate, remove, face assignment and horizontal/vertical center
alignment. Pointer capture, release, cancellation, boundary clamping, shared
snap guides and overlap feedback are supported. Middle-button pans; existing
wheel-modifier behavior zooms; Fit includes the full face. Arrow keys move one
model unit, Shift moves ten. Physical labels shrink with the layout at low zoom;
full labels remain in the port list and native hover tooltip.

Port properties include label, type, physical connector, gender, media,
specification, polarity, optional pinout, physical notes and read-only ID.
Pinout uses an explicitly labeled JSON field; ordinary diagnostics are readable
messages rather than raw serialized validator output.

Adding a group explicitly creates the requested circuits and matching new A/B
ports together. Adding an individual circuit leaves its two selectors
unassigned until the user chooses ports. Neither display labels nor array order
are used to infer correspondence. Group duplication allocates new identities;
quantity reductions reject occupied channels. Removing unused circuits retains
now-unassigned ports for deliberate cleanup.

Duplicated ports receive new allocated IDs and schematic rows/anchors. They do
not inherit circuit assignments or membership in another port's relationship.
Retained ports and their mappings keep their IDs. Definition duplication creates
a new definition and end identities while preserving valid definition-local
port/circuit IDs and their explicit references. No normalization-time randomness
or wholesale renumbering is introduced.

Channel status distinguishes available, occupied, reserved, disabled,
incomplete/unresolved and incompatible records. Diagnostics identify channels
and ends; affected tabs are marked. Reordering a channel only changes display
order. Known incompatibility, ambiguous assignments and missing references
remain canonical validation errors. Unknown physical attributes remain warnings,
not a claim of verified pinout or polarity.

Occupied circuits/ports cannot be deleted, remapped, given incompatible media
or disabled in a way that invalidates external patch cables. Assigned unused
ports must first have their explicit channel assignment cleared. Disabled UI
controls are only an affordance: Phase 4.1 validates the entire transaction again.

## Drafts, history and ownership

Opening clones the record. Draft edits, pointer previews, artwork and local
undo/redo never mutate canonical project state. Local history is bounded to 30
edits. A successful instance Save makes one atomic existing project history
command. Undo/redo restores identities, styles, placements, mappings, artwork
and trunk data. An apply error rolls back the previous canonical fields.

Failed Save keeps the draft available for correction, while Cancel, Close and
Escape remain usable. Escape during a drag cancels that drag first. Cancel
creates no project history entry. A concurrent change to the same instance is
detected before commit instead of overwriting current project state.

Reusable definitions use the existing `localUserSettingsOwner.save` and its
revision, provenance, node-dependency and content-addressed artwork machinery.
No second database or parallel revision system was added. Real two-tab testing
confirms stale saves are rejected. Reload Saved Default refreshes the saved
definition, connector definitions and expected revision; Close/Cancel remains
safe after a conflict. Factory products can be duplicated, not silently edited.

Instance editing does not alter its reusable product. Existing instances keep
their embedded resolved-definition snapshot when a personal definition changes.
The General tab identifies instance overrides, and Save button text names the
owner being changed.

## Artwork and projection

PNG (including transparency), JPEG, WebP and validated safe SVG use existing
image-format detection/data-URL helpers. Upload retains original bytes and
dimensions; face scaling/offsets do not resample the asset. Artwork can be
replaced or removed independently on A/B front/rear faces.

The existing personal-store asset mechanism and project artwork traversal are
reused. Before placing a library definition, required node/face artwork is
embedded with `inlineProjectArtwork`/`inlineImage`, including previously unloaded
connector thumbnails. A missing asset fails placement visibly and leaves it
recoverable. Cancelling while preparation is pending does not place an object.

Instance Save incrementally replaces only affected projected ends/trunks and
refreshes connected wire geometry/indexes, selection keys, renderer data and
connectivity cache. Unrelated scene objects remain the same objects. Existing
full normalization is retained for insertions/removals or invalid projections.
There is no graph rebuild or project normalization per draft pointer frame.

Canvas and output remain two schematic bodies plus one trunk. Full-resolution
editor artwork does not become schematic textures. The connected acceptance
case retains the two typed external patch leads, their IDs, lengths and channel
assignment. Passive circuit topology does not create a third physical cable.
Signal Chain and Cable Schedule regressions pass; the PDF report shows one
2 m and one 3 m SDI cable, not synthetic trunk/tail cables.

## Validation results

- Full Node suite: **1,526 passed, 0 failed, 0 skipped**. Includes 18 dedicated
  editor tests plus existing model, connectivity, projection, validation,
  relationships, personal library and Device/Faceplate suites.
- All **16 static validators** pass.
- Output Viewer and Cable Schedule bundles rebuilt; reproducibility checks for
  Output Viewer, Cable Schedule and PDF all pass. PDF bundle remains unchanged.
- Changed/new JavaScript syntax, inline application-source validation and
  `git diff --check` pass.
- **22 existing Chrome smokes** pass after the rechecks described below, plus
  the new editor smoke (12 workflow groups, zero page errors).
- Existing browser coverage: Multi-Core canvas/connectivity/persistence;
  Device Editor integration/shared buses; card shared buses, direction reset,
  dragging and identity; power-distro marquee; personal-definition isolation;
  connector relationships; Loom stability, Portals and Loom-owned Jumps;
  ordinary Jump persistence; rack patch panels; matrix crosspoints; patch-panel
  Signal Chain; Cable Schedule; standalone HTML/Publish; production PDF.
- Production PDF regression checks pass **23 cases**, with no reported PDF
  warnings. The edited Hybrid 14 fixture also exports through the real toolbar.
  Both rendered PDF pages were inspected, including the 100 m trunk, Fanout B
  and two real cable rows. Poppler emits a nonfatal Fontconfig configuration
  warning; text and diagrams render successfully.
- Offline HTML and simulated hosted Publish render four schematic ends for two
  assemblies, with network requests blocked and no physical-editor imagery.
  Existing output smoke also covers authentication, reports and 100/400-device
  scenes. No live hosting account upload/deployment verification was performed.

The initial regression pass found and resolved four failures, not silently
skipped them: (1) placement captured node artwork URLs that changed during
save/reload, now embedded before placement; (2) an obsolete Phase 2 persistence
assertion expected zero projected objects, now checks Phase 4's two ends/one
trunk while retaining zero synthetic canonical devices/cables; (3) a card test
targeted circles replaced by loaded thumbnails and an ambiguous reorder
boundary, now uses existing layout coordinates and crosses the boundary;
(4) a thumbnail identity test treated legitimate lazy `src` population as a
change, now verifies `src` equals its declared source before canonical comparison.
The old card smoke also failed against unchanged starting HEAD. Behavioral
reorder/cancel/bidirectional-anchor and identity assertions remain in place.

## Chrome acceptance and measurements

`scripts/multi-core-editor-smoke.mjs` exercises actual browser controls for:
opening from A/B/trunk; all sections; independent styles; drag at multiple
zooms; numeric positions; add/duplicate/delete; marquee/group move; guide
feedback; Escape cancellation; transparent PNG/SVG upload and replacement;
front/rear; channel protection and failed Save; atomic undo/redo; real project
Save/reopen; personal create/edit/duplicate/place; two-tab conflicts; Defaults
reload; future-schema read-only inspection; desktop/light/narrow layouts;
offline HTML, simulated Publish and production PDF.

Local Chrome measurements in milliseconds, one completed run per circuit count.
UI timings include Playwright event/render waiting; they are not benchmark
averages. Drag is ten paced pointer steps, while Max handler measures actual
individual pointer-handler work. Faces includes rear and front; Save includes
personal-store persistence and closing. Fixtures were already populated before
the timed open operation.

| Circuits | Open | Tab | Drag total | Max handler | Faces | Mapping | Validate | Save/close | Close |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 34.1 | 39.2 | 187.3 | 0.7 | 91.6 | 7.4 | 1.1 | 129.2 | 26.5 |
| 16 | 34.3 | 44.0 | 182.4 | 1.1 | 111.3 | 17.7 | 2.5 | 168.6 | 26.8 |
| 32 | 36.5 | 63.2 | 191.6 | 1.4 | 111.4 | 31.8 | 3.4 | 138.0 | 41.8 |
| 64 | 43.1 | 61.7 | 184.1 | 2.6 | 110.7 | 114.4 | 6.4 | 173.5 | 30.1 |

Reproducible local artifacts: `/tmp/wirenexus-multi-core-editor/` contains
`results.json`, `end-a-artwork.png`, `channel-mappings.png`, `snap-guides.png`,
`device-editor-reference.png`, `light-editor.png`, `narrow-editor.png`,
`main-canvas.png`, `offline-schematic.png`, `simulated-publish.png` and
`edited-multi-core.pdf`. Screenshots were visually inspected. These are generated
acceptance artifacts, not production assets or permanent repository files.
The existing power-distro marquee smoke supplies the equivalent Faceplate
selection/group-drag/cancel/boundary acceptance and screenshot reference.

## Changed files and remaining limits

New production modules: `multiCoreEditor.js`, `multiCoreEditorDraft.js`.
Integration: `index.html`, `multiCoreCanvas.js`, `multiCoreModel.js`,
`faceplateGeometry.js`, `enginePreview.js`. Build/cache fingerprints also update
`productionBridge.js`, `renderer.js` and matching static validator assertions.
Generated artifacts: `outputViewerBundle.json`, `cableScheduleBundle.js`.
Tests: new `multiCoreEditor.test.mjs` and `multi-core-editor-smoke.mjs`, adjusted
`multiCoreCanvas.test.mjs`, persistence/card-drag/card-identity smokes and preview
ownership validator. This document records the requested implementation report;
the final delivery message records the committed SHA and verified pushed SHA.

- Structurally malformed collections remain inspectable and cancellable; the
  editor does not invent missing identities or an entire missing end structure.
  Supported drafts with missing/incorrect mappings can be repaired explicitly.
  Unknown future schemas remain opaque/read-only.
- Unknown physical pinout/polarity is not verified. Editing a pinout currently
  requires JSON rather than a connector-specific pin diagram.
- Crowded faces report overlaps instead of silently repacking authored ports.
  Users can adjust dimensions/positions. Very low zoom intentionally reduces
  physical-label size; the always-readable port list retains full names.
- No stress benchmark of arbitrary very-large user artwork or private projects
  was performed. Original artwork is not downsampled; its memory cost remains
  relevant even though drag does not reattach it.
- Hosted Publish was simulated, not deployed. An actual hosting-session check
  remains a deployment verification task.
- Phase 6 must retain the validation gate, captured definitions and explicit
  channel identities. Whole-trunk teleportation, rack docking and independent
  strand fanout remain outside this change. Stop here for review.
