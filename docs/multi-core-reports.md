# Multi-Core Phase 7: Technician Reports

Build 54.38.111. Engine only. Phase 8 has not been started.

## Baseline and Scope

Starting local and fetched `origin/engine-prototype` both:
`d4906c03e44c980a01ba7b60fe16cba5cc79e321` (54.38.109).

The previously completed, uncommitted Device JSON Import work is separate from
this change. Its source, tests, fixture, documentation and personal-definition
store changes remain local. Unrelated faceplates, `Masters/`, backups and PDF
probe scripts were not modified. No Legacy files, electrical traversal,
Multi-Core Editor, canvas routing, auth or promotion behavior changed.

## Architecture Audit

`cableSchedule.js` already owns physical Jump-leg grouping, numbering, cable
families, Loom metadata, rack patch presentation and CSV. Its existing typed
Signal Chain path was not rendered by either Signal Chain UI. Multi-Core
endpoints also fell through the ordinary device lookup as "Unconnected".

`multiCoreConnectivity.js` already supplies frozen occupancy, boundary checks,
passive edges, visited-edge traversal and diagnostic references. The model
contains independent termination ports and stable circuit mappings. Projection
and Jump routing are visual: a split trunk remains one assembly. The existing
Editor already persists independent definitions and termination layouts; no
editor or topology changes are needed for these reports.

XLSX uses the existing ExcelJS browser bundle. PDF uses the existing app-owned
PDFKit generator. HTML and Publish share `buildEngineViewerHtml`, an embedded
Engine scene and the generated viewer bundle. These paths were extended, not
replaced.

## Shared Snapshot and Counts

`src/engine/multiCoreReports.js` exports `buildMultiCoreReports(project, options)`.
It returns detached, deeply frozen, JSON-safe report version 1:
`cableRows`, `assemblies`, `channels`, `signalPaths`, `diagnostics`.

The snapshot consumes the existing connectivity index; output generation reuses
the index already present in `modelData`. No synthetic connections, channel IDs,
derived occupancy or report facts are written into the project. Report opening
now uses read-only cable numbering rather than assigning canonical numbers.

The Cable Schedule caches its snapshot between model commits/downloads and
invalidates on opening and Engine commit. Pointer moves do not rebuild reports.
Output snapshots are built on export, never on the render loop.

The Hybrid14 reference produces exactly 2 physical cable rows, 1 assembly,
14 circuit rows, 1 occupied channel and 13 unused/spare channels. Its independent
lengths remain 3 m, 75 m and 2 m. Ordinary Jump legs retain one physical cable
number; ordinary Jump continuation remains a path segment, not another cable.
Trunk gateways and visible sections produce no additional physical inventory.

## Report Fields

Existing Cable Schedule columns retain their order. Only rows containing typed
Multi-Core endpoints enable four appended columns: Multi-Core ID, End, Port,
Channel. Typed references retain assembly/end/connector/circuit IDs separately
from labels. Assembly IDs are canonical identities (for example `mc-1`); the
user-facing assembly name (for example `MC-001`) is not a foreign key.

The Assembly Register includes ID, name, manufacturer, model, both termination
styles, trunk length and unit, circuit/occupied/spare/disabled/reserved/unresolved
counts, location and notes. One source assembly record produces one row.
Ambiguous imported identities remain visible and diagnosed, not deduplicated
into an invented physical inventory.

The Channel Manifest includes assembly ID, display number, stable circuit ID,
media family/specification, both port labels and stable internal port references,
both equipment connections and cable IDs, derived status, reservation, notes
and named strands. OM4 duplex is one row with two strand identities, never two
assemblies or two cable numbers.

Phase 3 statuses are displayed distinctly: unused, reserved, connected at A,
connected at B, connected at both, disabled, incompatible and unresolved.
Spare counts include unused channels only; reservation and disabling are separate.
External patch Loom membership remains in Cable Schedule and Signal Chain;
the trunk itself is not counted as an ordinary Loom member.

## Signal Chain

`multiCoreReportPresentation.js` formats the existing typed traversal. Expanded
segments show cable identity/type/length/Loom, entry and exit ports, assembly,
circuit, physical trunk length and traversal direction. The existing Signal
Chain dialogs are reused; long text wraps. The wire inspector identifies its
Multi-Core/channel rather than presenting a missing device.

Starting at the opposite equipment patch reverses segment order and A/B
orientation. Explicit reverse traversal remains supported. Partial paths end
with an "Open termination" diagnostic naming the assembly/channel/end.
Incompatible, blocked, missing/ambiguous endpoint, unsupported schema, invalid
mapping, Jump ownership and cycle diagnostics remain distinct. Original
unresolved references are retained in the diagnostic export.

No polarity is inferred. Arbitrary devices, unassigned matrices and adapters
without explicit mappings remain traversal boundaries. Existing non-Multi-Core
Signal Chain presentation remains unchanged.

## Access and Exports

Open **Cable Schedule**. The existing table is followed by collapsible Assembly
Register, Channel Manifest and Diagnostics sections, with CSV downloads.
**Download XLSX** includes Cable Schedule, existing Loom Schedule, Multi-Core
Assemblies, Channel Allocation and nonempty Diagnostics sheets. IDs are strings,
headers frozen, filters enabled and columns sized for readable wrapped text.

CSV uses the historical headers for non-Multi-Core projects, UTF-8 download BOM,
CRLF records and doubled quote escaping. Formula-triggering cells are prefixed
with an apostrophe, including leading whitespace/control-character cases.
ExcelJS receives explicit string values, never formula objects. HTML report
tables use `textContent`; expanded path markup escapes all imported text.

The normal production **Export PDF** appends the register, manifest and
diagnostics through the existing PDFKit document. Records wrap and paginate;
ordinary-sized records stay together, oversized records continue on later pages.
All fields are retained. Existing drawing pages, vector art, margins, title
blocks, image handling and Jump XYZ destinations are unchanged. Report pages
are appended after drawing-page annotation creation, including multi-page input.

Readonly Output Viewer Report includes the physical schedule, register and
manifest. Clicking a physical cable number opens its Signal Chain. No editing
controls are added. HTML/Publish embed the same snapshot once under
`engineScene.modelData.reports`; redundant legacy signal-chain payloads are
omitted when that snapshot is present. No factory/network fetch is required.
Authentication and hosting semantics are unchanged.

Historical projects keep ordinary rows, numbering, column order, Signal Chain
and PDF layout, with no empty Multi-Core report sections. CSV formula protection
is the deliberate safety exception for malicious/formula-looking historical text.

## Measurements

Node 24.4.1 on this Mac; single-run measurements, not universal performance
guarantees. Snapshot includes manifest derivation; manifest CSV is measured
separately. Each fixture has two external patches on its first circuit.

| Channels | Snapshot ms | Schedule ms | Manifest CSV ms | Path markup ms | XLSX ms | PDF ms | XLSX bytes | PDF bytes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | 6.36 | 1.07 | 0.17 | 0.08 | 23.06 | 30.41 | 12107 | 7686 |
| 16 | 2.65 | 1.44 | 0.09 | 0.02 | 12.15 | 29.47 | 12813 | 10681 |
| 32 | 2.62 | 1.56 | 0.15 | 0.01 | 8.38 | 43.63 | 14140 | 16654 |
| 64 | 3.69 | 2.64 | 0.37 | 0.01 | 12.11 | 81.93 | 16710 | 29464 |
| 256 | 14.93 | 10.41 | 0.47 | 0.01 | 28.98 | 295.89 | 31326 | 104032 |

Chrome initially opened the 64/256-channel reports in approximately 155/145 ms.
All rows remain scrollable/exported; no display cap is used. A4 performance PDFs
contain 6/8/12/21/72 pages respectively, including per-channel diagnostics; actual
PDF text extraction verified every stable circuit reference, including the last.

## Verification and Evidence

New tests: `test/multiCoreReports.test.mjs` (25 cases), reporting browser smoke,
performance script. Coverage includes counts, Jump/Loom coexistence, duplex,
statuses, reverse/partial/invalid/cyclic paths, historical parity, immutability,
CSV/formula/HTML safety, actual XLSX content, all five PDF sizes, embedded parity,
and reciprocal annotations unchanged when reports follow two drawing pages.

Full working-tree Node suite: 1,595 passing tests (includes the separate local
import feature). Exact staged production tree: 1,575 passing tests, zero failures
or skips. All 16 static validators and three generated-bundle checks pass on
that staged tree. Classic shell/staged JavaScript syntax and diff whitespace
checks also pass.

Real Chrome acceptance includes UI Multi-Core creation, both physical patches,
Loom membership, Jump gateway routing, reporting, both chain orientations,
disconnection, save/reload, CSV/XLSX/PDF, network-blocked standalone HTML and
simulated hosted Publish, readonly controls, screenshots and zero page errors.
64/256-channel UI/XLSX/PDF acceptance verifies every row. Screenshots of the
report and Signal Chain were inspected; PDF pages were rendered with Poppler.
The isolated staged-tree Chrome run also passed with zero page errors, including
clicking the readonly report cable action and inspecting a 390 x 844 mobile
Signal Chain. Its 64/256-channel report openings measured 146/165 ms.

Existing browser regressions passed for Multi-Core persistence/connectivity/
canvas/editor/Jump, Cable Schedule, Signal Chain, patch-panel Signal Chain,
Loom stability output, Loom Jump presentation, unified Jump/Loom, Jump save/
reload and cable selection, Output Viewer, standalone HTML, personal definition
isolation, Device Editor integration and the separate local Device Import.
Production PDF regression passed 23 cases without warnings. Actual Multi-Core
PDF annotations match expected positions within 0.02 pt; 10 reciprocal offline
Chrome clicks at five viewport sizes preserve 300% zoom and reveal their targets.

**Pre-existing failed check:** `managed-loom-smoke.mjs` expects absent label-color
fields on newly created looms, but both fields already exist on the untouched
starting commit. Reproduced against an isolated `d4906c0` checkout on port 8774.
An exploratory historical-field fixture also exposed another baseline failure;
that test modification was discarded. This test and Loom production code remain
unchanged. Do not interpret the passing suites as an all-browser-tests-green claim.

Evidence (local, not committed): `/tmp/wirenexus-multi-core-reports/`,
`/tmp/wirenexus-multi-core-jump/`, `/tmp/wirenexus-phase7-regressions/`,
`/tmp/wirenexus-phase7-static/`, and `/tmp/wirenexus-phase7-*.log`.

## Files and Boundaries

New production modules: `multiCoreReports.js`, `multiCoreReportPresentation.js`,
`multiCoreReportUi.js`. Integrations: `cableSchedule.js`, `cableScheduleXlsx.js`,
`outputSceneSnapshot.js`, `outputPdf.js`, `outputViewerApp.js`,
`outputViewerEntry.js`, `outputViewerReport.js`, `outputViewerHtml.js`, viewer CSS,
and the Engine shell in `index.html`. Generated viewer/XLSX/PDF bundles updated.
Bridge/renderer and four validator fingerprints updated to 54.38.111.
Three existing Node harnesses were updated for imported dependencies/new report
state without removing their behavioral assertions.

No manual Acrobat/Preview or Microsoft Excel application acceptance is claimed.
XLSX verification parses real exported workbooks. Publish acceptance uses its
actual preparation path with simulated hosting, not an authenticated live upload.
Source data with unresolved identities remains unresolved rather than repaired.

Phase 8 recommendations: investigate the baseline Loom smoke failures; consider
compact grouping of repeated physical-verification warnings in very large PDF
reports, additional spreadsheet-reader visual QA, and broader malformed-import
fuzzing. None is implemented in Phase 7. Final local/remote commit hashes are
reported in the delivery message after the scoped push.
