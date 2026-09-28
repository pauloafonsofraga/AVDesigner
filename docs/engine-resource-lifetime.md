# Engine Resource Lifetime

Build: 54.38.0 - Engine Resource Lifetime

Starting commit: `3639b9662a76855eae07acce8a4257322a450244` (54.37.0).
Engine is now the only application renderer. Old mode URLs still open Engine;
failure retains the project for retry instead of initializing another renderer.

## Ownership Audit

- Deleted the old main SVG construction, device/wire/LED/jump/area/comment/title/
  rack render loops, previous WebGL wire renderer, hidden canvas layers, device
  SVG texture captures, navigation snapshots, deferred detail timers, and their
  renderer-specific pointer, camera, selection, and playback handlers.
- Deleted alternate Device Editor, Rack Builder, and Title Block production SVG
  previews, the secondary PD faceplate preview, their dead helpers and counters.
- Retained the project adapter and mutation bridge, one authoritative shell
  project model, reports, clipboard/default/library persistence, and inspectors.
- Retained Cards-tab SVG authoring schematics, crop tools, connector/slot/plug
  hit targets, drag/resize/marquee overlays and pure authored-placement helpers.
  They are editing tools, not a second production renderer. Shared metadata and
  geometry helpers are retained by callers, not removed based on their names.
- HTML/Publish still use the generated Engine viewer bundle. PDF still consumes
  the canonical Engine scene through the vector SVG print backend. No output
  schema or project schema changes; originals and embedded definitions remain.

## Resource Policy

`TextureCache` defaults to a **256 MiB per-renderer RGBA texture budget**.
This estimates width * height * 4, not browser RAM or driver allocation. Separate
editor preview surfaces own separate budgets. Decoded image sources, buffers,
browser backing surfaces, project data and history are not included.

Textures have explicit consumer counts. Replacing, deleting, or loading a new
scene releases unused records immediately; shared records survive until their
last consumer releases them. Decoded image sources are shared across renderer
owners and released when no live scene references them. Failed GPU uploads,
temporary raster canvases, and disposed caches release their owned resources.

Scene preparation registers ownership without eagerly baking every texture.
Visible devices use power-of-two screen-demand tiers up to the selected quality.
Fit can use small textures; close zoom rebuilds detailed artwork. The visible
working set gets a conservative total-area budget, then least-recently-used
offscreen records are evicted as necessary. Panning into empty space must not
fall back to preparing every device. Ordinary camera changes within a demand
tier reuse textures and never rebuild the static scene.

Asset strings are hashed once into compact stable identities, memoized while
referenced, and excluded from texture keys. Image bytes are not rehashed every
frame. Source revisions invalidate the visual without retaining old records.

LED preparation reads PNG dimensions from the header without decoding the full
image. Existing bounded previews are reused. Oversized new images use async
`createImageBitmap` resize and `convertToBlob`/`toBlob` encoding (4096 maximum
side, 8 million preview pixels). Cancellation checks bracket async work; bitmap,
canvas and object-URL resources are released in success and failure paths.
Original image bytes and pixel dimensions remain authoritative for saved data,
Use Image Size, and output quality.

New Project explicitly replaces the Engine scene as well as the shell state,
releasing the preceding project's textures. Superseded asynchronous project
loads cannot overwrite the newer project after their preparation completes.

## Measurement Method

The private supplied project was exercised locally and is not committed. It has
80 devices with embedded definitions, 229 connections, 57 Jump Nodes, 19 Jump
Links, and two LED surfaces with 90 resolved endpoints. Tests check those exact
endpoints, image bytes, definitions, import/replacement, deletion, undo/redo and
three complete reload cycles. The committed LED fixture is synthetic.

Pre-Stage-1 endpoint evaluation took 198,831 ms with 1,111,232 connector lookups
and 3,333,696 metadata normalizations. Stage 1 and this release resolve the same
90 endpoints in about 0.2 ms with no additional lookups/normalizations.

The Stage 1 settled texture cache retained 99 texture records for 82 entries,
estimated at 1,788,196,496 bytes (1.67 GiB). The new Fit working set retained
51 shared records for 82 entries, 3,062,592 bytes (2.92 MiB), with no missing or
fallback textures. Three settled lifecycle cycles returned to identical counts
and bytes. Detail is rebuilt on zoom-in, so these are Fit figures, not a universal
memory maximum. Browser JS-heap samples fluctuate with GC; no claim of exact
Chrome/GPU RAM reduction or zero overall memory growth is made.

On this Mac, Stage 1 loaded the private project in 457.1 ms (414.2 ms to first
frame, 219 ms buffer preparation). This release measured 316 ms (261.7 ms first
frame, 34.5 ms buffer preparation). Thirty settled pan samples averaged 30.4 ms,
maximum 36.1 ms, with zero full scene rebuilds. Four load/settling long tasks
remained: 266, 149, 79 and 81 ms. Loading is not entirely off the main thread,
and these results are not a promise of 60 fps on every project or machine.

The private read-only viewer measured 38.3 ms mean / 119 ms p95 navigation,
with 7 buffers, 51 textures and no failed assets. The 400-device HTML fixture
measured 42.3 ms mean navigation against its recorded 350.7 ms SVG baseline
(8.3 times faster); no retired SVG renderer is executed for that comparison.

## Verification

Unit tests cover consumer lifetime, repeated scene replacement, budget eviction,
lazy detail tiers, shared decoded sources, compact keys, and asynchronous preview
cleanup. Browser tests use throwing retired-renderer tripwires, verify removed
DOM layers, Engine retry, old URL flags, history and lifecycle stability.

Engine-only browser suites cover Device Editor cards, rigid buses, faceplates,
PD palette/artwork, adapter thumbnails, relationship fields, Jump gestures and
playback, wire previews, matrix routing, LED ordering, offline HTML, simulated
hosted authentication, and real vector PDF generation. No fake Legacy test
iterations remain in those browser suites. Historical performance fixture data
is retained only as a recorded comparison, not a runnable renderer.

Release results:

- Full Node suite: 904 passed, 0 failed, 0 skipped.
- All 13 validation scripts, bundle reproducibility, inline/app-module syntax
  checks, and `git diff --check` passed.
- Private project lifecycle: 12 passed, 0 failed, 0 skipped; synthetic project
  lifecycle: 12 passed, 0 failed, 0 skipped.
- Shared-bus browser cases: all 6 left/right two-, three-, four-member cases
  passed, including motion, canvas, offline output and card authoring.
- Defaults browser checks include an empty scene/cache after New Project.
- Eight generated PDFs passed structural inspection, including the 11-page
  report; drawing and report pages were rasterized and visually inspected.
- Chrome's real PDF viewer completed 12 offline reciprocal Jump Node clicks
  across strict/bidirectional, wide/tall and cross-page fixtures.
- Dark/light HTML and private LED close-ups were visually inspected. The
  supplied first wall's already-stored checkerboard preview is preserved;
  this resource-lifetime change does not regenerate or repair saved artwork.

Limitations: headless Chrome on this Mac and mobile emulation, not physical
mobile devices or Safari/Firefox. Hosted checks simulate storage/authentication;
they do not publish private client projects. PDF navigation was tested in Chrome,
not other native PDF readers. Exact browser/GPU memory is not measured by texture
estimates. Asynchronous decoding uses browser facilities;
underlying decoder work may finish before cancellation can release its bitmap.
