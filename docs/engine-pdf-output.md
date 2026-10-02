# Engine PDF output

## Production workflow

The normal **Export PDF** command opens WireNexus paper, orientation, margin and
scale options, then downloads one self-contained vector PDF. `index.html` builds
the canonical Engine snapshot and SVG; `src/engine/outputPdf.js` uses PDFKit and
SVG-to-PDFKit to print that drawing and the report. The browser bundle is built
with `npm run build:pdf` and checked with `npm run check:pdf`. No print dialog,
second download, Legacy SVG clone or editor mutation is involved.

The report includes Devices, Adapters / Breakouts, Racks, LED Screens, Cable
Schedule and Matrix Routing. Small matrices include a crosspoint grid and route
table; large ones use a summary and route table. Drawing artwork remains vector
where authored as vector, with inline image artwork preserved. HTML and Publish
continue to use the separate read-only Engine viewer.

`exportChromiumPdfReport()` is retained only for developer comparison. It is not
the normal toolbar action. The Chromium reference uses `window.print()` and
does not define production Jump navigation behavior.

## Jump navigation

`outputNavigation.js` extracts reciprocal valid Jump pairs and stable IDs from
the canonical Engine scene. The printable SVG retains Jump rings, labels and
physical wires but omits the virtual Jump Link path. `outputPdfLayout.js` maps
Engine bounds to drawing-page PDF coordinates. Each source annotation exactly
covers its logical Jump hit rectangle and has an internal GoTo action to the
paired drawing page. Unpaired and invalid nodes get no link.

Every target has a standard named `/FitR` destination: a rectangle 40% of the
printable page area in each dimension, centred on the target when possible and
clamped to that page's printable bounds. FitR parameters are `[left, bottom,
right, top]`; the top-origin rectangle `(x, y, width, height)` becomes
`[x, pageHeight - y - height, x + width, pageHeight - y]`.

Chrome PDFium currently ignores clickable FitR actions. To keep offline clicks
functional there, the annotation targets a second, internal named `/XYZ`
destination at the same context origin, with a deterministic paper-width zoom
calibrated to A3 landscape and bounded between 0.7 and 2.3. All active links use this XYZ destination; the FitR
destination records the precise intended context but is not the active link
target. This is a viewer compatibility limit, not a scene-schema change;
screen framing can vary outside the tested desktop viewport. No external URI
or JavaScript actions are emitted.

## Validation

Run from the repository root with a local server at `http://127.0.0.1:8768`:

```sh
npm run check:pdf
node --test test/outputPdf.test.mjs test/outputPdfJumps.test.mjs test/outputSvgRenderer.test.mjs
node scripts/engine-output-pdf-smoke.mjs
node scripts/engine-pdf-production-smoke.mjs <reference-artifact-directory>
python3 scripts/inspect-pdf-production.py <production-artifact-directory>
node scripts/engine-pdf-browser-smoke.mjs
node scripts/engine-pdf-click-smoke.mjs <production-artifact-directory>
```

The production fixture covers the A4/A3/A2 paper and margin matrix, tall/wide
drawings, strict and bidirectional Jump pairs, unpaired nodes, page edges,
cross-page links, a representative project, a managed Loom, and 100 devices /
300 cables. The structural inspector verifies page and annotation coordinates,
FitR geometry, internal actions, report rows and matrix content. The Chrome
PDFium smoke clicks reciprocal links offline at 300% initial zoom and checks
target visibility and central framing where page-edge clamping permits it.
Preview and Acrobat are not covered by automated browser tests.

The developer-only Chromium/finalizer reference scripts remain available for
comparison. They are not invoked by the normal Export PDF command.
