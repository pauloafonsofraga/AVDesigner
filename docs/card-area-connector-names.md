# Prompt 3/8: Card Editing Area and Connector Names

Build 54.38.125. Starting local and fetched remote HEAD:
`ff6d54f41d5a895ed75d80e92237bc68f9515f0f`, branch `engine-prototype`.
Only Issues 7 and 9 are implemented. No deployment, release tag or Prompt 4 work.

## Audit and ownership

The Card Editor is an SVG authoring surface inside Device Editor, not the installed
Engine device preview. `editorCardPreviewBand`, `editorCardPreviewRows` and
`editorCardConnectorLayout` derive a half/full-width band from card kind and rows.
Connector movement reorders stable connector records; `normalizeCardConnector`
retains the established 380-unit coordinate convention. No canonical card width,
height or free-form physical rectangle existed. Installed connectors are projected
separately by `resolveInstalledCardConnectors` in `modularDeviceLayout.js`.

Physical chassis slots own stable IDs, Y placement and optional `physicalLayout`
side/span. `cardBandGeometryForSlot` and `cardFitsPhysicalSlot` remain authoritative
for installed geometry. Editor area dimensions are deliberately NOT physical-card
or slot dimensions. Enlarging the editing area does not imply a larger chassis
card, change the row count or move installed anchors. No slot is silently expanded.

`renderCardEditorPreview` formerly rendered connector graphics and type/module
captions, but never rendered `connectorInfoFields`. The ordinary Device Editor and
inspector already use this field policy. Before edits, the actual Chrome fixture
showed zero resize handles and no visible `SDI OUT 1` despite its configured name.
`AVDESIGNER_BASELINE_PROBE=1 node scripts/card-area-names-smoke.mjs` failed with
`{resize:0,name:false}` versus `{resize:3,name:true}`. This is the regression-first
evidence for both limitations; the assertion remains in the acceptance script.

## Geometry implementation

- One optional card-owned `editingBounds: {x,y,width,height}` stores the authoring
  boundary. It is not duplicated onto slots or connectors. Historical cards without
  it use their existing row/kind-derived layout, with a display-only margin around
  their measured content. Opening a card does not add saved metadata.
- `cardEditingArea.js` computes bounds and clamps resizing. Actual SVG `getBBox`
  measurements include all connector groups, both-side anchors, names, info boxes,
  type/module labels and current controls. Twelve world units provide stroke and
  internal clearance. Empty areas have a 96 by 108 minimum. Node centers alone are
  never used as the minimum-size test. Non-finite geometry is rejected; invalid
  optional saved rectangles fall back safely.
- Right-edge, bottom-edge and corner handles resize width, height or both. Handles
  stay twelve screen pixels across zoom levels and expose resize cursors/tooltips.
- Existing SVG screen/local conversion and `captureEditorDragCoordinateFrame`
  anchor pointer deltas. The left/top origin stays fixed during a drag. Existing
  navigation snapshots preserve camera position on commit/cancel.
- The existing `editorResizeSession` owns capture, cancellation, animation-frame
  coalescing and completion. Preview uses a shallow proposed card rectangle and
  updates only boundary/handle attributes. It does not normalize nodes, solve a
  new modular layout or mutate the draft during movement.
- Commit uses `commitEditorCardCollectionEdit` with `preservePlacement:true` and
  existing card safety validation. Invalid installed slot structures reject before
  mutation. Since editing bounds do not change physical requirements, valid cards
  remain compatible even when their authoring workspace is enlarged.

Resizing preserves connector IDs/order/coordinates/anchors, names, relationships,
module capabilities, slot footprints, unrelated cards and external cables. There
is no new placement engine and no physical-card coordinate migration. If a later
node/label edit needs more room, the displayed editing boundary expands to contain
it; that fit is computed without silently repacking nodes.

## Naming policy

Card Editor now calls the same `connectorInfoFields` and `addVisibleInfoBoxes`
helpers used by Device Editor presentation. `nameText` is the authored visible
name, `customText` is the separate custom/alias field, and resolution/address plus
custom field captions retain existing rules. There is no new alias precedence:
an arbitrary historical `alias` property does not override `nameText`, just as in
the existing Device Editor. Empty optional fields are omitted. Type captions remain
the existing `connectorTypeLabel` fallback; SFP installed-module caption handling
is unchanged. Electrical type and stable ID never derive from display text.

Existing info-box wrapping/font/alignment and per-anchor inward placement are
reused. Both-side nodes get fields at both anchors. Existing representative-only
shared-bus presentation is retained; collision avoidance is not redesigned. Names
update through the existing card inspector/history lifecycle. Installed views,
viewer, reports and PDF keep their existing canonical naming/visibility rules;
no output-only naming implementation was introduced.

## Verification and evidence

Evidence is under `/tmp/wirenexus-prompt3/` and is intentionally not committed.

**VERIFIED PASS:** focused geometry tests cover empty horizontal/vertical/combined
resize; one, 20 and 100 measured node/label rectangles; negative-edge and bottom
extents; minimum clamping; finite values; historical/malformed metadata fallback;
save serialization; physical-slot and installed-port invariance; connected-card
safety; and unchanged output scene for workspace-only resize.

**VERIFIED PASS:** shared naming resolver parity across HDMI, SDI, DisplayPort,
Ethernet, fibre, SFP cages/modules, audio, power and custom nodes, with configured,
missing, long, custom-caption and historical optional fields. Vector output retains
authored name and custom text without changing connector capability.

**VERIFIED PASS:** native Chrome drags on all resize handles, live preview unchanged
draft, exact preview/commit parity, minimum enforcement, Escape cancellation,
one history entry per resize, exact undo/redo, Keep Editing, Discard Changes,
middle-button pan and zoom with unchanged SVG node/label anchors, inspector rename,
Save/reopen, actual `.avd` save/reload, hosted-viewer preparation, offline HTML
Output Viewer and focused vector PDF download. Fixture loading uses the existing
snapshot API; interactions use actual mouse/keyboard controls.

Screenshots: `card-before.png`, `card-live-e.png`, `card-live-s.png`,
`card-after.png`, `card-minimum.png`, `card-reopened.png`, `offline-card.png`.
Browser script: `scripts/card-area-names-smoke.mjs`.

**Performance:** native drag sequences including ten pointer moves and a screenshot
took approximately 240-290 ms in the initial run. Empty-card zoom was 3.34 and
50-connector-card zoom 0.245. Those complete resize operations invoked only three
and two full card renders respectively, not one per move. These are local smoke
measurements, not hardware-independent frame-rate guarantees.
The final run alongside the full suite measured 285-472 ms per ten-move drag
including screenshots, with two full renders for both empty and dense cards.
The browser harness waits for the editor's scheduled open-fit frames before
measuring handles. Text raster bounding boxes can vary fractionally with zoom;
the pan/zoom check therefore compares authored SVG anchors and text, not font
raster metrics.

**VERIFIED PASS:** isolated staged tree, excluding all unfinished import work:

- `node --test test/*.test.mjs`: 1,837 passed, zero failed/skipped, including
  ten new card-area/name tests. Focused card-drag/editor-preview run: 265 passed.
- All sixteen `scripts/*-validation.mjs` validators passed.
- `node scripts/build-output-viewer.mjs --check`, `build-pdf.mjs --check` and
  `build-cable-schedule.mjs --check` passed. The new shared module export changes
  minifier symbol allocation, so all three generated bundles were regenerated;
  PDF/XLSX source behavior was not modified.
- `card-safety-browser-smoke.mjs`, `jump-node-replacement-smoke.mjs` and
  `card-area-names-smoke.mjs` passed against the isolated server in actual Chrome.
  The node-replacement harness retains its documented known failing null-module
  fixture exclusions; this is not a claim that those failures were repaired.
- Embedded application script and scoped JS syntax checks, and `git diff --check`.
- Screenshots of resized/reopened cards and offline HTML were inspected. The
  focused vector PDF was rasterized with Poppler and inspected: card names,
  custom fields, installed slot placement and the connected cable are retained.
  Offline viewer field visibility still follows its existing zoom policy.

**NOT TESTED:** exhaustive historical personal-card imports, live hosted publishing,
separate native personal-library save/duplication, and every possible rotated
custom node graphic. The card editor currently uses row-based connector anchors;
this phase does not introduce free-form physical card resizing or new orientations.
Existing repository tests cover library ownership, duplication and special nodes.

**PRE-EXISTING ISSUE, VERIFIED FAILURE:** `node scripts/engine-pdf-production-smoke.mjs`
was rerun on an untouched archive of baseline
`ff6d54f41d5a895ed75d80e92237bc68f9515f0f` and the isolated implementation. Both
exit 1 with the same stack (paths shortened):

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

Impact: those Jump-label fixtures abort before PDF generation. The focused card
PDF succeeds. No unrelated PDF production source or failing test was modified.
Logs: `pdf-baseline.log` and `pdf-final.log` in the evidence directory.

## Protection and changed surfaces

The original 49-line Device JSON Import shell patch and 40-line personal-definition
patch remain excluded. All 101 initial protected files (artwork, faceplates,
Masters, backups, import files and probes) are hash-checked. No reset/stash/clean.

Production changes are the card-area helper exported by the existing placement
module and Engine-gated Card Editor rendering/resize handling. Shared resize paths
retain their previous behavior for non-card operations. Legacy has no new handles,
field rendering or geometry metadata application. Build fingerprints and the
generated viewer bundle are refreshed, alongside focused tests and this report.

The final commit and verified remote SHA are returned after push. Stop before
Prompt 4/8.
