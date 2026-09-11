# Jump Node Model

Build: `iteration54-2-1-jump-node-interaction`

## Current And Legacy Model

Legacy stored Jump Nodes as first-class `jumpNodes[]` records with center coordinates and labels. A visible cable could point to a Jump endpoint using `{ jumpNodeId }` on a normal connection endpoint, and helper paths such as `createConnectionToJump`, `createConnectionFromJumpToDevice`, `portalCableTypeForJumpNode`, and `wireTraceSequence` treated paired Jump Nodes as a portal continuation. Older pair membership was represented by `pairId`; the first visible device-side connection seeded cable type/fiber metadata for the continuation.

The Engine keeps that first-class object model. A Jump Node is still a compact circular canvas object, not a device box and not a wire.

## New Jump Node Model

Jump Nodes remain in:

```js
jumpNodes: [
  {
    id: "jump-1",
    x: 120,
    y: 240,
    label: "FOH SEND"
  }
]
```

Coordinates are stored as the Jump center, matching the existing production data shape. Engine rendering normalizes each Jump to a `44 x 44` scene object with a synthetic `jump-center` connector.

## Jump Link Model

The portal relationship is stored separately from physical wires:

```js
jumpLinks: [
  {
    id: "jump-link-1",
    outputJumpId: "jump-1",
    inputJumpId: "jump-2"
  }
]
```

`jumpLinks[]` is the canonical representation. It is not inserted into `connections[]`, `SceneGraph.wires`, reports, cable-hop routing, or physical wire rows. This keeps the invisible portal from behaving like a real cable.

## Derived Roles

Roles are derived, not persisted.

An external device-side wire defines the role by looking at the real connector on the opposite endpoint:

```text
real output connector -> Jump = Output Jump
Jump -> real input connector = Input Jump
no clear real connector direction = Neutral Jump
```

Colors:

```text
Output  #32b6ff
Input   #fb7904
Neutral #778492
```

The stored `from`/`to` order is canonicalized separately so output-side Jump wires flow `device output -> Jump`, and input-side Jump wires flow `Jump -> device input`.

## Connection Rules

A Jump can have at most one normal visible device-side wire and at most one `jumpLinks[]` relationship. Pairing is only valid when one member derives `output`, the other derives `input`, neither is already paired, the two IDs are distinct, and the existing Engine connector compatibility helper accepts the two real connector sides.

Neutral, output-output, input-input, self-pair, already-paired, missing, and incompatible cable-family combinations are invalid.

## Rendering States

Normal steady state renders only the two compact Jump Nodes and their visible device-side cables. The `jumpLinks[]` relationship is hidden.

During Jump Link creation, hover reveal, or selected-pair reveal, the Engine draws a live foreground overlay from output Jump center to input Jump center. The overlay is a segmented gradient from `#32b6ff` to `#fb7904`. This special foreground pass applies only to Jump Links; normal wire preview and normal wire z-order are unchanged.

## Selection And Hover

Hovering either paired Jump reveals the counterpart and the hidden gradient link without mutating selection. Clicking either paired Jump selects both Jump IDs in `SceneGraph.selectedIds`, stores the clicked member as `primarySelectedJumpId`, and does not select the device-side wires. The Inspector edits only the primary Jump.

Dragging keeps normal Engine object movement semantics. There is no special pair-move command in this iteration.

## Interaction Gesture

The whole visible circular Jump body is the pointer target. Pressing a Jump starts a transient `pendingJumpPress` state instead of immediately choosing selection, movement, or portal creation.

```text
quick click -> select
click + move 5 px -> move
click + hold 250 ms -> create Jump Link
```

The 5 px movement tolerance is measured in screen pixels so small hand jitter does not cancel a hold at different zoom levels. The 250 ms hold can only enter Jump Link creation when the source Jump has a derived output/input role, has a device-side wire, and is not already paired. Neutral, already-paired, or device-wireless Jump Nodes reject the hold and remain stationary until release. During Jump Link creation, target hit testing also accepts the whole visible Jump circle with a small screen-space tolerance before applying the existing output/input compatibility rules.

## Inspector

The Jump Inspector shows:

```text
Name
Role
Color
Paired With
Device-side Wire
Position
Disconnect Jump Nodes
```

Name edits update the raw `jumpNodes[].label`/`name` data and the synthetic `jump-center` label. Role is read-only. `Disconnect Jump Nodes` removes only the `jumpLinks[]` record; visible device-side wires remain, so derived output/input colors remain.

## History

Each placement, rename, visible wire creation, Jump Link creation, disconnect, and delete operation is a normal Engine command. If deleting or rewiring a visible device-side wire invalidates a Jump Link, the removed link is captured in the same command payload so a single undo restores both the physical wire and the logical portal relationship.

## Save And Load

Project creation, load, save, export, output snapshots, and hosted publishing carry `jumpLinks[]` beside `jumpNodes[]`. Projects with no `jumpLinks[]` continue to load. Legacy `pairId` records are converted to runtime `jumpLinks[]` only when the paired Jump roles are unambiguous output/input; ambiguous legacy pairs stay as loaded Jump Nodes without silently inventing a portal.

## Play Wire Traversal

The existing `Play Wire` controls are unchanged. The path resolver expands either visible segment of a valid paired portal into:

```js
[
  { type: "wire", wireId: "wire-output-to-jump", reverse: false },
  { type: "teleport", fromJumpId: "jump-output", toJumpId: "jump-input" },
  { type: "wire", wireId: "wire-jump-to-input", reverse: false }
]
```

The tracer animates the first visible cable, instantly relocates from output Jump to input Jump, then animates the second visible cable. The hidden Jump Link itself is not animated and adds no physical route length.

## HTML Export

Self-contained HTML receives `jumpLinks[]`, derives the same output/input/neutral Jump colors, hides committed Jump Links in steady state, and extends its existing `Play Wire` path resolution with the same wire/teleport/wire sequence. Hosted viewer output follows this path when it renders the generated standalone HTML/project data.
