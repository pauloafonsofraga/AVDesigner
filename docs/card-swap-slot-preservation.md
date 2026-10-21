# Connected card safety and physical slot preservation

Prompt 1/8 implements Issues 11 and 3 only. Build 54.38.122.

## Transactions and ownership

Physical slots remain `cardSlots` records. Installed cards remain references to
`cardTypes`; connector IDs remain `slotId__localConnectorId`. No fake empty card,
replacement connectors, automatic cable conversion or positional remapping is used.

The user-facing palette drop calls `installCardInSlot`, then
`commitEditorStructuralEdit`. Card definition edits also use that structural
transaction. Its detached draft is validated before replacing editor contents or
recording editor history. `persistDeviceEditor` independently validates before
`pushUndo`, definition mutation, instance mutation or connection pruning.
`commitDeviceEditorApplyFromProduction` repeats the guard before SceneGraph/history
updates. `ProjectMutationAdapter` has no separate card installation transaction;
editor snapshot application is owned by the production bridge.

`assertEditorModularCardChanges` constructs the prospective instance/project-library
view without mutation, including other users of an owned project definition. Factory
definitions are never edited. Personal/library authoring without affected project
instances does not invent external connections.

`modularCardSafety.js` compares installed content by stable slot ID, resolves affected
ports through the Engine adapter, and checks every touching cable. It rejects missing
or ambiguous local IDs, missing anchors, changes to cable records, missing cards,
incompatible types/directions/status/fibre, and mutually exclusive occupied ports.
It reuses Engine compatibility, transceiver and DAC validators. Connected cage/module
changes retain the existing stricter disconnect-first policy. Paired Jump endpoints
use the existing signal-path resolver; Multi-Core constraints use its connectivity
validator, lazily and only at the transaction boundary. Unresolved remote hardware
and historical unspecified rates are warnings, not claims of verified compatibility.
Apply includes warnings in the status message. Missing essential types block safely.

Errors identify slot, card, connector and cable. Rejected UI drops leave draft,
canonical state, selection and both histories unchanged. Apply catches its diagnostic
and returns failure to the existing close/unsaved-changes lifecycle.

## Physical slot persistence

Optional `cardSlots[].physicalLayout` contains:

```json
{ "sideMask": "right", "span": 4 }
```

`sideMask` is `left`, `right` or `both`; `span` is the integer lane footprint (at
least two). Existing slot ID, y/placement and other compatibility metadata remain
on the same slot record. Dimensions use the existing chassis width and lane-height
rules. Renderer, preview, placement and normalized output read the same footprint.

There is no eager historical migration. Occupied historical slots without an
explicit footprint retain the existing solver's resizing/move-aside behavior during
replacement. Removing a card captures its current footprint. Explicit footprints
remain fixed across removal, save/reopen and reinsertion; cards must fit their side
and span. Initially empty historical slots can still accept their first card through
the existing solver. No neighboring slots are compacted during removal/deletion.

The selected minus control has an accessible label and tooltip: **Remove Card** for
an occupied slot; **Delete Card Slot** for an empty slot. Connected removal is blocked.
Calling slot deletion directly on an occupied slot is also blocked. Removing a card
clears its connector overrides and installed-port selection, selects the empty slot,
and updates the Inspector. Each accepted operation has independent draft undo/redo;
Apply remains one canonical Engine transaction. Legacy handlers retain their behavior.

## Verification on 2026-10-21

1. **VERIFIED PASS:** starting local HEAD was `29559bea4478422bc07e046946bf94e9b7feb2ab`.
2. **VERIFIED PASS:** fetched remote HEAD was the same on `origin/engine-prototype`.
3. **VERIFIED PASS:** initial 49-line index import integration, 40-line personal-definition change,
   artwork, Masters, backups and other untracked work were recorded and protected. Hashes of
   101 protected files other than the intentionally edited index remained identical.
4. **VERIFIED FAILURE, fixed:** before the guard, the real `persistDeviceEditor()` regression
   returned saved=true and changed canonical state after a connected SDI-to-HDMI swap.
5. **VERIFIED PASS:** existing card/slot ownership and transaction boundaries are described above.
6. **VERIFIED PASS:** shared guard runs in structural editing, Apply and bridge commit paths.
7. **VERIFIED PASS:** affected cables are identified from old installed slot/connector ownership.
8. **VERIFIED PASS:** same-ID type changes, ambiguity, anchor loss and rewritten cables reject.
9. **VERIFIED PASS:** independently compatible stable-ID replacements accept without cable edits.
10. **VERIFIED PASS:** rejected swaps identify the offending cable/connector/slot and keep the editor usable.
11. **VERIFIED PASS:** Remove Card preserves the empty slot; connected removal rejects.
12. **VERIFIED PASS:** Delete Card Slot requires an empty slot and is independently undoable.
13. **VERIFIED PASS:** empty-slot dimensions and neighboring slot positions remain exact.
14. **VERIFIED PASS:** historical normalization is read-only; old unbounded replacement behavior remains.
15. **VERIFIED PASS:** slots and installed connector identities survive removal/reinsertion.
16. **VERIFIED PASS:** draft remove/delete undo/redo and Engine compatible-swap undo/redo.
17. **VERIFIED PASS:** actual .avd downloads and file-input reopen, including removal undo after reopening.
18. **VERIFIED PASS:** stale installed-port selection clears; empty slot is identified in the Inspector.
19. **VERIFIED PASS:** normalized output geometry, Cable Schedule and Signal Chain records;
   exported HTML opened with network requests aborted; actual PDF download rendered and inspected.
   **NOT TESTED:** a live Publish upload, which would change hosted state; preparation shares the HTML path.
20. **VERIFIED PASS:** Chrome screenshots of occupied, empty, deleted, restored and offline-viewer states.
21. **VERIFIED PASS:** final isolated headless Chrome wall times: rejected native swaps 130-141 ms,
   removal plus empty render 64 ms, native reinsertion 108 ms, draft undo+redo 11 ms.
   These include automation overhead, not frame-time benchmarks. No pointer-move connectivity rebuild was added.
22. **VERIFIED PASS:** 26 focused tests cover the replacement matrix, SFP/DAC, fibre, ambiguity,
   Jump/Multi-Core, rollback, output/report parity, historical data and the actual bridge method.
23. **VERIFIED PASS:** full working-tree Node suite: 1,825 passed, zero failed/skipped.
   An isolated checkout of exactly the staged changes, without the protected import development,
   also passed all 1,805 tests and the real Chrome acceptance script.
24. **VERIFIED PASS:** all 16 `*-validation.mjs` scripts; inline syntax and `git diff --check`.
25. **VERIFIED PASS:** existing modular/Device Editor/card/SFP/DAC/personal/unsaved/Multi-Core/Loom/Jump/
   schedule/signal-chain/viewer/HTML/Publish/PDF Node coverage. Three old removal assertions now explicitly
   assert the new two-step ownership and exact geometry; replacement/move-aside assertions remain intact.
26. **VERIFIED PASS:** production scope is index editor handlers, `modularCardSafety.js`,
   `modularDeviceLayout.js`, `projectAdapter.js`, `productionBridge.js`, bootstrap exposure,
   fingerprints, generated viewer bundle, test fixtures/tests/browser acceptance and this document.
27. The user approved committing this scoped implementation with the independently reproduced
   baseline PDF failure classified as pre-existing. The final commit SHA is supplied in the delivery response.
28. The remote branch SHA is independently verified against local HEAD after the normal push.
29. Unrelated work is excluded by staging only scoped paths and reversing the original index-only
   import patch in Git's index, never in the working file; final protection checks accompany the commit.
30. **PRE-EXISTING ISSUE:** optional `engine-pdf-production-smoke.mjs` fails identically on the untouched
   starting commit and this tree: `installedModuleCapabilities(null)` while drawing Jump labels.
   It is not caused by card geometry. **KNOWN LIMITATION:** unknown remote hardware/rates are not verified.
   **NOT TESTED:** native macOS Save/Open dialogs (the real browser download/file-input paths were tested),
   authenticated personal-library persistence, and a manual pass through every historical user project.

## Pre-existing PDF smoke failure

Reproduction command (Node.js v24.4.1, repository dependencies installed):

```sh
node scripts/engine-pdf-production-smoke.mjs
```

This exits with status 1 both on the isolated, untouched starting commit
`29559bea4478422bc07e046946bf94e9b7feb2ab` and on the Prompt 1/8 implementation.
The identical stack trace, with checkout-specific prefixes omitted, is:

```text
TypeError: Cannot read properties of null (reading 'installedModule')
    at installedModuleCapabilities (src/engine/transceiverModules.js:69:28)
    at installedModuleDetailsForEngine (src/engine/connectorCompatibility.js:362:19)
    at engineConnectorFiberMode (src/engine/connectorCompatibility.js:514:19)
    at jumpInfoFromLocal (src/engine/jumpNodeModel.js:787:16)
    at jumpNodeConnectionInfo (src/engine/jumpNodeModel.js:405:12)
    at SceneGraph.jumpNodeConnectionInfo (src/engine/sceneGraph.js:237:12)
    at drawJumpNodeInfoBox (src/engine/renderer.js:4822:13)
    at src/engine/renderer.js:3793:33
    at Array.forEach (<anonymous>)
    at drawEngineOutputLabels (src/engine/renderer.js:3791:17)
```

Impact: this additional PDF Jump-navigation smoke run cannot complete because rendering
a Jump label passes a null connector into module/fibre metadata lookup. PDF scenes
that reach that same null-connector path may fail during label rendering. This is
not evidence that every PDF export fails: the focused card/empty-slot PDF export
passes, downloads, and renders correctly. Prompt 1/8 does not modify PDF production
code, the failing smoke script, or its assertions. The renderer change is solely its
build fingerprint. This failure is **PRE-EXISTING**, not a card-safety regression.

## Reproduction and artifacts

Run `node --test test/*.test.mjs`, `node scripts/card-safety-browser-smoke.mjs`
(default server `http://127.0.0.1:8773`; override `AVDESIGNER_BASE_URL`), every
`scripts/*-validation.mjs`, and the three package bundle checks. The browser test
uses a disposable Chrome profile, does not edit user projects or settings, and closes
the browser on completion/failure.

Logs, protection manifests, screenshots, native saved fixtures, offline HTML and PDF
are under `/tmp/wirenexus-card-safety-2026-10-21/` on the validation machine. Key images:
`occupied.png`, `empty.png`, `deleted.png`, `restored-empty.png`,
`empty-slot-offline-viewer.png`, `empty-slot-pdf.png`.

No production deployment, release tag or Prompt 2 implementation is part of this change.
