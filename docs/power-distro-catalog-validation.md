# Power Distro Catalog Parity - 54.21.0

Stage 2 starts from `9e08ccd848a793629b08c486aae8d34481b58171` on
`engine-prototype`. Validation was run on 2026-09-22.

## Corrections

- A missing optional face-Y override was coerced from `null` to zero. Manual
  plugs therefore inflated Engine/Legacy faceplate height, while the standalone
  viewer used the actual face Y. All three now use the same frame.
- Manual plugs advanced automatic column and PowerLock cursors even though the
  automatic height calculation excluded them. Mixed fixtures could put artwork
  outside the faceplate. Manual placements now consume no automatic stack row.
- Removing a Power Distro plug could change the modular origin without
  authorizing the existing atomic rebase, aborting deletion. The removal
  transaction now authorizes that rebase only when the origin changes.
- Placement motion suppressed texture refresh, but final refresh covered only
  card artwork. Native PowerLock drops exposed an empty, stale faceplate. Power
  Distro motion completion now refreshes the committed texture once.

The native drag lifecycle, stable candidate logic, modular solver, renderer,
production bridge, assets and unrelated UI were not rewritten. Only application
build/cache identifiers and four validators' application-build expectations were
bumped. Renderer and bridge fingerprints are unchanged.

## Registry and Assets

The classic inline application and ES-module registry copies are retained.
Converting their ownership would unnecessarily affect Legacy startup and the
self-contained viewer. Exact parity tests guard every key, input/output file,
order, size, width/height, PowerLock flag, alias and palette visibility. The
standalone viewer embeds the application's registry. Its 29 embedded SVG assets
are byte-identical to the repository files; IEC's relative PNG is fetched and
embedded by the existing export path.

Every row below passed both input and output tests, including exact-case file
existence, browser decoding, positive dimensions, identity and geometry parity.

| Type | Palette | Input | Output |
| --- | --- | --- | --- |
| iec | Visible | Pass | Pass |
| nema | Visible | Pass | Pass |
| uk-13a | Visible | Pass | Pass |
| schuko | Visible | Pass | Pass |
| powercon | Visible | Pass | Pass |
| powercon-true1 | Visible | Pass | Pass |
| 16a-1ph-110v | Visible | Pass | Pass |
| 16a-1ph | Visible | Pass | Pass |
| 16a-cee | Hidden alias of 16a-1ph | Pass | Pass |
| 32a-1ph-110v | Visible | Pass | Pass |
| 32a-1ph | Visible | Pass | Pass |
| 32a-cee | Hidden alias of 32a-1ph | Pass | Pass |
| 16a-3ph | Visible | Pass | Pass |
| 32a-3ph | Visible | Pass | Pass |
| 63a-3ph | Visible | Pass | Pass |
| 63a-cee | Hidden alias of 63a-3ph | Pass | Pass |
| 125a-3ph | Visible | Pass | Pass |
| 125a-cee | Hidden alias of 125a-3ph | Pass | Pass |
| socapex | Visible | Pass | Pass |
| harting | Visible | Pass | Pass |
| powerlock | Visible | Pass | Pass |

Aliases keep their saved type IDs. Palette DOM checks verify the 17 canonical
choices exactly once and preserve the existing saved node ordering. Harting is
111 x 27; PowerLock is 300 x 44. No artwork was replaced.

## Coverage and Results

- 68 real Chrome HTML5 drags: 17 canonical types x 2 directions x 2 modes.
  Each new Power Distro starts with both empty slots. Stable IDs, one committed
  drop, selection, labels, anchors, counts and non-adapter behavior are checked.
- 34 resulting devices inserted using the respective production Engine/Legacy
  insertion APIs. Those insertion calls are not described as native drags.
- 42 catalog entries x 2 modes = 84 entries checked independently in the main
  canvas and reopened Device Editor. Engine checks observe actual decoded image
  draws into textures; Legacy checks rendered SVG hrefs and dimensions.
- 84 entries saved/reloaded, 84 duplicated, and 84 rendered/decoded in generated
  offline standalone viewers. Offline viewers block HTTP(S) requests and assert
  none occur. IDs, types, direction, connector data, art, and face extents agree.
- The 16 alias/direction/mode cases are included in those fixture totals, not
  counted as native palette drags. Aliases are absent from the palette.
- Small and full-catalog fixtures, mixed circular/CEE/Harting/PowerLock stacks,
  manual normal and PowerLock overrides, ordinary nodes below the faceplate,
  minimal automatic height, column centers, containment, no unintended overlaps,
  repeated normalization, type changes in both size directions, and deletion
  rebasing are covered. Source definitions remain unchanged.
- The corrected PowerLock preview was also inspected in a Chrome screenshot.

| Command | Result |
| --- | --- |
| `node --test test/powerDistroCatalog.test.mjs` | 48 passed |
| `node --test test/deviceEditor*.test.mjs` | 142 passed |
| `node --test test/*.test.mjs` | 309 passed |
| `node scripts/canvas-layout-objects-validation.mjs` | Passed |
| `node scripts/connector-operational-status-validation.mjs` | Passed |
| `node scripts/engine-compatibility-validation.mjs` | 21 cases passed |
| `node scripts/engine-preview-validation.mjs` | 7 fixtures passed |
| `node scripts/engine-real-project-validation.mjs` | 551 checks passed; includes all 42 catalog mappings |
| `node scripts/engine-rewire-validation.mjs` | Passed |
| `node scripts/jump-node-validation.mjs` | Passed |
| `node scripts/node-preview-validation.mjs` | Passed |
| `node scripts/preview-ownership-validation.mjs` | Passed |
| `node scripts/rack-preview-validation.mjs` | Passed |
| `node scripts/title-block-preview-validation.mjs` | Passed |
| `node scripts/device-editor-native-drop-smoke.mjs` | 68 native drops plus fixture checks above |
| Inline classic script compiled with `node:vm` | 1 script passed |
| `git diff --check` | Passed |

No acceptance cases skipped. The smoke test uses `AVDESIGNER_BASE_URL` (default
`http://localhost:8767`), with optional `AVDESIGNER_PLAYWRIGHT_PATH` and
`AVDESIGNER_CHROME_PATH` overrides. Its generated fixture is repository-owned;
no developer project file or absolute artwork path is required.

The browser run uses desktop Chrome on macOS in Engine and `?legacy=1` modes.
Other browsers and operating systems were not tested in this pass. Intentional
manual overlap remains governed by the existing editor collision feedback;
this stage does not repack user-authored manual positions.
