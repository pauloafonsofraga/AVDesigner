# Adapter and breakout cable exit direction

Build 54.38.121, following the connector-marker rotation change in 54.38.120.

## Cause and fix

Connector anchors already rotated, but the external Bezier controls were always
horizontal. Even the small node-edge offset used an unrotated left/right side.

The scene now derives an outward unit direction from the selected physical
anchor's side and the adapter's existing rotation. The visible endpoint offset
and the first/last curve handles use that direction. A 90-degree adapter has
upward exits on its local left side and downward exits on its local right side.
Directions are derived at render time, not persisted in project or cable data.

- Curved routes retain their authored waypoints and deterministic sample counts.
- Orthogonal routing remains orthogonal; ordinary device routing is unchanged.
- Drawing and either-end rewiring previews use the same directions.
- Loom breakout curves apply direction only at the real adapter endpoint, never
  at a Loom gateway. Cached and drag-preview breakout geometry agree.
- Canvas, hit testing, output snapshots and bundled viewers share the curve.
- Connector IDs, anchors, device dimensions, rotation snapping and cable metadata
  are unchanged. Compact rack presentation ports do not inherit adapter rotation.

The output viewer and Cable Schedule bundles were rebuilt. The latter also
includes the shared wire-path module; its report behavior is unchanged.

## Verification

- Full isolated Node suite: 1,779 passed, no failures or skipped tests.
- All 16 repository validation scripts passed.
- Focused coverage includes every 15-degree angle, both cable ends, reversed
  cables, physical-anchor side overrides, drag offsets, manual waypoints,
  save/reopen, output model parity, drawing/rewiring and Loom previews.
- Actual Chrome pointer smoke exercised both adapter and breakout rotation at
  every supported angle, inspecting live cable exit alignment during rotation.
  Existing connector hit, selection, wiring, undo/redo, save/reopen and movement
  checks also passed.
- Actual PDF export succeeded and its rendered first page was inspected.
- HTML export and locally prepared Publish HTML opened with network access
  blocked; screenshots were inspected. Publish uploads/API calls were mocked;
  no hosted project or deployment was changed by this acceptance test.

Local verification logs: `/tmp/wirenexus-adapter-cable-exit-2026-10-21`.
Browser screenshots and exports:
`/var/folders/hq/kkzckjvn6h5_fpphh8y2ks3r0000gn/T/wirenexus-adapter-rotation-lLKgMg`.
