# Read-only Engine output viewer (54.31.0)

Stage 2 introduced the independent viewer. Stage 3 now uses this same viewer for
Export HTML and Publish; see [Engine HTML outputs](engine-html-outputs.md).
PDF retains its existing drawing path.

## Ownership and API

`new EngineOutputViewer(host, snapshot)` accepts either a Stage 1 version-1
Engine scene or a canonical output wrapper containing `engineScene`. Load
`src/engine/outputViewer.css` alongside the module. `await viewer.ready` waits
for source images and the initial texture/render work. Call `viewer.dispose()`
before removing or replacing it.

`outputViewerModel.js` isolates and deeply freezes the JSON contract, then
rehydrates a SceneGraph. It never normalizes project data or reads a Legacy DOM.
The existing Engine renderer owns device textures, connector display layouts,
shared buses, card artwork, Power Distro artwork, matrix routes, cable hops,
LED endpoints, rack internals, comments, title blocks, images and jump nodes.
Jump links and cable playback use the contract's polylines. Existing jump signal
tracing is reused with endpoint identities derived exclusively from the scene.

Only camera state and selection sets change. The controller has no editing
commands, production bridge, placement controller or undo history. Static
geometry is uploaded once per mount. Pan, zoom, Fit, resize, theme and selection
do not rebuild the scene. Source-image completion may legitimately populate
the existing texture cache during initial loading.

The only renderer extension is an optional canvas background color. Its default
is unchanged, so live Engine rendering is unaffected. The renderer fingerprint
was bumped because its code changed; the bridge fingerprint was not.

## Harness and controls

Serve the repository over HTTP and open `/output-viewer.html`. The harness can
mount the representative fixture, a generated 100-device/300-wire fixture, or
an uploaded serialized Stage 1 scene. Fixture generation is deliberately outside
the viewer. `?empty=1` leaves mounting to the browser acceptance script.

- Drag with left/middle mouse or one finger to pan, including on nodes.
- Plain wheel pans; a modifier (Alt, Ctrl or Command) plus wheel zooms.
- Pinch zoom, +/- buttons, Fit and keyboard arrows/+/-/F are supported.
- Click a device, connector, wire, rack or jump link for read-only inspection.
- Inspector cable entries select cables; Play Cable follows existing jump
  continuity. Selecting a jump or jump link plays only its portal curve.
- Theme and inspector controls work on desktop and mobile. The inspector starts
  collapsed on narrow screens and opens as a bottom overlay.

## Validation and parity

`test/outputViewer.test.mjs` exercises JSON rehydration against the live Engine
adapter/SceneGraph for both repository fixtures. Exact comparisons cover devices,
connector anchors/world coordinates, endpoints, routes, hops, bounds, cards,
shared buses, matrix routes, rack exposure, jump curves and LED ordering.
Isolation, read-only inspection and semantic cable tracing are also covered.

`scripts/output-viewer-smoke.mjs` checks the browser renderer, actual pointer and
keyboard input, native touch pinch, mobile Fit padding, playback cleanup,
canvas pixels, dark/light screenshots, console errors and disposal. It compares
wire and matrix GPU arrays directly with the real production Engine. Camera and
selection loops assert zero full rebuilds, zero texture builds and stable buffers.

Run with an HTTP server on port 8768 (or `AVDESIGNER_BASE_URL`). Install Playwright
or set `AVDESIGNER_PLAYWRIGHT_PATH` to its module path. Optionally set
`AVDESIGNER_CHROME_PATH` and `AVDESIGNER_REAL_PROJECT_PATH`. Without the latter,
the private-project performance check explicitly reports a skip. No private
project, screenshots, logs or raw performance dumps are committed.

Validation on 2026-09-23: 8 focused tests, all 663 Node tests, all 11 validation
scripts, module/inline syntax checks, and Engine/Legacy output-scene browser
smoke passed. The latter confirms unchanged HTML/PDF drawing and offline viewer
behavior. All three viewer performance cases ran; no case was skipped.

## Measured performance

Headless local Chrome, 1600x1000 desktop and 390x844 mobile; warm local HTTP.
These are observations, not timing guarantees. Snapshot generation is measured
in Node; normalization is detached JSON/SceneGraph rehydration in the browser.
Initial render includes renderer construction, static upload, textures and Fit.
Texture-ready time is elapsed from renderer startup until image loading and two
animation frames complete, not a separate additive phase. Frame timings measure
CPU draw submission, not GPU completion. RAF P95 covers 30 camera/selection frames.

| Case | Snapshot ms | Normalize ms | Initial ms | Texture-ready ms | Fit ms | Draw mean/P95 ms | RAF P95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Representative | 103 | 10 | 135 | 178 | 0.3 | 2.7 / 5.6 | 17.4 |
| 100 devices / 300 wires | 293 | 32 | 180 | 259 | 0.1 | 11.5 / 14.6 | 18.4 |
| Large real project | 969 | 72 | 204 | 671 | 0.2 | 27.1 / 35.8 | 29.4 |

All cases used 7 WebGL buffers. Device texture counts were 22, 100 and 129,
respectively (including shared/asset-ready cache entries); estimated texture
memory was 40.5, 142.8 and 373.7 MB. Real-project glow textures added 5 entries.
All assets loaded successfully. No scene or texture rebuild occurred during the
measured camera/selection loops. The private real project normalized to 142
objects, 1,302 connectors, 267 wires, 26 cards, four LED surfaces and one jump link.

## Current limits

- Requires WebGL2. The development harness uses HTTP modules/assets; Stage 3
  downloads and hosted payloads embed the bundle and all required images.
- When generating an output, source URLs must be readable under browser CORS
  rules. Missing assets fail export explicitly. Runtime image decode failures
  are counted; readiness has a 15-second timeout.
- Light mode changes the canvas and viewer chrome, retaining Engine device
  artwork colors and the Engine's existing low-zoom label/detail behavior.
- Viewer-only textures use the existing low (2x) quality preset with about one
  million pixels per device. Tall artwork loses detail at extreme zoom; this
  trades texture memory for responsiveness without changing scene geometry.
- The large-project draw cost is above a 60 Hz frame budget; further renderer
  optimization is separate work. No claim of universal 60 fps is made.
- Browser acceptance used desktop Chrome with emulated mobile/touch input, not
  physical iOS/Android devices or Safari/Firefox.
