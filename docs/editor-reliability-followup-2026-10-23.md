# Device Editor Reliability Follow-Up

Build 54.38.140, based on `7497ef614cff9c4dd933895f386a7303ac05a18d`.

## Changes

1. Installed card geometry no longer caps node content at a stale `editingBounds.height`. Content determines the minimum vertical footprint/reservation; saved slot metadata remains unchanged. Replacement eligibility still checks the authored physical reservation, not the expanded derived value. Existing cards that fit retain their geometry.
2. Engine placement release no longer retains historical excess `height` when the calculated content extent is unchanged. Existing `manualHeight` remains an explicit authored minimum, not something that can safely be inferred away. The Device tab's Auto Height checkbox clears that minimum only on request; turning it off records the current height. Card Editor Fit now includes new nodes outside an older saved editing rectangle.
3. Factory removal stores optional `hiddenFactoryDeviceIds` in the existing personal registry's preferences, preserving favorites/order and account-owner boundaries. It filters the user's library, never the immutable catalogue or project definitions. Confirmation precedes removal. Restore Removed restores hidden entries. Other preference saves retain visibility preferences.
4. Card kind changes prompt only when populated nodes would be removed. Proceed/Cancel uses the existing modal confirmation and structural transaction/history. Cancel and stale asynchronous approvals leave the draft untouched. Empty cards change immediately.
5. Card node drag/insertion uses the existing compact modular authoring insertion solver and placement motion module. Shared buses remain rigid. A faded insertion node previews the committed ordering. A stable native-drop surface avoids replacing Chrome's active drop target as SVG neighbors animate; empty-slot filling and occupied-node replacement remain separate paths. Preview/cancel does not mutate saved definitions.
6. Clipboard collection retains all wires whose endpoints are inside the copied selection, including Device-Jump and Jump-Device legs. The existing remapper handles device/Jump/wire identities and port references. External wires are excluded. Jump presentation is still detached before serialization, removing cyclic ownership data, Loom/Multi-Core associations and external attachment state. A Jump copied alone remains empty/unpaired.
7. The green PCB strip in Connectors now has native list reordering with a faded icon/name drag image, animated neighbors and insertion outline. Drop reorders `cardTypes` only, through stable IDs and editor history. Cancel restores DOM order without a model/history mutation. Installed slot assignments, geometry, connectors and cables are not reordered.

## Verification

- Focused regressions cover card grow/shrink and margins, saved physical metadata, canonical SVG/output consistency, historical editing bounds/Fit, dense/shared-bus insertion, PCB ordering, durable personal hide/restore, complete Jump-chain copy/remapping/undo/redo/reopen, automatic/manual device heights, and empty/populated/stale card-type confirmations.
- `scripts/editor-reliability-followup-smoke.mjs` exercises actual Chrome interactions in the Connectors PCB strip on a factory E2 Gen2, cancellation, project save/reopen, factory hiding across refresh/project reopen and restoration, card type confirmations, installed card growth, node dragging, native palette insertion and preview/commit agreement, and personal-library save/reopen.
- The browser pass also checks an existing MCTRL660 Pro's historical manual minimum, explicit Auto Height, grow/shrink through node edits, and unchanged artwork/slots/remaining node coordinates after saving and reopening.
- Source artwork and factory catalogue are not edited. Protected artwork, backups, Masters and the original uncommitted Device JSON Import work remain excluded.
- Isolated scoped tree: all 1,938 Node tests passed, zero failures/skips; all 16 static validators and all three generated-bundle checks passed. The protected uncommitted import tests are not part of this count.
- All seven Chrome acceptance groups passed with zero browser errors, including the actual clipboard copy/paste pipeline with an external cable excluded, unchanged originals, one-step undo/redo and real `.avd` save/reopen.
- An E2 plus an expanded-card project exported to standalone HTML and opened with network disabled. The installed card's exported height was 549 (old editing height 180), with every port and its caption clearance inside the card boundary. Sample editor/PCB/preview/offline-viewer screenshots were inspected.
- Production PDF export of that saved project succeeded (149,989 bytes), with no browser errors and no changes to the source project.
- All 101 protected-path hashes remained unchanged. The original 49-line `index.html` and 40-line `src/personalDefinitions.js` uncommitted import patches remain unstaged and excluded. No artwork, faceplates, backups, Masters or factory definitions were changed.

No deployment or release tag is included.
