# Engine Vector PDF Output (54.33.0)

## Jump navigation (54.34.2)

The static PDF backend no longer emits the virtual portal mesh. Jump rings,
endpoint labels and all physical wires still use unchanged Engine primitives.
Canonical `jumpLinks`, scene schema/signature, HTML/Publish viewer code and the
54.34.1 transient hover/selection/playback behavior are unchanged.

Each paired node has one invisible `fill="none"`, `stroke="none"` SVG link over
its complete Engine logical bounds (44 x 44, not the 17.6-unit visible ring).
Code-point-encoded stable node IDs name reciprocal fragment destinations without
punctuation collisions. Unpaired or missing endpoints do not generate links.
Chromium's native PDF writer creates `/Subtype /Link` annotations with internal
`/Dest` references to named `/XYZ` destinations, with zoom 0 (retain reader zoom).
No URI, application dependency, PDF JavaScript or post-processing is required.
FitR is not exposed by this browser print path; XYZ is the supported fallback.

Chromium excludes CSS `@page` margins when recording named SVG destinations,
although its annotation rectangles include them. The drawing therefore uses a
named zero-page-margin page with the same 4 mm physical margins in frame layout.
Its height changes from page-content-height minus 2 mm to full-page-height minus
10 mm; frame padding, border, SVG meet/letterboxing and report-table margins are
retained. The native print layout maps both links and destinations, including
target pages, without estimated screen coordinates or a second layout solver.

Print-only diagnostics add `jumpNodes`, `jumpLinks`, `jumpDestinations`,
`jumpAnnotations` and `visibleJumpLinkPaths` (always zero). These do not enter
the canonical signature. Annotation counts describe intended print annotations;
the structural inspector separately verifies those actually written by Chrome.

`fixtures/output-pdf-jumps.mjs` has two separated strict/bidirectional pairs,
four physical wires and an unpaired node. The browser smoke emits wide and tall
drawing PDFs, a repeated PDF, and a two-drawing-page imposition test. Cross-page
imposition is test-only; production drawing pagination is not added here.
`inspect-engine-output-pdf.py` verifies every real annotation and reciprocal
destination against the printed SVG graphics transform, including positive hit
rectangles, page references and XYZ zoom retention. It permits Chromium's
two-stage whole-CSS-pixel destination rounding (at most 1.5 PDF points), not an
unaccounted page-margin offset. Repeat drawing/report streams and annotations
must be identical. A verified coordinate manifest is written only to the test
artifact directory for the real Chrome PDF viewer click test:

```sh
node scripts/engine-output-pdf-navigation-smoke.mjs <generated-pdf-directory>
```

Acceptance: 730 Node tests and 13 validation scripts pass. Ten actual PDFs are
inspected, including a no-navigation control whose paint streams must be byte
identical to the linked PDF. Poppler inspection covers wide/tall jumps, the full
parity drawing and report tables. Chrome PDFium passes 12 actual offline clicks
at 300% zoom: strict and bidirectional A -> B -> A for wide, tall and cross-page
fixtures. The Engine/Legacy scene and PDF smokes, output viewer, and offline
HTML/simulated-hosted smokes pass; HTML portals remain hidden at rest. The
optional private real-project viewer performance case is skipped when no
`AVDESIGNER_REAL_PROJECT_PATH` is supplied; synthetic 100/300 and 400/1200 cases
pass. Acrobat, Preview, Firefox and Safari PDF interaction are not verified.

## Ownership

`exportPdfReport()` builds the canonical snapshot with `drawingDependency:
"engine-svg"`, then calls `buildEnginePrintDrawing()`. `wirechartSvgMarkup()` and
its `canvas.cloneNode(true)` implementation have been removed. No Legacy bounds,
SVG nodes, selection, hover, debug layers, or editing state enter the drawing.
The existing printable report builder still owns drawing, devices, adapters,
racks, LED screens, cable schedule and matrix sections, in that order.

`src/engine/outputSvgRenderer.js` accepts the resolved Stage 1 contract, image
descriptors and scalar font widths. It returns SVG plus diagnostics without
touching the DOM, changing the contract, or running the project adapter again.
`createOutputViewerModel()` rehydrates the same detached SceneGraph used by the
HTML/Publish viewer. Scene IDs, geometry, bounds and signature remain unchanged.

This is an SVG backend, not a parallel layout implementation:

- `OutputSvgContext` records the existing `drawDeviceVisual()` drawing commands.
  Body/card/faceplate/PD, adapter wires, comments, title blocks and images retain
  the Engine artwork geometry. Original image descriptors replace the live
  browser image cache for this backend only.
- `engineOutputPrimitives()` shares committed wire widths, cable color segments,
  connector markers, operational-status marks, matrix routes, rack frames,
  through/multi-anchor relationships and jump rings/links with the live renderer.
  GPU triangles become SVG vector paths, not rasterized WebGL output.
- Wires consume canonical hop-adjusted polylines. Sampled Bezier paths match
  Engine segments exactly rather than fitting another curve. Shared-bus trunks,
  branches and stems consume the contract directly and share Engine stroke tokens.
- Labels and fields use Engine's read-only label routines at logical zoom 1.
  They have dark print text/light halos; neutral device artwork is print-light.
  Signal colors, card colors, faceplates, PNGs and plug artwork are retained.

Bounds in diagnostics are exactly the canonical geometry bounds. The print
viewBox adds 24 logical units of padding and includes outward Engine label
extents, without changing positions or the canonical signature. A white
background is the default; the pure serializer also supports transparent output.

The browser first embeds image originals and records font measurements as scalar
inputs using an otherwise empty 2D canvas. It never captures any rendered canvas.
The serializer is byte-deterministic for the same scene, images and font metrics.
Its headless fallback font widths are approximate; production export always
supplies browser measurements. Missing assets fail explicitly in the report window.

## Verification

`fixtures/output-print.mjs` extends the shared output parity fixture with repeated
installed-card shared buses and a card through relationship. Coverage includes
17 objects, 59 logical connectors, 20 wires, four cards, four shared buses, PD
plugs, matrix, main/backup LED wiring with repeated indexes, PNG wall/image,
adapter, rack exposure/internal wire, jump link, comment, title and area.

Run:

```sh
node --test test/outputSvgRenderer.test.mjs test/outputSceneSnapshot.test.mjs
node scripts/engine-output-pdf-smoke.mjs
python3 scripts/inspect-engine-output-pdf.py <directory-printed-by-smoke>
pdftoppm -png -r 110 <directory>/engine-full.pdf /tmp/engine-print
```

The browser harness accepts `AVDESIGNER_BASE_URL`, `AVDESIGNER_PLAYWRIGHT_PATH`
and `AVDESIGNER_CHROME_PATH`. The optional PDF content inspector requires `pypdf`;
Poppler renders pages for visual inspection. Test artifacts stay in a temporary
directory, not the repository. Chrome's real PDF writer is used, not a mocked
print API. Only `window.print()`'s interactive dialog is suppressed.

The harness exercises the real export entry point in Engine and Legacy modes
with throwing guards on Legacy clone/bounds access. PDF wire and matrix primitive
buffers match live GPU buffers exactly after Float32 conversion. The complete
canonical fixture has the same scene signature as the common HTML/Publish builder.
It also generates a 100-device/300-unique-cable report and checks every table row
appears exactly once. Table print rules allow pagination, repeat headers, keep
rows intact and avoid stranded headings. SVG images are decoded before capture;
XML parsing, repeated byte output and console errors are checked.

Acceptance on 2026-09-23: 42 focused tests, all 723 Node tests, all 12 validation
scripts (including viewer bundle reproducibility), inline/module syntax and
`git diff --check` passed. Engine/Legacy PDF and scene browser smokes passed;
offline HTML and simulated hosted authentication also passed, including the
100/300 and 400/1200 viewer performance cases. No required automated test was skipped.
The two-page representative and eleven-page large PDFs were rasterized with
Poppler and visually inspected. The representative drawing contains 33,148 PDF
path operators and 3,197 text operators; the large drawing contains 401,163 path
operators. The PDF inspector confirms all 100 device rows and 300 distinct cable
rows appear exactly once, with no empty or title-only pages.

## Limits

- Browser print engines and installed fonts can differ. Acceptance uses desktop
  Chrome; physical printers, Safari and Firefox are not claimed as tested.
- Image objects retain their original image resolution. All generated shapes,
  connector/wire geometry and text remain vector; this is not an image-to-vector
  conversion of supplied artwork.
- A large scene still fits one drawing page, so labels can be physically small.
  They remain sharp when zoomed or printed on larger paper. Tiled poster printing
  is not added. Very large matrix grids retain the existing table layout limits.
- The existing undo restore omits `imageObjects`. The smoke tests the full
  canonical 17-object input separately without changing saved-project behavior.
- Stage 5 removed the unused output SVG helpers; the supported Legacy canvas
  remains. Current acceptance is recorded in `engine-output-pipeline.md`.
- Shared renderer exports required a renderer cache fingerprint and regenerated
  offline viewer bundle. The production bridge fingerprint is unchanged.
