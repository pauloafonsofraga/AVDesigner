# Persistent Chassis Lanes

Build 54.36.5 adds an explicit sparse authoring contract. The existing absolute,
compact-card and structural solvers keep their public behavior.

## Ownership

- Ordinary chassis connectors store a nonnegative integer `rowIndex`.
  `y = connectorStartYForTemplate(template) + rowIndex * SLOT_HEIGHT`.
- Valid authored rows win over stale Y during editor normalization. Definitions
  without rows derive them once from their existing resolved Y. Anchors move with Y.
- A rigid shared bus stores its reserved lane on each member; its existing local
  member offsets remain authoritative within that interval. No individual member
  is quantized or separated while the relationship is active.
- Faceplate-side and adapter-centre placement remain separate. Reusable cards
  retain their card-local coordinates; generated connector IDs are unchanged.
- No empty items are synthesized to represent gaps. Rendering remains read-only.

## Resolution

`createPersistentModularLayoutSession` isolates a frozen scalar baseline.
`resolvePersistentModularMove` reserves the selected profile at its exact target,
then traverses stationary side sequences in the drag direction. Only collisions
and their ordering dependencies move. Traversal stops displacing items at the
first compatible gap. Upward repair that would cross lane zero falls back to a
downward ordered repair. Every result is validated before return.

Work is bounded by item/reservation count, not lane distance. Both-side items
participate in both tracks; cards and shared buses occupy full intervals.
Selections retain their relative offsets. Repeating a snapshot/target is exact.

`resolvePersistentStructuralEdit` reuses structural validation and collision
repair with vacancy compaction disabled. Existing card-drag authoring remains
compact; installing, removing or editing a card does not compact chassis rows.

The editor keeps its pointer-down camera frame, a minimum 12-screen-pixel lane
step, and two-pixel hysteresis. Far pointers clamp to current capacity plus the
next extension boundary. Preview dimensions remain locked; release recalculates
content height from actual occupied extent, existing artwork requirements, and
the explicit manual minimum. Middle deletions preserve gaps; unused tails shrink.
Undo/redo restores complete placement transactions; cancellation writes nothing.

## Regression Coverage

`fixtures/persistent-chassis-lanes.mjs` contains 16 inputs, four outputs, a network
pair, a both-side connector, a multi-lane installed card and a trailing node.
LOOP 1 moves from 2 to 10; LOOP 2 moves from 3 to 14. Input lanes 0-15 remain fixed.
Deleting IN 5 leaves lane 4 empty, and removing the tail shrinks only unused height.

`test/persistentModularLayout.test.mjs` covers exact maps, frozen snapshots,
directional repair, multi-selection, structural changes, deterministic replay,
600 seeded mixed-side layouts and a 160-item layout with large gaps.
`test/deviceEditorUiPreview.test.mjs` exercises persisted rows and editor history.

`scripts/device-editor-persistent-lanes-smoke.mjs` uses real Engine pointer and
keyboard gestures at Fit, checks preview/commit parity, tabs, types, cancellation,
undo/redo, deletion, Apply/reopen, duplication, library download/rehydration and
project save/reload. Existing append, native-drop, shared-bus and integration
browser suites continue covering Engine and Legacy previews, cards, PD artwork,
faceplate handoffs, adapters and offline geometry parity.
