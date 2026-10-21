# SFP-Capable Nodes

Build 54.38.119. Starting local and fetched `origin/engine-prototype`:
`7bac48ff996a2a4b7b61d07ee1fd6b63349011a6`.

## Architecture and Scope

The toolbar Node Builder edits reusable node-library definitions. Device Editor
connectors, card definitions, and installed-card overrides are separate authoring
surfaces. The latter already had detached drafts, structural history, module
selection, and the shared unsaved-changes guard. The Node Builder previously
mutated the resolved library and local storage on every input.

Engine Node Builder now owns a detached session with the existing library's
definitions and order. Apply/Save persists first, then updates the existing
personal definitions and resolved library. Storage failure preserves the draft
and leaves canonical definitions unchanged. No second node database was added.
The existing Legacy mutation path remains unchanged.

## Controls and Model

`Is an SFP Cage` appears alongside connector properties in all four contexts:
reusable nodes, ordinary device connectors, card definitions, and installed-card
connectors. It derives its state from physical type, never the authored label.
It does not persist a redundant flag.

Families map to the existing `sfp-cage`, `sfp-plus-cage`, `sfp28-cage`, and
`qsfp-cage` types. The existing Installed Module control, catalogue, capability
validation, warnings, and captions are reused. A new conversion defaults to an
empty SFP cage. Family changes retain a valid module, including authored
capabilities and historical aliases, or clear an incompatible module.

Disabling opens an inline ordinary-type selector with Cancel. No physical change
is committed until the user explicitly chooses the replacement type. Confirmed
conversion clears stale module aliases. Cancel restores the checked cage view.

`connectorPhysicalTypePatch` returns only physical/module metadata.
`commitEditorConnectorConfiguration` applies it to an isolated template copy,
validates it, checks connected cables, then commits one editor history entry.
Installed cards write overrides to the existing source connector and slot.
No IDs, coordinates, anchors, slot ownership, or unrelated connectors are changed.
No second connector, hidden socket, wire, or internal route is created.

`nodeDefinitionConnectorPatch` materializes reusable defaults onto the connector
placed by the existing palette workflow. The personal definition retains its
stable library ID, label, provenance, and module defaults. The placed connector
uses the canonical physical type and owns a copy of its defaults, independent of
future library edits. Ordinary/card placement and collision algorithms are
unchanged. Preview uses actual defaults and no longer invents an LC/MPO module
for an empty cage.

## Compatibility and Protection

Physical identity remains separate from effective behavior. Existing Engine
helpers resolve LC fibre, Ethernet, SDI, and DAC, including media, single/multimode,
RX/TX direction, declared rates and host constraints. Known incompatibilities
remain rejected; unknown hardware/platform support remains explicitly unverified.
The checkbox does not authorize internal device routing.

DAC remains one physical cable with integrated ends, stable cable ID and length.
The existing shared derived caption remains `Installed Module` plus its compact
module name, with the existing zoom-dependent rules. Authored connector names
are not rewritten by checkbox or module edits.

Connected physical/module edits use the existing conservative disconnect-first
policy, including all anchors. The comparison now includes signal direction.
Rejected edits leave the draft, project cables, and history unchanged. Card
definition and installed-card paths use the same atomic guard.

The Node Builder uses the shared Save/Discard/Keep Editing/Escape confirmation,
before-unload protection and pending-upload tracking. Closing disposes its draft,
preview and module controls. Device/card editors retain their existing guard and
undo/redo paths. Factory definitions are not migrated or modified.

## Verification

Evidence root: `/tmp/wirenexus-sfp-capable-2026-10-21`.
Final production verification used an isolated checkout of the staged tree,
excluding protected Device JSON Import work and unrelated local assets.

- 15 new focused tests cover canonical families, empty defaults, SDI/fibre/DAC
  compatibility, historical metadata, personal defaults, one-node preview,
  geometry, connected direction comparison, and all three metadata transactions.
- Full Node suite: 1,725 passed, zero failures/skips. Includes SFP/DAC, device and
  modular placement, compatibility, personal definitions, unsaved guards,
  Multi-Core, Loom/Jump, history, Output Viewer, HTML and PDF tests.
- All 16 static validators passed. Output Viewer, PDF and XLSX bundles current
  and reproducible. Changed JS and the embedded app script passed syntax checks.
- `sfp-capability-acceptance.mjs`: 8 actual-Chrome checks covering detached personal
  creation, empty defaults, module installation, Keep/Discard/Escape, injected
  storage failure/recovery, page reload, portable Node JSON, native palette drag,
  explicit disabling/Cancel, unchanged geometry and saved ordinary conversion.
- `sfp-module-acceptance.mjs`: 37 checks. Ordinary/card creation now uses the actual
  checkbox and family selector. Includes installed-card family/module changes,
  connected conversion rejection, SDI rate/direction behavior, single-cable DAC
  creation, ID/length preservation, project download/reload, duplication, history,
  offline HTML, Output Viewer, schedule and actual PDF export/text inspection.
- `cage-picker-acceptance.mjs`: 10 checks covering historical factory flags,
  physical selectors/native drops, labels, persistence, history, offline HTML,
  Publish preparation and PDF export.
- `editor-unsaved-changes-smoke.mjs`: 12 checks covering editor transitions,
  validation/storage failure recovery, uploads, focus and mobile/light/dark
  confirmation layout, with canonical data preserved.

Screenshots inspected: `final-capability/personal-sfp-draft.png`,
`final-capability/personal-node-placed.png`,
`final-capability/explicit-ordinary-conversion.png`,
`final-sfp/card-installed-sdi.png`, `final-sfp/pdf-page.png`, and the offline HTML
module-caption screenshot in `final-cage`. The widened reusable-node property
row displays the complete module choice and wraps diagnostic information.

## Files and Delivery

Production: `index.html`, `src/engine/transceiverModules.js`,
`src/engine/nodePreview.js`, renderer/productionBridge build fingerprints,
and `src/engine/generated/outputViewerBundle.json`.

Tests: `test/sfpCapability.test.mjs`, `test/cagePicker.test.mjs`,
`test/deviceEditorUiPreview.test.mjs`, `test/sfp28.test.mjs`,
`scripts/sfp-capability-acceptance.mjs`, `scripts/sfp-module-acceptance.mjs`,
`scripts/node-preview-validation.mjs`, and the four existing build-fingerprint
validators (canvas-layout-objects, connector-operational-status, jump-node,
preview-ownership).

All 101 pre-existing protected files were hash-checked unchanged. The original
three `index.html` import hunks (49 added lines) and the 40 pre-existing additions
to `src/personalDefinitions.js` remain unstaged. Artwork, Masters, backups and
untracked import work were neither committed nor removed. No reset, stash or
clean was used. The delivery response records the final commit and verified
remote SHA. No deployment or release tag is part of this change.

## Limitations

Chrome acceptance used fresh headless profiles, not the user's browser or saved
projects. Some deterministic scene/card fixtures are seeded by the existing
acceptance harness; checkbox, module, placement, save and wiring interactions
use real UI controls. Publish preparation uses mocked private storage/API calls,
not a live hosted upload. Hardware/platform support is not certified by these
software tests. Connected module/type changes deliberately retain the existing
conservative disconnect-first policy, including some otherwise compatible edits.
