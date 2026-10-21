# Prompt 2/8: Jump Copy and Safe Node Replacement

Build: 54.38.124. Scope is limited to Jump clipboard isolation and stable-ID
Device/Card Editor node replacement. No Prompt 3 work, deployment, or release tag.

## Baseline and isolation

Starting local HEAD and fetched `origin/engine-prototype` both resolved to
`a4bd45c858142ca9930874470c3ca25575c7850f`. This includes factory additions newer
than the requested baseline; they are retained.

The starting tree contained unfinished Device JSON Import work: 49 added lines in
`index.html`, 40 in `src/personalDefinitions.js`, and untracked implementation,
tests and documentation. Artwork, faceplates, Masters and backups were also
untracked. A SHA-256 manifest of all 101 protected files and a separate original
index patch were captured under `/tmp/wirenexus-prompt2/`. They are excluded from
this commit. No reset, stash or clean was used. Staging the shell explicitly
subtracts the original import patch; its unstaged content is compared afterwards.

## Architecture and confirmed regressions

- `src/engine/canvasClipboard.js`: `createCanvasClipboardPayload` collects the
  supported selected objects and internal wires; `prepareCanvasClipboardPaste`
  validates data, resolves definition collisions and allocates stable IDs;
  `applyCanvasClipboardPlan` supplies the existing reversible paste operation.
- Before the fix, selecting both members copied their Jump link and created a
  new paired continuation. A failing regression reproduced this. Single-Jump
  copying was not claimed as newly broken.
- `index.html`: `resolveEditorPaletteDrop`, `fillEditorSlotById` and
  `editorDropPointCreatesAdapterNode` own ordinary palette drops. Card drops use
  `data-card-preview-node` and `fillCardConnector`, a separate handler. The
  actual ordinary resolver rejected occupied targets with `filled-slot`; a VM
  regression exercised that existing function before implementation.
- `commitEditorStructuralEdit`, `resolveEditorModularLayout`, existing anchor
  projection and editor history remain the only placement/transaction machinery.
  `src/engine/modularCardSafety.js` is extended, not replaced.

## Jump clipboard contract

Jumps are serialized as presentation-only objects. Both collection and the paste
boundary (including historical clipboard payloads) strip pair IDs, Jump links,
attached-device bindings and all ownership fields. All wires touching a copied
Jump are excluded. Only `id`, position, label/name, color/style and label colors
are retained. No original topology is mutated.

Mixed selections preserve supported ordinary objects and wires whose two ends
are not Jumps. Selecting a wire alongside a Jump does not restore that Jump's
topology. Looms/Multi-Cores are not supported clipboard object collections and
are not duplicated; their selected gateways become ordinary empty Jumps.

The existing cross-object ID allocator assigns fresh IDs on every paste. Relative
placement is retained. The existing paste command remains one undo operation;
redo restores the same new identities. Project save and output preparation use
these already-detached canonical objects, not a separate export workaround.

## Replacement contract

`src/engine/nodeReplacement.js` provides a pure proposed-definition transaction:

- Preserve connector ID, authored coordinates, side/face, stable anchors,
  direction/placement and applicable captions, custom names, colors and notes.
- Adopt the incoming canonical physical/connector type, declared compatibility,
  rates, fibre/module capabilities and operational state. Explicit signal family
  is carried into the capability schema used by Engine validation and outputs.
- Preserve a custom label when it differs from the old library label/type;
  otherwise adopt the new library label. `nameText`/custom-name flags survive.
- Do not spread historical module aliases into the replacement. SFP definitions
  use `nodeDefinitionConnectorPatch`; no module is installed unless authored in
  the incoming definition. Invalid authored modules are rejected.
- Card definitions retain local connector IDs and slot IDs. Installed slot
  overrides retain presentation/placement only; stale typed overrides cannot
  mask the incoming connector type.

`editorNodeReplacementCandidate` reuses editor coordinate conversion and projected
anchors. The nearest circle within ten screen pixels wins deterministically,
independent of preview zoom. Occupied-node replacement precedes insertion. A
near-miss on a card label cannot fall through to the old unsafe filled-node handler.
Empty slots retain their fill path; empty device/card area uses existing insertion.

Preview shows incoming color with a green/red target and Replace/Cannot replace.
Validation is cached only during hover; commit recalculates it. Preview mutates no
project or draft and creates no history. Cancellation removes the overlay.

The proposed copy is normalized before history capture, then compared for stable
target coordinates/anchors, modular reservations and card-node positions. A
footprint change is rejected rather than silently moving neighboring content.

## Relationships and cable safety

Raw relationship validation runs before normalization can prune anything.
Exclusive memberships can retain valid mixed connector types. Through/mirrored
members must remain compatible. Direction changes within relationships, invalid
references, unsupported relationships, invalid network/LED membership and active
matrix signal changes reject with an explanation.

`assertSafeConnectorChanges` opts into ordinary-connector checks while retaining
Prompt 1's default installed-card behavior. Every changed connected occurrence
must resolve its original connector/slot/anchor ID unambiguously. Existing cable
objects and endpoints must be identical. Engine compatibility, exclusive use,
SFP state, operational status, declared rates/fibre/families, real Jump continuation,
Multi-Core and DAC checks are reused. Connected cage/module conversion rejects.
Unverifiable explicit physical constraints reject; undeclared rates or unresolved
remote gateway hardware produce explicit unverified warnings, not a claim of
verified hardware equivalence.

Both drop and Save/Apply validate before canonical mutation. Rejection leaves
draft, relationships, selection and history intact. Success commits once through
the established draft-history and unsaved-changes lifecycle.

## Verification

**VERIFIED PASS** on the isolated staged implementation, excluding personal import:

- `node --test test/*.test.mjs`: 1,827 passed, zero failures/skips/cancellations.
  Includes clipboard, Jump, Loom, Multi-Core, cards, compatibility, relationships,
  SFP/DAC, personal definitions, unsaved changes, schedule, signal-chain and output
  coverage. New tests live in `jumpClipboardIsolation.test.mjs` and
  `nodeReplacement.test.mjs`.
- All 16 `scripts/*-validation.mjs` static validators.
- Output Viewer bundle reproducibility; PDF and XLSX bundle `--check` commands.
- Source syntax and `git diff --check`.
- Native Chrome replacement/rejection drags, ordinary and card stable identities,
  exact undo/redo, preserved wires, cancellation outside the editor, empty-space
  insertion, Save/reopen, Keep Editing, Escape close guard and Discard Changes.
- Native single and paired Jump copy/paste shortcuts, distinct new IDs,
  original pair/wires unchanged, undo/redo, and actual project save/reload.
- Native connected Loom and Multi-Core gateway copies retain original ownership,
  circuits, geometry and cables; copies are independent. Exclusive replacement
  retains membership; incompatible shared/mirrored bus replacement is rejected
  without dirtying the draft.
- Offline exported HTML opens with networking disabled; only the original Jump
  pair remains. Hosted-viewer preparation preserves types and attachments.
- Focused vector PDF download and raster inspection show the replacement and
  retained cable correctly. Existing card-safety Chrome/PDF smoke also passes.

Browser harness: `scripts/jump-node-replacement-smoke.mjs`, using Chrome and a
local static server. Fixtures are seeded through the normal snapshot API; palette
drags, clipboard shortcuts, save and export are browser interactions. Jump
selection is established through the Engine selection API, not manual marquee.
Screenshots/logs and downloaded `.avd`, HTML and PDF evidence are in
`/tmp/wirenexus-prompt2/` (ephemeral, intentionally not committed).

**KNOWN LIMITATION / NOT TESTED:** no live hosted Publish, no exhaustive native
Chrome pass over every historical personal-library definition, and no separate
native duplication/personal-save scenario for the new replacement transaction.
Those existing paths have repository-suite coverage but are not claimed as new
end-to-end acceptance. The larger existing `canvas-clipboard-smoke.mjs` did not
complete in this run and is not counted as passed; its assertions were updated
only for the approved empty-copy contract. Focused native clipboard acceptance
and the repository clipboard tests pass.

## Pre-existing Jump label failure

**PRE-EXISTING ISSUE / VERIFIED FAILURE:** reproduced independently on untouched
`a4bd45c858142ca9930874470c3ca25575c7850f` and this isolated implementation:

```sh
node scripts/engine-pdf-production-smoke.mjs
```

Both fail with the same stack (checkout prefix omitted):

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

An empty Loom gateway fixture also fails before copy in main-canvas label rendering
on both baseline and current build. Its stack reaches `jumpNodeConnectionInfo:400`
and `WebglGraphRenderer.drawLabels:1499` instead of output labels. A one-ended
ordinary Jump pair hit that stack in the working tree as well. This is not evidence
that all Jump/PDF scenes fail. No PDF production code or failing smoke assertion
was modified. The renderer diff is its fingerprint only.

The focused harness retains this failing fixture behind an explicit switch:

```sh
AVDESIGNER_INCLUDE_KNOWN_LOOM_FAILURE=1 node scripts/jump-node-replacement-smoke.mjs
```

**NOT TESTED:** complete native copy acceptance for that empty Loom case and PDF
scenes that cannot render because of the existing null-connector bug. The pure
clipboard tests cover ownership stripping independently of rendering.

## Changed surfaces and handoff

Production changes: Engine clipboard, the new replacement planner, modular safety,
bootstrap API wiring, and Engine-only editor drop/preview/save handling in the
shell. Existing Legacy behavior is retained. Build/cache fingerprints and the
generated viewer bundle are refreshed. Tests and the focused browser harness are
updated alongside this report. No catalogue definitions, artwork, PDF navigation,
Loom routing or Multi-Core topology are rewritten.

The final commit/verified remote SHA are returned in the delivery message after
push. Prompt 3/8 remains unstarted.
