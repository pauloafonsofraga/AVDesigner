# Prompt 7: Shared-Bus Label Collision Avoidance

Baseline: `d4d887266f72cf7808cc34e18665aea91e43cafc`, `engine-prototype`.
Build: 54.38.135. No deployment, release tag or Prompt 8 work.

## Confirmed defects

- Connector captions and name fields were drawn independently without testing neighboring annotations. A two-member shared bus beside a standalone node reproduced overprinted names and `HDMI`/`SDI` captions on the untouched baseline. Before/after Chrome screenshots are under `/tmp/wirenexus-prompt7/`.
- The separate SVG Cards preview could place an installed-module bus's two-line caption over the next connector's Name field. A three-member SFP SDI bus exercises the actual SVG adjustment.

## Display-only repair

`src/engine/connectorLabelLayout.js` is a deterministic rectangle resolver shared by Engine labels and the SVG Cards preview. It keeps each connector/bus's caption and fields together. Existing noncolliding positions stay unchanged. On collision it tries nearby gaps, then an adjacent column, within the existing device/card boundary and a bounded distance from the source. Node targets are obstacles. Shifted groups receive a subtle, noninteractive leader to their original connector/bus anchor.

The Engine measures existing rendered caption lines, info boxes and field titles using their current font/detail metrics. Low-zoom hidden/compact fields and installed-module lines retain their established visibility rules. Captions and fields reuse one plan per device per draw, avoiding duplicate collision work. Field hover/magnification hit rectangles follow their displayed locations while retaining connector IDs. Cards use measured SVG group bounds; cached unshifted bounds keep display offsets out of card sizing/resizing.

No source connector/anchor, card slot, device dimensions, wire endpoint, name, ID, relationship or compatibility rule is modified. There is no persisted label-offset metadata or project schema change. Legacy paths and rotated adapter captions are unchanged. The existing Engine output renderer supplies PDF placements, and the regenerated self-contained Output Viewer supplies HTML/hosted placements.

## Verification

- 18 focused tests: untouched presentation, dense rows, opposite-side labels, node obstacles, columns, a 50-row dense group, deterministic order, impossible-space fallback, left/right shared buses at six zooms, exact node/relationship immutability, JSON round-trip and equal-zoom preview/output placement.
- Existing shared-bus caption scale/offset, empty-field compaction, wrapping and orthogonal-comb tests remain intact. The focused group totals 37 tests.
- `scripts/connector-label-collisions-smoke.mjs`: installed Chrome; both sides at 34%, 55%, 100%, 150%; working moved-field hover target; Device Editor zoom without draft mutation; dense SFP installed-module SVG bus; no overlapping resolved SVG annotation rectangles; unchanged card draft across zoom; self-contained HTML opened offline; exact canvas/HTML text/font/coordinate equality at 100%; production PDF download. Screenshots inspected, including a Poppler-rendered PDF.
- `scripts/card-area-names-smoke.mjs`: passes native card resizing, preview/commit, undo/redo, Save/Discard, reopen, names, zoom/middle-pan, and 0/50-node card checks.
- `scripts/engine-pdf-production-smoke.mjs`: all 23 cases pass, without warnings.
- Full isolated repository tests, all 16 static validators and all three generated-bundle checks are required before committing. Counts are included in the completion report.

The deliberately unsnapped dense fixture is round-tripped through the Engine project/output models in Node. It is not used to assert the shell's unrelated save-time lane normalization; canonical card Save/Discard/reopen is covered by the existing native card smoke.

## Pre-Existing Check Failure

`scripts/card-shared-bus-smoke.mjs` fails identically on the candidate and an untouched archive of baseline `d4d887266f72cf7808cc34e18665aea91e43cafc`:

```sh
AVDESIGNER_BASE_URL=http://127.0.0.1:8782 \
AVDESIGNER_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node scripts/card-shared-bus-smoke.mjs
```

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
216 !== 270
    at scripts/card-shared-bus-smoke.mjs:56:51
```

This is its pre-existing assertion that the final connector retains its old row after grouping; it is not a label-rendering regression. Neither the failing script nor its assertions were changed. Logs: `/tmp/wirenexus-prompt7-card-bus.log` and `/tmp/wirenexus-prompt7-baseline-card-bus.log`.

## Limits and Protections

Collision resolution is local to each device/card; it does not rearrange overlapping devices or solve cable-caption collisions. If no permitted free space exists, text is retained at its original location with an ephemeral unresolved diagnostic; it is not hidden, renamed or saved with an invented position. Existing font/detail visibility and line fitting are retained, not redesigned. No mobile acceptance or long-duration performance soak is claimed.

Protected artwork, faceplates, backups, Masters and unfinished Device JSON Import work remain excluded. SHA-256 verification covers all 101 protected paths, and the original unstaged `index.html` import patch is preserved independently of the staged implementation.
