# Prompt 6: Transparent Faceplate Content Bounds

Baseline: `bc5705413fd7adbb8ee45c87c2a619d4ee6a3a0d`, `engine-prototype`.
Build: 54.38.134. Single-image Engine Faceplate editor only. No deployment or Prompt 7.

## Behavior

- The selection frame and Fit use nonzero-alpha pixel bounds. Alpha 1, antialiasing, shadows and partially transparent pixels count; there is no destructive threshold/crop.
- Drag the image body to position it. Resize handles scale padded artwork proportionally, anchoring the opposite edge/corner. Visible content stays inside the existing reserved header; invisible padding may extend outside it.
- Opening artwork does not change its persisted appearance or transform. Content-based transforms activate on an explicit move/resize. Original PNG upload bytes and natural resolution are retained, including images larger than the former 1800px preparation limit. Thumbnails and Engine texture budgets remain unchanged.
- Scanning is lazy for the selected faceplate, uses 512x128 pixel tiles and yields between batches. The cache is limited to eight sources. Loading temporarily blocks the image gesture, not the editor. Empty/unreadable images fall back to the historical full-image boundary and report a nonblocking status.
- Existing opaque/full-bound images retain their resize behavior. First image upload onto a populated ordinary device now captures the existing frame instead of rebasing its connectors/slots. Empty new devices and explicit restoration of deleted faceplates keep their existing structural insertion behavior.

## Persistence and rendering

The existing `faceImage`, natural dimensions, scale/axis scales, offsets and optional `faceImageLayout` remain the ownership/transform model. A narrowly necessary optional `faceImageLayout.contentBounds` stores normalized `x`, `y`, `width`, `height`, plus original `sourceWidth`/`sourceHeight`. Without these bounds a visible-content transform cannot be reproduced independently in a viewer/export that has not decoded the PNG.

Bounds are validated against source dimensions. Malformed/stale bounds use historical geometry. Replacement clears old bounds. Existing devices acquire no metadata simply by opening them. The nested layout already round-trips through personal/project definitions, scene normalization, compact configurations and output snapshots; no parallel artwork or image data schema is introduced.

One shared geometry helper expands the visible rectangle back into the original full-image drawing rectangle. Engine preview, canvas, Output Viewer, HTML and PDF consume that placement. Exporters still embed the original artwork. Multi-Core physical front/rear placement bypasses this ordinary-device transform, and Legacy code paths remain unchanged.

## Verification

- Focused Node regressions cover alpha padding, alpha 1/127, opaque/empty images, malformed bounds, first-edit appearance, all eight handles/extreme deltas, movement/alignment, tiny content, unchanged structural geometry, JSON save/reopen, preview/output parity and visual-cache identity.
- `scripts/faceplate-content-bounds-smoke.mjs` uses installed Chrome and real file/pointer/button interactions: 2400x1200 PNG with faint edge pixels; exact original bytes; first upload on a populated connected modular chassis; resize preview/commit; body movement; undo/redo; Escape; Save/Discard; project reload; hosted snapshot; offline self-contained HTML; PDF; fully transparent replacement.
- `scripts/faceplate-reliability-smoke.mjs` retains the opaque-image, eight-handle, zoom/middle-pan, cancellation, replacement and persistence checks. The production PDF smoke provides broader output coverage.
- Test expectations for populated first-upload now assert exact connector/slot/height/power-metadata preservation and zero structural-solver calls. The rollback regression injects the actual artwork-only validation boundary. Explicit removal still uses its original transaction; no solver/animation is needed when its origin is unchanged.

Evidence is under `/tmp/wirenexus-prompt6/`, with additional logs and opaque-image evidence under matching `/tmp/wirenexus-prompt6-*` paths. Full isolated-suite/validator counts are recorded in the completion report.

Limits: no crop, bitmap rewrite, independent front/rear artwork, Multi-Core editor changes, mobile touch acceptance, huge-image soak test or remote published deployment. Unreadable cross-origin artwork cannot be alpha-inspected; it remains editable using its full boundary. Existing texture-resolution budgets are intentionally retained.
