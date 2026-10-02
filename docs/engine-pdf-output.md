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

Each annotation uses a direct `/A << /S /GoTo /D [targetPageRef /XYZ left top null] >>`
action. `left` and `top` are the paired Jump's exact PDF coordinates;
`top = pageHeight - targetRect.y`. The null zoom keeps the reader's current zoom.
There are no named `-viewer` destinations, guessed paper-width zooms, external
URIs or JavaScript actions. PDFKit 0.20.2's public `goTo()` only emits named
destinations, so `outputPdfNavigation.js` creates this direct internal action
using PDFKit references.

A dedicated two-page PDF tested named FitR, direct annotation `/Dest /FitR`,
and direct `/GoTo /D /FitR` in Chrome PDFium. All were structurally valid and
reached the paired page, but left the target offscreen at 300% zoom. Exact XYZ
with null zoom kept the target visible in both directions at 900x650, 1200x800,
1500x1000, 1920x1080 and 1000x1400. This is accurate navigation, not centred
context framing. `jumpNavigationContext()` and `fitRCoordinates()` remain pure
layout utilities, but are not active PDF destinations. Other PDF viewers may
handle FitR differently; Preview and Acrobat remain unverified.

## Validation

Run from the repository root with a local server at `http://127.0.0.1:8768`:

```sh
npm run check:pdf
node --test test/outputPdf.test.mjs test/outputPdfJumps.test.mjs test/outputSvgRenderer.test.mjs
node scripts/engine-output-pdf-smoke.mjs
node scripts/pdf-destination-spike.mjs
python3 scripts/inspect-pdf-destination-spike.py <spike-directory>
node scripts/pdf-destination-spike-click.mjs <spike-directory>
node scripts/engine-pdf-production-smoke.mjs
python3 scripts/inspect-pdf-production.py <production-artifact-directory>
node scripts/engine-pdf-browser-smoke.mjs
node scripts/engine-pdf-click-smoke.mjs <production-artifact-directory>
```

The production fixture covers the A4/A3/A2 paper and margin matrix, tall/wide
drawings, strict and bidirectional Jump pairs, unpaired nodes, page edges,
cross-page links, a representative project, a managed Loom, and 100 devices /
300 cables. The structural inspector verifies page and annotation coordinates,
exact internal actions, report rows and matrix content. The Chrome PDFium
smoke clicks reciprocal links offline at 300% initial zoom across the five
viewer sizes above, checking exact target visibility and retained zoom. The
full structural paper matrix is A4/0 and 4 mm, A3/0, 4 and 10 mm, A3/75% and
100%, and A2/4 mm. Preview and Acrobat are not covered by automated browser
tests.

The developer-only Chromium/finalizer reference scripts remain available for
comparison. They are not invoked by the normal Export PDF command.
