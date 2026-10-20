# Device Brand Headers

Build **54.38.116**, branch **engine-prototype**.

## Baseline and Naming Audit

Starting local and fetched remote HEAD:
**0e63693d1843116f0019511e967525c6a85cc486**.
The newer SFP/SDI/DAC commit is preserved above the requested c2d7b0b baseline.

The existing shell helper, deviceBrandLabel, resolves the first nonempty value
in this order: brand, manufacturer, vendor, make. Current Device Editor/library
lists show the name and brand in separate text elements, rather than sharing a
concatenation helper. Those lists and the separate editing fields are unchanged.
The new Engine helper follows their brand-field precedence and the requested
single-space presentation; it does not reuse the unrelated matrix heading's
dash separator.

Canonical Engine name precedence remains instance.name, template.name,
template.model, then the existing generated Device N fallback. An instance
with a custom name keeps that name; no product/model name replaces it.
Instance brand metadata takes precedence over template brand metadata, with
the same alias order within each record. The resolved brand exists only in
the detached Engine projection; source fields are not rewritten.

## Shared Presentation

src/engine/deviceDisplayName.js contains deviceBrandForDisplay,
hasOrdinaryDeviceHeader and deviceHeaderLabel. Header text is derived from
the already-resolved scene label, never assigned back to it.

- Join brand and name with one normal space, with display-only whitespace cleanup.
- Without brand metadata, show the existing name alone.
- Explicitly authored brand values such as Generic remain visible.
- Suppress a duplicate brand only at the beginning, case-insensitively, with
  a whole-prefix boundary. Unicode letters, digits and marks cannot act as
  boundaries inside a word. Existing punctuation is preserved; none is inserted.
- Preserve the authored capitalization of an already-prefixed name.
- Do not remove brand-like words from the middle of a name.

The existing deviceVisualBuilder uses this helper for both its texture key
and ordinary product headers. The same builder renders the Engine canvas,
read-only/technician viewer, self-contained HTML and vector PDF. Publish uses
the existing shared HTML preparation path. Viewer Inspector headings and
device-hover titles use the same helper. Editable Inspector brand/name fields
remain separate canonical values.

## Scope and Layout

Ordinary devices, modular chassis, projectors and power-distros using the
ordinary product header are supported. Jump Nodes, Looms, Multi-Core schematic
ends/trunks, adapters, rack shells/compact rack faces, LED surfaces, images,
areas, comments and title blocks retain their special labels.

The header retains its 900-weight 15.4px font, white fill, position (20,22),
alignment and width-minus-40 inset. Existing shrink-to-fit behavior is retained.
If an unusually long title still exceeds the available width, the existing
single-line text-layout utility supplies an ellipsis. No body size, connector
position, faceplate position, selection state or hover geometry is changed.

## Data and Compatibility

No schema migration or saved-name prefixing. No device, definition, connector
or wire identity changes. No changes to cable labels, endpoints or library data.
Historical manufacturer/vendor/make aliases are read for display without
rewriting their source fields. Existing Save/Load and mutation paths are unchanged.
Tests compare saved devices/connections and connector geometry directly, and
compare geometry against the same scene with brand metadata removed.

## Verification

The focused tests cover all requested name cases, separate-field preservation,
modular/custom naming, unchanged geometry, special labels, output parity,
texture invalidation and pathological title fitting.

scripts/device-brand-headers-smoke.mjs launches isolated real Chrome, imports
a deterministic project through the file input, records actual canvas text
draws, uses Device Editor controls, saves/reloads, opens offline HTML with
network blocked, runs real Publish preparation with storage/API I/O mocked,
and exports/rasterizes the production vector PDF. No remote project is published.

Validation used an isolated checkout of the exact staged production tree:

- Full Node suite: 1,683 passed, zero failed or skipped.
- All 16 static validators passed; generated viewer, PDF and cable-schedule
  bundles passed reproducibility checks.
- Real Chrome: all seven grouped header workflows passed, including the
  requested editor, save/reload, offline HTML, simulated Publish and PDF checks.
- Existing Device Editor browser regression: 32 checkpoints and 15 native
  drags passed, including duplicate/default/reload and offline parity.
- Inspected canvas, separate editor fields, offline viewer, extreme fitted
  header and both PDF-page screenshots. Headers stay inside their bounds.

Evidence is under /tmp/wirenexus-brand-2026-10-20/. One unrelated limitation
was observed: a literal tab in the fixture's canonical device name renders
incorrectly in the existing PDF report table. The drawing header is correct;
the report table and its PDF exporter are unchanged by this display-only work.
Verified commit/remote hashes are included in the completion report.

## Files

- src/engine/deviceDisplayName.js: shared display-only resolution.
- src/engine/projectAdapter.js: read historical brand aliases into projection.
- src/engine/deviceVisualBuilder.js: shared header text/cache key and bounded fit.
- src/engine/renderer.js: ordinary device hover title.
- src/engine/outputViewerApp.js, outputViewerModel.js: viewer hover/Inspector title.
- index.html, src/engine/productionBridge.js and four existing static validators:
  build/cache fingerprints only.
- src/engine/generated/outputViewerBundle.json: rebuilt shared viewer.
- fixtures/device-brand-headers.mjs, test/deviceDisplayName.test.mjs,
  scripts/device-brand-headers-smoke.mjs: regression and browser coverage.
- test/projectorLenses.test.mjs: expected branded hover names; lens/layout
  assertions remain unchanged.
- This document.

Legacy, unfinished Device JSON Import work, personal definitions, artwork,
faceplates, Masters and backup files are excluded. No deployment or release tag.
