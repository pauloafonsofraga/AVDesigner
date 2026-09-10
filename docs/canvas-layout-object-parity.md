# Canvas Layout Object Parity

Build: `iteration54-0-canvas-layout-objects`

Legacy reference: `8301fbf23c82f3e3f2496cb90234019c7bf47958`

## Comment Callout

Legacy comment placement is a two-stage canvas tool. The first click stores the
fixed callout anchor and shows a live leader line to the pointer. The second
click places the comment box at that world coordinate as the box top-left. A new
comment uses `180 x 82`, title `Comment`, empty body, and leader color
`#28bdfd`, with text/background colors following the current theme.

Comment editing semantics are box-based, not union-bounds-based. The persisted
raw object keeps `x/y/width/height` for the box and `anchor` for the callout
point. Dragging or resizing the box changes only the box rectangle; the anchor
remains fixed and the leader endpoint is recalculated from the legacy
dominant-side rule. Resize handles belong to the box corners and the minimum
box size is `80 x 46`. Selection hit testing is precise: box hit or leader-line
hit, not the empty rectangle between them.

In Engine mode, double-click is delegated from the Engine hit test back to the
DOM shell. The shell decides whether the click is in the title band or body and
opens the existing inline input/textarea positioned through the Engine
world-to-screen transform. Inspector title, color, and text-size edits now use
the same raw canvas-object snapshot command so a completed inspector edit is one
undoable Engine operation.

## Area / Room

Legacy area placement is also two-stage. The first click stores one corner, the
pointer shows a live rectangle, and the second click creates a normalized area
from the two corners. Areas can be drawn in any direction. Creation enforces a
minimum `80 x 60`; defaults are name `Area / Room Name`, background `#223544`,
and `locked: false`.

Areas are background canvas objects. In Engine mode they stay in the existing
canvas-object render priority behind wires, devices, comments, and title
blocks. Locked areas remain selectable but cannot be dragged or resized.
Double-click rename remains DOM-owned and writes through one Engine snapshot
command. Inspector name, lock, background, and text-size edits use the same
snapshot path, including the lock toggle.

## Title Block

Legacy title-block creation starts in the modal. Pressing Place closes the modal
and enters a placement mode where a fixed `760 x 112` rectangle follows the
pointer. Clicking the canvas centers that rectangle on the pointer and then runs
the existing `findNonOverlappingRect(...)` clear-space rule before creating the
block. If no clear space is found, placement stays active.

Title-block drag moves the whole object. Resize is proportional, keeping the
`760:112` aspect ratio and the legacy minimum scale of `0.34`. Inspector Edit
opens the existing modal, and Apply replaces only the raw title-block fields and
logo data through an Engine snapshot command.

## Current Engine Gaps

Before this pass, the visual Engine canvas objects existed, but placement and
inline editing still relied on legacy SVG event ownership. Comment and Area
creation mutated production arrays and asked the old renderer to redraw; Title
Block final placement was still attached to a pointer listener on the legacy SVG
canvas. Engine mode therefore had correct visual primitives without a reliable
Engine pointer route, world-coordinate authority, or single-command creation
path.

## Final Ownership

The ownership after Iteration 54.0 is:

- DOM shell: toolbar state, drafts, modals, inline text controls, and status.
- Engine bridge: pointer/key/double-click delegation, hit testing, selection,
  targeted SceneGraph updates, and command recording.
- Existing production data: raw `areas`, `comments`, and `titleBlocks`.
- Existing normalizer: `normalizeEngineCanvasObject(...)` converts raw objects
  to SceneGraph devices.
- WebGL renderer: draws the saved objects and their selection/resize affordances.

Transient authoring geometry is a lightweight SVG overlay above the Engine
canvas. It draws only the in-progress comment leader, area rectangle, and title
placement rectangle. It is not a production object and does not receive pointer
events.

## Tests Performed

- `node --check` on changed Engine modules.
- `scripts/canvas-layout-objects-validation.mjs` for normalization,
  mutation create/replace/delete/restore, comment anchor preservation,
  minimum-size source guards, title ratio, and save/reload round trip.
- Real-browser Engine smoke for Comment creation, live leader preview, box drag,
  inspector text-size undo/redo, delete/undo, Area live rectangle, lock/drag
  prevention, rename, delete/undo, Title Block modal placement, inspector modal
  edit undo/redo, delete/undo, and Escape cancellation.
- Existing preview and Engine validation scripts listed in the final task
  report.

Manual browser testing should use the visible build:
`Iteration 54.0 — Canvas Layout Objects — iteration54-0-canvas-layout-objects`.
