# Paired device editing

Paired master/library definitions share an Editing selector in Device Editor.
Switching flushes pending fields and retains both detached drafts, dependencies,
and editor history. It does not reopen the editor or alter placed canvas devices.
Canvas instances still use definition-level pairing; no new relationship schema
or automatic instance pairing is introduced.

Unpair Devices asks for confirmation and clears reciprocal pairing metadata in
one undoable edit. Historical one-way references are supported. Both definitions,
connector IDs, artwork, and existing project connections are retained. A partner's
unrelated link to a third definition is not removed. Both members remain available
in the selector until the editing session ends.

Save to My Library / Save as My Default saves both edited pair members in one
existing registry transaction, with independent revision checks. A stale partner
or storage failure rejects the whole write. Discard Unsaved Changes restores both
session baselines; closing retains the existing Save/Discard/Keep Editing guard.
Project-scoped copies remap their pairing references to the copied definitions,
not back to the master definitions. Existing instances are never replaced.

## Verification

- `node --test test/*.test.mjs`: 2,602 passing tests.
- All 16 existing validation scripts pass.
- `scripts/paired-device-editor-smoke.mjs`: real Chrome selection, pending edits,
  canceled/confirmed unpair, Undo/Redo, pair discard, close guard, atomic library
  save/reload, artwork/connector preservation, unchanged connected instances,
  and 1600/1024/390px selector layouts.
- `scripts/cards-tab-placement-smoke.mjs`: existing card placement and persistence
  workflows pass unchanged.

## Placed Devices

The same selector lists matching placed devices by name and stable instance ID,
using declared definition IDs and existing factory provenance, not proximity or
cable wiring. Multiple instances of one definition have independent drafts,
names, node dependencies and baselines. Switching does not apply edits.

When multiple placed partners match, select the intended one before Unpair
Devices. Only the opening device and explicitly selected partner are unpaired;
other candidates and library definitions are retained. Unpair supports shared
editor Undo/Redo across visited devices. Both devices must exist and be unlocked.

Save Project Device and close-dialog Save validate all dirty visited drafts
before mutation and commit one existing Engine transaction and project Undo
entry. Shared project templates are isolated when necessary to avoid overwriting
another instance. Missing/locked devices, changed source definitions, invalid
connectors and canceled cable-removal confirmation prevent a partial save.
An application failure restores the project snapshot and history. Unrelated
recoverable cable records are not cleaned up. Discard restores all visited drafts.

`scripts/paired-canvas-editor-smoke.mjs` verifies a projector and two extenders
sharing a definition, independent switching, chosen-pair unpairing, editor and
project Undo/Redo, close Save/Discard/Keep, connector/cable preservation, and `.avd`
save/reopen. These checks are local and do not contact hosted account services.

## Existing limitation

The full-catalogue Save Changes to Project Devices path validates every catalogue
definition and currently rejects a missing connector label in Generic QSFP
Breakout Lab. That validation path and catalogue defect predate this change and
are not changed here. The project-copy browser check isolates the two synthetic
definitions to verify reciprocal copy IDs without bypassing validation. The
personal-library save/reload checks use the complete catalogue and pass.

No deployment, hosted data, permissions, or infrastructure changes are required.
