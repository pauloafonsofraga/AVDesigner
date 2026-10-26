# Faceplate Initial Placement

Build 54.38.142 fixes the xPressCue transparent-padding case recorded in
`Screen Recording 2026-10-23 at 17.03.45.mov`.

The supplied artwork is 1920x1080, with visible alpha bounds at
`x=37, y=477, width=1847, height=166`. Initial upload previously reserved
the full bitmap rectangle: the visible image started at y=127.27 and the
first connector row at y=266. Moving the artwork left that old reservation
intact, by design, so ordinary dragging could not repair the spacing.

New empty-device uploads now inspect alpha before committing and use the
existing content-bounds transform to align visible artwork at the top. The
original PNG bytes and transparency remain intact. For this image, the
visible top is y=46 and the first connector row is y=113. The editing frame
still allows normal vertical movement and resizing without moving nodes.

Existing definitions are not automatically migrated. In the Faceplate tab,
**Fit Faceplate** explicitly fits the artwork and rebases connector/card rows
through the existing atomic structural transaction. Populated definitions
require confirmation; Cancel is unchanged and the operation is undoable.
Connections and stable identities are preserved. Replacing existing artwork,
Backplate behavior, Multi-Core and Legacy remain unchanged.

Verification:

- Seven focused tests cover exact xPressCue alpha bounds, opaque/empty-alpha
  fallback, portrait artwork, movement/resizing, explicit repair, JSON reopen
  and canonical output consistency.
- `scripts/faceplate-initial-placement-smoke.mjs` accepts an optional source
  PNG path and otherwise generates the same padded silhouette. Chrome checks
  new upload and first IEC placement, byte parity, connected-device recovery,
  confirmation Cancel, undo/redo, save/reopen, offline HTML and PDF export.
- Existing faceplate reliability and transparent-content browser suites pass,
  including artwork replacement, preview/commit parity and unchanged wiring.
- Full scoped-tree Node suite, 16 static validators and generated-bundle
  freshness checks are required before commit.

No source artwork, factory definitions, protected files or unrelated Device
JSON Import work are included in the commit.
# Top-Aligned Resize Follow-Up

Ordinary Engine Faceplate images no longer expose free artwork dragging. Uploads
and replacements fit alpha-visible content to the usable width at the top. Resize
handles preserve aspect ratio, remain top-aligned and can grow visible content to
full width even when the original PNG contains substantial transparent padding.
Original image bytes are not cropped or rewritten. The existing optional artwork
layout carries `topAligned`; older saved definitions remain readable unchanged.

Replacement and resize preserve existing connectors, slots, cables and device
dimensions. For historical definitions with connector rows already far below the
artwork, **Fit Faceplate** explicitly compacts the origin and realigns rows through
the existing confirmed, undoable structural transaction. This does not silently
reposition existing connections merely on opening an editor. Backplate movement
and Legacy remain unchanged.

Regression coverage includes all eight resize handles, extremely padded images,
old-image resizing, original-byte preservation, actual pointer resizing in Chrome,
replacement, undo/redo, save/reopen, offline HTML and production PDF.
