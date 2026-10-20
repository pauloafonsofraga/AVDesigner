# SFP Cage Picker Availability

Build 54.38.117. Starting local and fetched origin/engine-prototype:
`1fae60c8689c5d94398ce7e55bf75589ac63c06b`.
The newer Device Brand Headers work is preserved.

## Reproduction

Real Chrome, factory VX 2+ (`custom-device-vx3-copy`), nodes `input-slot-6`
and `input-slot-7`: both canonical and physical type are `qsfp-cage`, direction
is bidirectional and installedModuleType is empty. The actual Inspector offers
Empty / No module, LC Single Mode, LC Multimode, MPO Fiber and QSFP DAC.
This matches the reported list. Excluding SFP SDI from these QSFP cages is
correct. No user project or screenshot was attached to this request, so an
independently modified personal VX 2+ definition cannot be identified here.

Fresh factory editor lists already contained all four cages, but appended them
at the bottom of the long connector list. `orderedDeviceEditorNodeEntries()`
also required `editorPalette === true` for the non-cable cage definitions.
Historical/scoped records with that flag missing or false therefore disappear
at this boundary. Project import fills a missing flag from factory defaults,
but an explicit false flag survives and reproduces the hidden-picker problem.
The browser regression imports such a portable project through the file input.

## Correction

Engine cage availability now follows its existing canonical cage vocabulary,
independently of saved palette flags. No saved node definition is rewritten.
The four cages appear first in the editor palette and in a dedicated
SFP / QSFP Cages optgroup in Physical Connector. The physical selector uses
canonical factory cage captions even if a scoped label says Ethernet.
Existing normal node creation, dragging, placement and module mutation paths
are unchanged. The Legacy path retains its previous flags, ordering and markup.

`transceiverModuleSelectHtml()` remains the one module control shared by
ordinary nodes, card definitions, installed-card connectors and the canvas
Inspector. It adds physical cage, effective connector and media to the
existing rate/direction/module details. Multi-selection remains deliberately
single-cage-only for module editing, now with an explicit limitation message.

`transceiverModuleOptionsForConnector()` in `src/engine/transceiverModules.js`
remains authoritative and unchanged. Options still intersect node direction,
form factor, supported rates and any explicit host capability restrictions:

| Cage | SDI Receiver / Transmitter profiles | Other existing choices |
| --- | --- | --- |
| SFP | Unspecified rate, 3G | LC single/multimode, RJ45 |
| SFP+ | Unspecified rate, 3G, 6G, 12G | LC, RJ45, SFP+ DAC |
| SFP28 | Unspecified rate, 3G, 6G, 12G | LC, RJ45, SFP28 DAC |
| QSFP | None | LC, MPO, QSFP DAC |

All cages also offer Empty / No module. Input nodes expose receivers; output
nodes expose transmitters; bidirectional nodes can offer both. Unspecified-rate
SDI does not imply 12G support. No hardware interoperability policy changed.

## Preservation

Module edits still patch the existing connector, not its canonical cage type,
ID, position, anchors or slot identity. Empty cages remain selectable and
inactive. Existing connected-cable disconnect-first guards, alias support,
personal saves, project persistence, duplication and history are unchanged.
Dirty/Keep Editing/Discard Changes/Save Changes use the existing shared editor
lifecycle; no new saving implementation is added.

## Verification

`test/cagePicker.test.mjs` executes the actual shell picker/Inspector functions,
including obsolete flags, missing records, custom labels, form/rate/direction
filtering, ordinary/card multi-selection and exact factory VX 2+ choices.
`scripts/cage-picker-acceptance.mjs` exercises actual Chrome UI creation of all
four cages, SDI 12G Receiver installation, personal save/reopen, Keep/Save and
Discard, historical records and downloaded project Save/reload. Native select
controls are temporarily expanded only to capture their complete options in
headless screenshots; installation and selection use real UI interactions.

Existing SFP acceptance covers LC/RJ45/DAC, SDI compatibility, removal,
duplication, installed cards, undo/redo, connected guards and portable outputs.
The shared unsaved-editor regression covers failed saves and escape routes.
Final isolated staged-tree results:

- 1,694/1,694 Node tests passed, none skipped.
- 16/16 static validators and all three generated-bundle checks passed.
- Chrome 155: five grouped picker workflows, 35 existing SFP checks and 12
  shared unsaved-editor checks passed, with no uncaught browser errors.
- Inspected cage-selector, SDI choices/details, saved/reopened receiver, QSFP
  filtering, installed-card module and both production PDF-page screenshots.
- The existing SFP runner's optional PDF text check initially lacked system
  pypdf; the same assertions passed separately with the bundled Python runtime.
- JavaScript/classic-shell syntax, isolated/staged source parity and whitespace
  checks passed. Protected files and original import hunks remain unchanged.

Evidence: `/tmp/wirenexus-cage-picker-2026-10-20/`. Actual hosted deployment,
other browser engines and physical transceiver interoperability were not tested.

## Changed Files

- index.html: Engine-only picker and shared Inspector presentation; build/cache.
- src/engine/productionBridge.js, renderer.js: build fingerprints only.
- src/engine/generated/outputViewerBundle.json: regenerated fingerprint bundle.
- Four existing canvas-layout, connector-status, Jump and preview-ownership
  validators: current build fingerprints only.
- test/cagePicker.test.mjs, scripts/cage-picker-acceptance.mjs and this document.

Unfinished Device JSON Import work, personalDefinitions.js, artwork, faceplates,
Masters and backups are excluded. No deployment or release tag.
