# Engine HTML and Publish outputs (54.32.0)

Export HTML and Publish both call `prepareEngineViewerOutput()` and
`buildEngineViewerHtml()`. The only geometry input is the immutable canonical
Stage 1 Engine scene. Both use the Stage 2 read-only `EngineOutputViewer`, the
existing SceneGraph, WebGL renderer, device visuals and wire logic. No editor
mutation commands, ProductionBridge, placement controller or project adapter
are shipped in the viewer bundle. Project normalization happens once in the app.

In Stage 3, PDF, reports in the editing app, live Engine rendering, saved projects
and Legacy editing were unchanged. Stage 4 now owns PDF drawing through
`engine-svg` (see `engine-pdf-output.md`). In Stage 3, app/module cache labels
advanced without renderer/bridge fingerprint changes. `fitCameraToBounds` moved to a small
shared camera module and remains re-exported from `enginePreview.js`, avoiding
an editor dependency in the output bundle.

## Bundle and offline resources

Run `npm ci`, then `npm run build:output-viewer`. esbuild is pinned to 0.25.12.
`scripts/build-output-viewer.mjs` creates the committed
`src/engine/generated/outputViewerBundle.json`: an IIFE, minified stylesheet,
embedded theme icons, input hash, content hash and module manifest. No timestamps
or absolute build paths enter the artifact. Commit it after changing any input.
`npm run check:output-viewer` builds twice, compares bytes with the artifact,
checks syntax and rejects editor dependencies/dynamic imports.

Each downloaded HTML contains the bundle, CSS, JSON scene, report data and all
required faceplate/LED/image/logo/PD-plug assets. Asset references are resolved
only in the viewer's detached visual data. Canonical geometry and its signature
remain byte-for-byte unchanged. A restrictive CSP disallows runtime networking,
external scripts and external image loading. There are no module imports or CDN
requests in the downloaded file, which runs directly from `file://` offline.
Missing assets fail generation explicitly; unsupported WebGL/image failures
produce a visible error rather than switching drawing owners.

Output diagnostics identify `projectDataSource`, `sceneDataSource`,
`drawingDependency: "engine-webgl"`, `sceneSignature`, `bundleHash`, and
`legacyFallback: false`. `window.engineOutputReady` resolves after initial assets
and rendering; `window.outputViewer.diagnostics()` exposes runtime metrics.

The historical `buildStandaloneHtml()` remains isolated for regression/reference
tests and old-SVG performance comparison. Neither current Export nor Publish
calls it. There is no Legacy output fallback flag and no silent fallback.
`viewer.html` still repairs old hosted SVG documents, but bypasses that repair
entirely for the explicit Engine HTML marker.

## Hosting and reports

Publish uploads the same HTML implementation plus the existing private project
JSON. The API/storage/password mechanism is unchanged. The existing password
page inserts the returned HTML into its unlocked iframe; no Legacy styles are
injected into Engine output. Different hosted titles do not change scene IDs,
geometry or signatures. Passwords are not embedded in the output HTML.

The Report dialog consumes the existing canonical report arrays: devices,
adapters, racks, LED screens, cable schedule and matrix routes. Cable schedule
entries select/highlight their matching cables. Fit, mouse/touch pan and zoom,
theme, inspector, device/wire/connector selection and cable tracing reuse the
read-only viewer. Compact toolbars fit 320px screens.

## Acceptance and performance

`test/outputViewerHtml.test.mjs` covers asset isolation, missing-asset failure,
safe JSON/HTML embedding, metadata, identical hosted/downloaded implementation,
and scene/endpoint/card/bus/PD parity. `scripts/engine-output-html-smoke.mjs`
executes the real Export function, saves the download and opens it in an offline
browser context. Legacy HTML/bounds functions are replaced with throwing guards
while exporting. It also runs Publish with simulated private uploads, exercises
wrong/right passwords through the real authentication page, and compares the
unlocked iframe with the download and live Engine GPU geometry.

The browser suite covers both app modes, complete canonical image-object input,
main/backup LED ordering, cards, buses, PDs, racks, jumps, matrix routes, reports,
playback, dark/light pixels and screenshots, 320/390px layouts, signatures and
console errors. `output-scene-smoke.mjs` now also checks deterministic Engine PDF SVG.
`output-viewer-smoke.mjs` retains touch/pinch, disposal, fit-padding, full fixture
and optional private real-project coverage. Logs/screenshots remain outside git.

Final validation: 29 focused output tests, all 712 Node tests, all 12 validation
scripts, inline/module syntax checks and `git diff --check` passed. All three
browser suites passed, including the available private-project case; none of
these cases was skipped.

Headless Chrome, 1600x1000, local warm server (2026-09-23):

| Offline fixture | Rehydrate ms | Initial render ms | Assets ready ms | Camera mean/P95 ms | Old SVG mean ms | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Representative | 7.7 | 73.6 | 118.2 | 2.1 / 2.5 | n/a | n/a |
| 100 devices / 300 wires | 28.1 | 168.6 | 202.9 | 11.6 / 14.3 | 80.8 | 7.0x |
| 400 devices / 1,200 wires | 92.2 | 728.9 | 912.7 | 41.4 / 50.6 | 370.2 | 8.9x |

Fit was 0.1-0.5ms. All cases used seven WebGL buffers; texture counts were
20/100/400. Camera loops rebuilt neither scenes nor textures. Measurements are
CPU camera/update/draw submission over 24 alternating pan/zoom frames, not GPU
completion or universal frame-rate guarantees. The reference SVG loop updates
its view and rebuilds visible SVG using the old viewer's own functions.
The 400-device case still exceeds a 60Hz frame budget and uses substantial
texture memory. HTML sizes were about 1.37/3.56/13.86 MB, dominated by scenes.

The existing private large project also passed the independent viewer smoke:
142 objects, 1,302 connectors, 267 wires, 129 textures, no failed assets,
approximately 79.5ms rehydration and 30.95ms mean draw submission. No private
data is checked in or sent to hosted storage during these tests.

Limitations: hosted storage/auth responses are simulated, not a production
Vercel deployment check. Mobile coverage is Chrome emulation, not physical
Safari/iOS/Android. WebGL2 is required. The existing shell's undo restore omits
imageObjects, so the full canonical image-object fixture is exercised separately
without changing saved-project behavior in this stage. Viewer texture quality
and low-zoom detail follow Stage 2; no renderer redesign was performed.
