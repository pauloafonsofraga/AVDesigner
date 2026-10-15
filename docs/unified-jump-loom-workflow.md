# Unified Jump / Loom workflow

## Baselines and passes

- Reviewed/fetched start: `e226b85249b303657269e3ddb53f605d87f473f2`, build 54.38.91.
- Pass A: `06e576a4792f4c6c7c3db3d4edf310d2fe687efa`, build 54.38.92, committed and pushed before Pass B.
- Pass B starts at Pass A and uses build 54.38.93, Unified Jump and Loom Routing.
- No Legacy implementation, factory artwork, user data, or unrelated untracked files changed.

## Pass A: independent pairs

`jumpLinks[].deviceIndependent: true` records pairs created with a cable-free endpoint.
The existing output/input identity fields remain stable; actual electrical roles derive
from attached cables, not from the order in which empty nodes were paired. Existing
directed pairs retain their validation. Adding a cable still checks the peer's real
connector type, direction and fiber compatibility. Empty pairs create no cables.

All center dots use the same Engine primitive in the editor and output:

| Pair | Local device cable | Center dot |
| --- | --- | --- |
| No | No | None |
| No | Yes | Red |
| Yes | No | Purple |
| Yes | Yes | Normal connected presentation |

No J1/J2 labels are drawn inside bodies. The same rules apply to existing ordinary
Jump Nodes. Pair removal has an explicit inspector action using the Engine command.

## Pass B: visual routing association

An optional Loom-owned relationship stores routing, not electrical topology:

```json
{
  "jumpRouting": {
    "usageMode": "loom",
    "entryJumpId": "jump-a",
    "exitJumpId": "jump-b",
    "entryAnchorId": "lrp-2",
    "continuationComplete": false
  }
}
```

`entryAnchorId` references a stable route anchor. The exit ID is reconciled from the
actual Jump pair, never trusted as independent ownership. The entry anchor resolves
at the current Jump center. Existing `splitLoomRouteAtAttachment` produces
`visibleTrunkSections`; `plan.trunk` remains canonical authored geometry. No segment
is drawn across the teleport gap. Orthogonal and Bezier routing share this path.

Single-clicking a compatible Jump commits the first section. An existing pair
immediately resumes the same Loom at its partner. Without a pair, drawing ends
cleanly and Side B is hidden. Pairing later exposes a simple-click continuation
and an inspector action without activating a global tool. Completing continuation
keeps the same Loom identity and real Side A/Side B endpoints.

The body is 2.4 times the ordinary Jump diameter, without moving stored centers.
Hover uses a 140 ms transient ease and fixed center-based tolerance with hysteresis.
Ordinary-cable ownership, another Loom, or dedicated Portal ownership is rejected.
Imported conflicting associations detach visually, preserving cables; the reconciliation
helper also returns diagnostics for validation callers.

Unpairing retains authored continuation but shows only the first section. Re-pairing
resolves it again. Deleting the exit leaves a waiting Loom; deleting the entry
detaches the association and preserves an ordinary valid Loom. Undo restores the
node, pair and association together. Deleting/dissolving the Loom preserves cables
and releases the Jump association. Existing `loom.portalPairs` remain supported and
are mutually exclusive with `jumpRouting` on a Loom.

Drag previews reuse a gesture-cached cable composition. Only geometry is recomputed
for changed pointer offsets; drop records one movement command. Cable records,
IDs, endpoints, types, lengths, numbers, membership, schedule rows and Signal Chain
are not replaced by synthetic Jump endpoints or per-conductor Jump Links.

## Verification

- Pass A full Node: 1,286 passed, 0 failed, 0 skipped.
- Final full Node: 1,292 passed, 0 failed, 0 skipped.
- Real Chrome unified acceptance covers both drawing orders, hover, save/reopen of
  waiting/completed state, moving both Jumps, undo/redo, unpair/re-pair, deleting
  either Jump, deleting/dissolving a Loom, member preservation, offline HTML and
  normal production PDF downloads. No page errors.
- Existing Jump hold, glow, scoped compatibility, persistence, cable selection,
  alignment and attachment browser checks pass.
- Existing Loom Portal, Loom tool/Jump and managed Loom stability checks pass.
  The stability harness now waits for bridge readiness after restore; assertions
  were not removed or weakened.
- Output Viewer and offline/simulated-hosted HTML smoke pass, including 100/400
  devices and no permanent virtual Jump wire. This is not a live hosted deployment test.
- Engine vector PDF smoke and Python inspection pass all 7 generated cases,
  including pagination/report and deterministic repeat checks.
- Production PDF generation and inspection: 23 passed, 0 failed; internal navigation,
  report pages and padded XYZ destinations retained. Both new Loom PDFs have two
  internal `/GoTo` `/XYZ` links. Rendered PDF and editor/viewer screenshots inspected.
- Output Viewer bundle is reproducible/current; PDF and Cable Schedule bundles are
  current. JavaScript syntax and `git diff --check` pass. Schema fingerprint remains
  `engine-output-v4-add9df00` and contract tests pass.

Two existing checks remain failed, with assertions preserved:

1. `canvas-layout-objects-validation.mjs:298` expects an old literal project-load
   snapshot expression; the existing implementation includes `useEngineRoot: false`.
2. `bidirectional-jump-smoke.mjs:106` compares raw cable records after JSON reload:
   absent `manualRouteStyle` differs from an explicitly `undefined` property. Pairing,
   navigation and actual playback checks before that assertion pass.

Existing validator/browser matrix: **18 passed, 2 failed, 0 skipped** (final reruns):

| Script (under `scripts/`, `.mjs`) | Result |
| --- | --- |
| jump-node-validation | Pass |
| connector-operational-status-validation | Pass |
| preview-ownership-validation | Pass |
| canvas-layout-objects-validation | Fail, above |
| output-pipeline-validation | Pass |
| jump-node-hold-smoke | Pass |
| bidirectional-jump-smoke | Fail, above |
| jump-node-glow-browser-smoke | Pass |
| jump-scoped-connector-browser-smoke | Pass |
| loom-portal-browser-smoke | Pass |
| managed-loom-stability-smoke | Pass after readiness synchronization |
| loom-tool-jump-browser-smoke | Pass |
| output-viewer-smoke | Pass |
| engine-output-html-smoke | Pass |
| engine-output-pdf-smoke | Pass |
| jump-link-persistence-smoke | Pass |
| jump-cable-selection-smoke | Pass |
| jump-node-alignment-smoke | Pass |
| jump-attachment-browser-smoke | Pass |
| engine-pdf-browser-smoke | Pass |

Additional checks: unified browser acceptance passes both workflows and all three
stress sizes; production PDF inspection is 23/0; vector PDF inspection is 7/0;
three generated bundle checks pass. No automated checks were skipped. Manual
viewer availability is noted below rather than counted as an automated pass.

## Performance and evidence

The unified Chrome smoke tests 8, 32 and 64 member circuits. A representative run
measured mean drag geometry at 0.11 / 0.15 / 0.16 ms respectively, with pointer update
maxima at 0.10 / 0.20 / 0.10 ms. All three sizes record zero per-pointer-frame
composition, canonical Loom geometry, wire-index or full-renderer rebuilds during
drag, continuation and hover. A drop rebuilds canonical geometry/index once, with
two existing renderer buffer updates; no per-frame regrouping occurs.

Local evidence is under `/tmp/wirenexus-unified-jump-loom/`: paired and later-paired
editor/hover/offline-viewer PNGs, plus both production PDFs and a rendered PDF PNG.
Full Node log: `/tmp/wirenexus-pass-b-final.tap`. Other smoke logs use
`/tmp/wirenexus-<script-name>.log`; the readiness-corrected stability run uses the
`-rerun.log` suffix. Re-run the committed unified smoke to regenerate evidence.

Chrome was tested through the installed Google Chrome binary. Acrobat, macOS
Preview, Safari and physical mobile viewers were not manually tested in this pass.
