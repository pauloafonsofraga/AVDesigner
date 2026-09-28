# Engine-only LED loading, Stage 1

Baseline: `115212fd3774c0aefcd363af32530b2cb9c6d7d1` (54.36.13).
Release: **54.37.0 - Engine-Only LED Project Loading**.

## Runtime boundary

Engine is now the only main-canvas runtime. Retired `legacy=1`, `engine=0`
and `engine=false` flags cannot activate the hidden SVG renderer. The mode
switch and Legacy error fallback are removed. Retry retains project state;
an initialization retry uses a fresh entry-module URL and releases failed GPU
resources. Unrelated debug parameters and Device Editor previews are retained.

`renderShellUi()` updates the library selection list, inspector, legend,
history controls and status without drawing a scene. File load builds the
Engine once. PNG import/replacement uses existing targeted Engine commands
and command history. Fit and deferred detail callbacks cannot build Legacy
geometry. Retired drawing implementations remain unreachable for Stage 2
source cleanup; they are not a supported alternate runtime.

## LED ordering

The project adapter resolves source connectors from normalized device indexes
and builds surface ordering once. Comparators read scalar sort keys only.
Existing processor metadata (or first-appearance ranks when absent) establishes
initial order; saved per-connection surface indexes take precedence. Missing
indexes append after explicit indexes, including gaps.

SceneGraph caches ordered wires and ID-to-rank maps per surface. Add, remove,
rewire, wire-state/history application and full index rebuild invalidate the
affected caches. Device/relationship replacement rebuilds the indexes.
Connector text/signal edits do not reorder explicit per-wire landings.
Endpoints use current surface geometry and cached ranks, without connector
resolution, metadata normalization or project scans. Save and shell history
snapshots preserve those resolved indexes without mutating the source snapshot.

Original PNG bytes, preview bytes, logical dimensions and original pixel
dimensions are unchanged. No factory migration or project version bump.

## Measurements

Measured locally in headless macOS Chrome against the owner's complete private
project. No private project, source artwork or screenshots are committed.

| Operation | Baseline | Engine-only sample |
| --- | ---: | ---: |
| Resolve all 90 LED endpoints | 198,831 ms | 0.3 ms |
| Endpoint connector lookups | 1,111,232 | 0 |
| Endpoint metadata normalizations | 3,333,696 | 0 |
| Hidden SVG scene builds on load and deferred idle | active | 0 |
| Engine scene/index builds per file load | not measured | 1 |

All 90 world coordinates exactly match the baseline, including the second
wall's initially absent processor-order metadata. Times are observations, not
absolute regression thresholds; deterministic count assertions guard the fix.

Representative complete load: **456.9 ms** until synchronous load completion.
Breakdown: JSON parse 12.4 ms, saved-preview preparation 0 ms, shell 120.9 ms,
Engine normalization 53.8 ms, scene/index build 18.7 ms, initial GPU/texture
buffer preparation 170.1 ms. First Engine frame was ready in 396.4 ms from its
load start; these clocks overlap and should not be added to total load time.
Deferred work was observed for five seconds. The two recorded post-open long
tasks were 471 ms and 69 ms, not a recurring multi-minute endpoint loop.

First-PNG import: 143.8 ms into the connected project, 123.5 ms into the
device-only project, 108.3 ms into an empty project. Second-PNG empty import:
3.3 ms. First-PNG decode was 4-5.4 ms; bounded preview preparation accounted
for most of the remaining import time. PNG resolution policy is unchanged.

Remaining cost: renderer texture-cache diagnostics estimate **1.67 GiB** for
the complete project (99 textures). Large modular device textures, including
a 1520 x 12528 texture, remain expensive. This is a separate GPU/memory concern,
not the confirmed Legacy endpoint-normalization freeze. No lower-quality
device or PNG textures were introduced to hide that cost. Cold network loads,
other GPUs, native file-picker performance and deployed Vercel timings can differ.

## Acceptance and reproduction

`fixtures/led-project-loading.mjs` is a shareable 80-device / 229-wire workload
with full connector metadata, shared buses, modular cards, multiple processors,
82- and 8-connection walls, embedded synthetic PNGs and 57 Jump Nodes.

`scripts/led-project-loading-smoke.mjs` uses native file-input and download UI
paths, actual Engine rendering, mouse/keyboard interaction and instrumentation
of the production connector metadata API. It covers complete load, downloaded
save/reload, LED wire selection/deletion/history, import/replacement/history,
device-only plus PNG, empty plus both PNGs, Fit/zoom/pan, deferred callbacks,
load retry and failed module-initialization retry. The intentional module-fetch
failure is isolated from the normal zero-console-error run. Deployment-only
`/api/build-info` is stubbed for the local static server, not project loading.

Set `AVDESIGNER_REAL_PROJECT_PATH` to a private file to run the same browser
checks against it; otherwise the synthetic fixture is used. Optional
`AVDESIGNER_BASELINE_PATH` compares all coordinates with an externally recorded
baseline `{points:[{id,point}]}`. `AVDESIGNER_PLAYWRIGHT_PATH`,
`AVDESIGNER_CHROME_PATH`, `AVDESIGNER_BASE_URL` and `AVDESIGNER_SCREENSHOT_DIR`
allow local runtime configuration. Metrics and screenshots stay outside Git.

The private-file checks preserve 80 instance template overrides, all 170
library entries, 58 node definitions, 229 cables, 57 Jump Nodes and both LED
images. Full normalized connector metadata, card/device visuals, relationships,
Jump Links and every LED endpoint are compared through save/reload.

Validation: 898 Node tests, 13 validation scripts, inline/module syntax checks,
bundle reproducibility and diff whitespace checks. Browser regressions cover
LED landing order/export, Device Editor integration (64 checkpoints), offline
HTML, simulated hosted authentication and vector PDF. Old `?legacy=1` browser
cases now run Engine; they are not evidence of a retained Legacy runtime.
Ten generated PDFs also pass structural inspection, including reciprocal Jump
destinations, pagination and unchanged vector paint streams. No real hosted
deployment or native OS file-dialog performance claim is made.
