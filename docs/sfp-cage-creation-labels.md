# SFP Cage Creation and Installed Module Labels

Build 54.38.118, SFP Cage Labels. Scope: Engine picker eligibility and derived
module captions only. No catalogue migration, compatibility redesign, deployment
or release tag.

## Baseline and Reproduction

Starting local and fetched `origin/engine-prototype` were both
`73efdea57dbccb6bbf9bd13605d322fff246050f` (54.38.117).

Chrome reproduction used a fresh isolated profile, not the user's open browser.
Toolbar Node Editor (`nodeBuilderButton`) opens the Node Builder definition list.
Searching SFP returned DAC, but zero cage entries. HDMI remained selectable.
The list used `filteredNodeEntries` / `orderedNodeEntries`, which deliberately
exclude `palette: false` cable types. All four physical cages have that flag.
Separately, `selectedNodeType` rejected those same records even if selected.
The previous fix covered the Device Editor connector palette/physical-type
Inspector, not these two Node Builder gates.

Node Builder edits node-library definitions; it does not place device instances.
Actual placement is Device Editor > Connectors > Add Input/Output Slot, then drag
the desired connector from the palette onto that slot. Acceptance exercised both
entry points, including native mouse drag/drop, rather than substituting a
physical-type dropdown change for placement.

## Picker Correction

`nodeBuilderEntries` adds the four existing canonical cage records to the Engine
Node Builder list and groups them first under SFP / QSFP Cages. Its selection
guard admits them regardless of historical palette flags. Supported identities:
`sfp-cage`, `sfp-plus-cage`, `sfp28-cage`, `qsfp-cage`.

It consumes the existing resolved `cableTypes` library (factory defaults plus
current personal/project overrides), not a new catalogue. The Device Editor
continues using its scoped `editorNodeDefinitions` dependency context. Neither
picker rewrites flags. Ordinary cable-palette eligibility, generic New Node
creation, placement/snapping/history, and the Legacy branch are unchanged.

## Shared Display Policy

`engineConnectorCanvasLabelLines` in `src/engine/connectorCompatibility.js`
resolves the existing installed-module metadata and module profiles. An empty
cage returns its physical cage caption. An installed module returns two lines:
`Installed Module` and a compact user-facing label, such as `SFP SDI 12G RX`,
`SFP SDI 3G TX`, `LC Single Mode`, `RJ45 Ethernet`, or `SFP28 DAC 25G`.

The resolver uses existing profile capabilities for SDI rate/direction, rather
than guessing from an unknown ID. Historical object/flat aliases use
`installedModuleDetailsForEngine`. Unknown modules retain an explicit authored
module name, otherwise show Unknown module; historical generic SDI does not gain
a fabricated rate or direction.

Consumers:
- Live Engine connector label layer, including installed cards and shared buses.
- Baked connector label fallback in `deviceVisualBuilder`.
- Card-definition SVG preview, via the same resolver exposed by bootstrap.
- Output Viewer/technician viewer, offline HTML, hosted Publish preparation and
  vector PDF, through their existing shared renderer/output label path.

The caption remains derived, not an editable info-field or saved connector name.
Authored names, text, aliases and custom fields remain in their existing roles.
No IDs, coordinates, anchors, card ownership, device dimensions or cable records
are changed by this display policy. Existing module commits still update
compatibility, colors, Inspector/tooltip and the affected preview through their
existing mutation path. Hover does not commit changes or rebuild the project.

Normal/high zoom shows both lines. Below 50% the extra heading is omitted;
existing node-label hiding remains in effect. Canvas captions fit the available
device/card width with the existing text fitter. Card SVG captions fit their
band. Neither path changes physical geometry to accommodate text.

## Verification

Evidence root: `/tmp/wirenexus-cage-labels-2026-10-21`.
Production checks run from an isolated checkout of the staged tree, excluding
the unfinished Device JSON Import work and unrelated assets.

- Focused picker/label/caption/shared-bus suite: 41 passed.
- Full committed Node suite: 1,710 passed, zero failed/skipped.
- All 16 static validators passed; Viewer/PDF/XLSX bundles reproducible/current.
- Changed JavaScript and embedded app script syntax checked; diff whitespace clean.
- `scripts/cage-picker-acceptance.mjs`: 10 real-Chrome workflow checks, including
  Node Builder selection, all four native palette drops, compatible installs,
  stable IDs/positions, Save/Keep/Discard, personal reopen, historical flags,
  downloaded project reload, canvas module undo/redo, offline HTML and Publish
  preparation with private storage/network mocked, and actual PDF export.
- `scripts/sfp-module-acceptance.mjs`: 36 checks covering ordinary/card modules,
  installed-card overrides, all module-family restrictions, SDI/DAC wiring,
  connected-module rejection, stable wire IDs/lengths, project persistence,
  undo/redo, schedule, offline HTML and vector PDF. Card authoring additionally
  asserts the exact two derived SVG lines.
- `scripts/editor-unsaved-changes-smoke.mjs`: 12 checks including Save, Discard,
  Keep Editing, Escape and invalid-save recovery, without partial canonical writes.

Inspected screenshots include:
- `baseline-node-builder-missing.png`: original missing cage search results.
- `isolated-chrome/node-builder-cages.png`: corrected selectable group.
- `isolated-chrome/device-editor-cage-palette.png`: actual placement palette.
- `isolated-chrome/high-zoom-module-label.png` and `low-zoom-module-label.png`.
- `isolated-chrome/offline-html-module-label.png` and `publish-module-label.png`.
- `final-sfp/card-definition-sdi.png` and `card-installed-sdi.png`.
- Rasterized `cage-labels.pdf` and the broader SFP export PDF.

PDF text extraction can insert spaces between glyphs and duplicate outlined text;
normalized extraction and rendered page inspection verify the actual captions.

## Safety and Changed Files

The 101 pre-existing protected files were hash-checked unchanged. The three
unrelated `index.html` import hunks (49 added lines) remain unstaged, as do the
40 pre-existing additions in `src/personalDefinitions.js`. No reset, stash, clean
or user-profile storage edits were used.

Production files: `index.html`, `src/factoryCatalogueBootstrap.js`,
`src/engine/connectorCompatibility.js`, `src/engine/deviceVisualBuilder.js`,
`src/engine/renderer.js`, `src/engine/productionBridge.js` (fingerprint only),
`src/engine/generated/outputViewerBundle.json`.

Verification files: `test/cageModuleLabels.test.mjs`, `test/cagePicker.test.mjs`,
`test/connectorPlugCaptions.test.mjs`, `test/sharedBusOverlay.test.mjs`,
`scripts/cage-picker-acceptance.mjs`, `scripts/sfp-module-acceptance.mjs`, and the
four existing build-fingerprint validators: canvas-layout-objects,
connector-operational-status, jump-node, preview-ownership. This document records
the audit. The delivery response records the final commit and verified remote SHA.

## Limitations

No live hosted upload/deployment was performed. Publish preparation used the real
application path with mocked private storage and API responses; the resulting
viewer was opened with network blocked. Chrome ran headlessly in fresh profiles.
Selected native dropdowns were temporarily expanded only for screenshots.
Low-zoom captions may truncate to fit; the full existing module tooltip/Inspector
remains available. Hardware/platform compatibility is still subject to the
existing unverified-host warnings; this change does not invent new capabilities.
