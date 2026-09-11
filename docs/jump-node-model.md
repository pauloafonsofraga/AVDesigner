# Jump Node Model

Build: `iteration54-2-4-jump-legacy-parity-play-wire`

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

## Legacy Dynamic Info Box

Legacy renders a compact blue Jump info box beside each Jump Node. The editable Jump Node label remains separate from this box.

The derived text is connection-oriented:

```text
local device output -> Jump A, Jump A paired to Jump B -> device input
Jump A info: to: downstream device - downstream connector
Jump B info: from: upstream device - upstream connector
```

If the Jump has no usable paired/device-side endpoint, the fallback display is `to: Unassigned`. The Engine derives this text live from the current scene graph through `jumpNodeConnectionInfo(scene, jumpId)`, so device renames, connector renames, rewires, deletes, reconnects, and project loads update the box without storing a stale caption or rebuilding a device texture.

## Physical Jump Wire Metadata

A physical wire connected to a Jump Node is still a normal device-side cable segment. The real non-Jump connector is the metadata authority for cable family, effective connector type, fiber mode, and default color.

This is symmetric:

```text
real output connector -> Jump
Jump -> real input connector
```

Both directions use the same real-connector derivation. The synthetic `jump-center` connector exists only as the portal landing point and must not force the visible physical wire to `jump`, `misc`, or fallback grey. Loaded projects with accidental Jump fallback metadata are repaired non-destructively at normalization time when the saved metadata is missing or clearly fallback-generated. Explicit custom wire colors still win.

## Selection And Hover

Hovering either paired Jump reveals the counterpart and the hidden gradient link without mutating selection. Clicking either paired Jump selects only that Jump ID in `SceneGraph.selectedIds`, stores the clicked member as `primarySelectedJumpId`, and keeps the paired Jump as a visual highlight rather than a selected object. The Inspector edits only the primary Jump.

Dragging keeps normal Engine object movement semantics. There is no special pair-move command in this iteration.

## Interaction Gesture

The whole visible circular Jump body is the pointer target. Pressing a Jump starts a transient `pendingJumpPress` state instead of immediately choosing selection, movement, or portal creation.

```text
pointerup before 5 px -> select and arm this Jump for movement
drag beyond 5 px while unarmed and eligible -> create Jump Link
drag beyond 5 px while explicitly move-armed -> move
drag beyond 5 px while ineligible for linking -> move
```

The 5 px movement tolerance is measured in screen pixels only to distinguish a click from a drag. There is no stationary long-press timer. A Jump becomes move-armed only when the user completes a direct click-release on that Jump; internal SceneGraph selection after wire creation, pair creation, undo/redo, inspector focus, or refresh does not arm movement. During Jump Link creation, target hit testing also accepts the whole visible Jump circle with a small screen-space tolerance before applying the existing output/input compatibility rules.

## Inspector

The Jump Inspector shows:

```text
Name
Role
Color
Connection Info
Paired With
Device-side Wire
Position
Jump to Pair
Disconnect Jump Nodes
```

Name edits update the raw `jumpNodes[].label`/`name` data and the synthetic `jump-center` label. Role and Connection Info are read-only. `Disconnect Jump Nodes` removes only the `jumpLinks[]` record; visible device-side wires remain, so derived output/input colors remain.

## Jump to Pair Navigation

`Jump to Pair` is a camera and selection action only. It selects the paired Jump as the primary Jump, refreshes the Inspector for that paired Jump, centers the camera on the paired Jump center, and preserves the current zoom. It does not move either Jump, edit the portal, create an undo entry, dirty the project, or arm the special Jump movement gesture.

## History

Each placement, rename, visible wire creation, Jump Link creation, disconnect, and delete operation is a normal Engine command. If deleting or rewiring a visible device-side wire invalidates a Jump Link, the removed link is captured in the same command payload so a single undo restores both the physical wire and the logical portal relationship.

## Save And Load

Project creation, load, save, export, output snapshots, and hosted publishing carry `jumpLinks[]` beside `jumpNodes[]`. Projects with no `jumpLinks[]` continue to load. Legacy `pairId` records are converted to runtime `jumpLinks[]` only when the paired Jump roles are unambiguous output/input; ambiguous legacy pairs stay as loaded Jump Nodes without silently inventing a portal.

## Play Wire

The Engine wire Inspector exposes `Play Wire` for a single selected physical wire. Playback is transient interaction geometry: it does not edit `connections[]`, `jumpLinks[]`, `jumpNodes[]`, command history, dirty state, selected wire geometry, route points, or device textures.

The path resolver expands either visible segment of a valid paired portal into:

```js
[
  { type: "wire", wireId: "wire-output-to-jump", reverse: false },
  { type: "teleport", fromJumpId: "jump-output", toJumpId: "jump-input" },
  { type: "wire", wireId: "wire-jump-to-input", reverse: false }
]
```

The tracer animates the first visible cable, instantly relocates from output Jump to input Jump, then animates the second visible cable. For ordinary non-Jump wires, the resolver returns one physical wire step.

## Portal Playback Teleport

`jumpLinks[]` is a logical portal relationship, not a physical cable. During Play Wire, the portal step is represented as `teleport`, not as a wire. The Bezier Jump Link reveal remains hidden unless the user is independently hovering/selecting the portal; it is never animated as physical cable playback and adds no route length.

## HTML Export

Self-contained HTML receives `jumpLinks[]`, derives the same output/input/neutral Jump colors, hides committed Jump Links in steady state, and extends its existing `Play Wire` path resolution with the same wire/teleport/wire sequence. Hosted viewer output follows this path when it renders the generated standalone HTML/project data.
