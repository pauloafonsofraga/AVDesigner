# Modular Placement Integration Hardening

Build 54.24.0. Baseline: `0409c221b708714670ba33f7e6d5b7abaf81faff` on `engine-prototype`.

## Reproduced Defects

Production changes followed failing behavioral tests or native Chrome gestures:

1. **Bus anchors above the modular origin.** Two/three-member groups were centered on their lane origin, giving negative first-member offsets. At start Y 100, a three-member bus moved to lane 0 produced Y `[82, 100, 118]`. It now produces `[100, 118, 136]`. A two-member bus changes from `[91, 109]` to `[100, 118]`. Spacing remains 18; spans remain one lane for two/three members and two lanes for four members. Secondary-anchor offsets are included in the lower bound.
2. **Dangling relationship members after deletion.** The explicit delete operation relied on normalization, which intentionally preserves ineligible relationships. Deleting `left-bus-3` left that ID in the relationship. Explicit deletion now prunes affected membership and refreshes the surviving composite geometry. The fixture retains members `left-bus-0/1/2` at Y `[208, 226, 244]`, lane 2, with span reduced from 2 to 1.
3. **Adapter-centre occupancy.** A centred input appeared as `connector:center` in the lane solver despite being a special docked item. It now contributes no modular item. Drag initialization uses the existing dock/detach path, so removing it from occupancy does not make it undraggable. Native detach/cancel restores its exact centre geometry.
4. **Dropped card-artwork ownership flag.** `projectAdapter` preserved `suppressCardAreasInTexture`, but `SceneGraph.normalizeVisualMetadata` discarded it. During a native drag the SVG card owner existed while the live scene still allowed baked card artwork. Scene normalization now retains the boolean. A focused test covers replace/settle and texture-key parity.

The solver, card-internal placement, renderer, production bridge, matrix routing and PD artwork/catalog were not changed. Only the app/module cache fingerprint and its four validation expectations were advanced.

## Deterministic Evidence

`fixtures/modular-integration.mjs` contains faceplate-side nodes, mixed tracks, a both-side node, 4/3-member buses, an ineligible mixed-side relationship, paired network nodes, an empty connector slot, input/output/I/O cards, overrides, an unused lane and manual height 1600. It also exports a separate adapter fixture. No developer-specific fixture path is needed.

Initial exact lane map (both Engine and Legacy):

```text
left-a=0 right-a=0
left-bus=2 right-bus=2
both=4 mixed-left=5 mixed-right=5 net-in=6 net-out=6 empty=7
input-slot=8 output-slot=8 io-slot=12 tail-left=17 tail-right=17
```

Default empty input/output append at lanes 18 and 19. After filling the existing empty slot and accepting one insertion boundary for `left-a`, both browser modes produce:

```text
left-bus=0 right-a=0 right-bus=1 left-a=2 both=3
mixed-left=4 mixed-right=4 net-in=5 net-out=5 empty=6
input-slot=7 output-slot=6 io-slot=11 tail-left=16 tail-right=16
new-input=17 new-output=17
```

The compatible new input/output share a row only after the explicit compact reorder. The manual height remains 1600. Full maps are also printed at deletion and reload checkpoints by the browser smoke script.

- 36 checked operations in the unit integration trace. The companion browser trace performs actual main-canvas insertion and offline export/reload rather than pretending the unit harness renders those surfaces.
- Ten exact repeat cycles for each of six operation families (60 measured cycles). One preliminary cycle establishes the compact fixed point because the fixture deliberately starts with a gap.
- 240 mixed operations: 80 each with seeds `0x542401`, `0x542402`, `0x542403`; failures print seed and operation trace.
- 12 normal gesture combinations: left/right/both at scales 0.035, 0.08, 0.2 and 1. These exercise production handlers in the unit harness; native browser gestures use the actual viewport Fit scale.
- The reusable helper checks occupancy, unique IDs, relationship membership, primary/relative anchors, bus reservations, generated card coordinates, immutable source cards, selection validity, idempotence, read-only rendering and height.

## Verification

All automated runs passed with no skipped tests:

| Run | Result |
| --- | --- |
| `node --test test/modularDeviceLayout.test.mjs` | 90 passed |
| `node --test test/sharedBusPlacement.test.mjs` | 10 passed |
| `node --test test/deviceEditorUiPreview.test.mjs` | 229 passed |
| `node --test test/*.test.mjs` | 427 passed, including 28 new Stage 4 tests |
| Every `scripts/*validation.mjs` separately | 11 passed |
| Classic inline script syntax | 1 parsed |
| `git diff --check` | Passed |

Chrome 153.0.8010.53, headless, macOS 26.5:

- New integration smoke: 32 checkpoints and 15 native drags per mode, including adapter detach/cancel. Actual pointer input covers ordinary, bus, card and faceplate movements, reversal and capture-loss cancellation. Inspector toggles use real UI events; structural fixture setup and persistence actions use application APIs.
- Existing append smoke: 7 native Add clicks and 32 native faceplate gestures per mode.
- Existing shared-bus smoke: 5 native bus gestures per mode plus default/reset, duplication, project reload, canvas and offline parity.
- Existing native-drop smoke: 68 drops, 34 inserted devices, 84 decoded artwork mappings and 16 alias mappings; 84 mappings each for preview, save, duplication and export.
- Both Engine and `?legacy=1` passed with no captured console errors/warnings in the integration smoke.

Sixteen screenshots were captured and inspected: idle, pre-boundary, accepted boundary, release, cancellation, reload, main canvas and offline viewer for both modes. Browser assertions check sampled mid-drag/settled ownership, transparent Engine hit geometry, rigid card-local coordinates, rigid bus offsets, absence of guides, frozen preview bounds and unchanged template JSON while dragging.

Main canvas, default/reset, duplication, project reload and offline export preserve IDs, connector/anchor coordinates, slot geometry, relationships and height. Empty authoring placeholders are intentionally absent from live Engine connector nodes; the source template and offline effective-connector list retain them.

## Limits and Recommendation

Placement and persistence are ready for controlled user acceptance testing, not unconditional visual sign-off.

- At low Fit zoom, Engine card node/label sizes visibly change when handing rendering to the SVG drag layer. Card-local coordinates and ownership remain correct. This existing visual-style difference was observed in screenshots and was not addressed by changing card internals or the renderer.
- Legacy/offline label styling is not pixel-identical to Engine. Geometry parity is verified; pixel-identical output is not claimed.
- No Safari, Firefox, Windows or hardware-input testing was performed. Native Chrome automation and sampled screenshots do not prove every animation frame on every GPU.

Screenshots/logs stay outside the repository. Existing untracked assets and backups are excluded from the commit.

## Changed Files

- `index.html`
- `src/engine/sharedBusPlacement.js`
- `src/engine/sceneGraph.js`
- `fixtures/modular-integration.mjs`
- `test/helpers/modularIntegrationAssertions.mjs`
- `test/deviceEditorUiPreview.test.mjs`
- `test/sharedBusPlacement.test.mjs`
- `scripts/device-editor-integration-smoke.mjs`
- `scripts/canvas-layout-objects-validation.mjs`
- `scripts/connector-operational-status-validation.mjs`
- `scripts/jump-node-validation.mjs`
- `scripts/preview-ownership-validation.mjs`
- `docs/modular-placement-integration-hardening.md`
