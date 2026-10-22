# Vertical Card Sizing and Compact Shared Buses

Baseline: `a06df210810b766cdd54b88624e377980d18190a`, build 54.38.127.
Result: build 54.38.128. Engine Cards tab only; no Legacy or Multi-Core redesign.

## Reproduced defects

- Three resize handles allowed horizontal changes, contrary to the requested vertical-only interaction. Only the bottom handle remains; the geometry helper also locks width for historical east/corner callers.
- Four shared-bus members reserved four standalone rows before grouping. In native Chrome the first member was at Y=162 and the editing boundary was 324 units tall. The existing shared-bus eligibility/span rules now allocate the group atomically: member positions are 108, 126, 144, 162 and the initial boundary is 216 units tall.
- Shared fields used the first member's Y rather than the bus center. They now attach at the center, including the bus's horizontal stem offset.
- `editingBounds.height` was authoring-only. Installed artwork now honors the authored height. Native resize to 175 units, palette drag into Connectors, Engine output, offline HTML, PDF and save/reopen all retain that compact result.

## Ownership and compatibility

No new card persistence schema. Existing `editingBounds.height` controls artwork height and the footprint allocated when inserting into a new slot. Card width follows the existing input/output/I/O geometry and content bounds, not a user horizontal resize.

Existing physical slot reservations are retained, including previously implicit reservations captured before resize. Neighboring slots do not move or shrink. Artwork remains clamped to an existing slot's capacity. Cards without an authored height retain historical installed geometry until explicitly resized. Opening the editor alone does not rewrite card definitions.

Connector IDs, source anchors, relationships and cable endpoint identities remain intact. Shared-bus displayed positions compact as intended; their connectors are not deleted or recreated. Both-side groups reserve both lanes, and following standalone nodes begin below the entire group.

## Verification

Isolated staged-tree validation excludes unfinished Device JSON Import work:

- `node --test test/*.test.mjs`: 1,856 passed, no failures or skips. Includes five focused compact-card regressions and existing resize, placement, safety and shared-bus tests.
- All 16 `scripts/*-validation.mjs` validators and the three generated bundle checks (`build-output-viewer`, `build-pdf`, `build-cable-schedule`, each with `--check`).
- Classic inline shell syntax and staged whitespace checks.
- Installed Google Chrome: `card-compact-smoke.mjs`, `card-area-names-smoke.mjs`, `card-safety-browser-smoke.mjs`, `card-reorder-smoke.mjs`, `jump-node-replacement-smoke.mjs`, `faceplate-reliability-smoke.mjs`.
- Native vertical resize with diagonal pointer movement, preview/commit parity, non-mutating previews, undo/redo, cancel, keep editing, discard, Save Project Device, project save/reload, zoom and middle-button pan.
- New compact card palette drag/drop; existing connected-card safety; empty and 50-connector cards; offline HTML and focused production PDF downloads. Before/after, installed, offline viewer and Poppler-rendered PDF images inspected.
- SHA-256 equality for all 101 protected paths; original unstaged index import patch retained separately. No factory artwork, faceplates, Masters or backup changes.

Evidence: `/tmp/wirenexus-card-compact/`. Set `AVDESIGNER_BASE_URL` to rerun browser scripts against a local server.

## Known limitations

- Existing slots retain their physical reservations; this change does not automatically repack neighboring installed cards or shrink a chassis.
- The prior null-connector `installedModule` failure in Jump-label rendering remains unrelated and unfixed. `jump-node-replacement-smoke.mjs` reports its existing Loom/one-ended-Jump limitations. The baseline reproduction command, stack trace and impact for the wider PDF smoke are documented in `faceplate-reliability-prompt5.md`; the focused card PDFs pass. Neither that failing test nor unrelated PDF production logic is changed.
- No remote deployment, release tag, personal-library promotion acceptance, long-duration resource soak or next-phase implementation is included.
