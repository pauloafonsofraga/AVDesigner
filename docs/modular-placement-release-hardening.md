# Modular Placement Ownership

Iteration 54.14.0 assigns every Device Editor placement-affecting operation to one runtime owner. Current-schema layouts are never repacked as a side effect of rendering or editing metadata.

## Ownership Matrix

| Operation | Owner |
| --- | --- |
| Single chassis-connector drag | Stable insertion drag session |
| Multi-selection, paired-network, and grouped connector drag | Composite insertion drag session |
| Installed card-slot drag | Stable insertion drag session with an atomic card interval |
| Add, fill, remove, duplicate, or placement-side-changing connector edit | Atomic structural-edit transaction |
| Faceplate-side promotion during a connector drag | Atomic structural-edit transaction |
| Card-slot creation, installation, replacement, removal, and span/kind fan-out | Atomic structural-edit transaction |
| Reusable card creation, duplication, deletion, connector add/remove, and connector-count change | Atomic structural-edit transaction when installed slots are affected; metadata edit when unused |
| LED output generation/count changes and Ethernet batch generation | Atomic structural-edit transaction |
| Device-height, generated face, and custom face-image resizing | Transactional resize session |
| Power Distro on/off and adapter/breakout origin changes | Atomic faceplate-origin mutation |
| Face image upload, replacement, removal, faceplate deletion, and restoration | Atomic faceplate-origin mutation |
| Has Swappable Cards off/on without deleting slot data | Nonstructural metadata edit |
| Connector captions, operational state, signal metadata, fiber mode, installed module, matrix membership, card overrides, technical specifications, defaults capture, and pair metadata | Nonstructural metadata edit |
| Device/card naming, coloring, and unused card definition edits | Nonstructural metadata edit |
| Save Default Configuration | Nonstructural snapshot; exact placement is captured unchanged |
| Reset to Default Configuration | Explicit configuration replacement; saved placement is restored unchanged |
| Device duplication | Exact configuration clone with new device identity |
| Apply Device Editor | Validation and persistence boundary; placement is verified, not repacked |
| Project save | Serialization only |
| Project load/import and V2 migration | Load/import/migration normalization |

## Normalization Boundaries

- `resolveEditorModularLayout()` is a pure resolver used for placement previews, fixed-point checks, height calculations, and renderer geometry. It does not mutate templates.
- `normalizeConnectorRows()` and `normalizeMixedDeviceRows()` remain only behind `validateDraftDefaults()` when `normalizePlacement` is enabled at explicit load/import/migration boundaries.
- Device Editor rendering, tab changes, metadata edits, instance-override hydration, Apply, defaults, and duplication pass `normalizePlacement: false` or avoid the normalizer entirely.
- Committed drag and structural results are applied directly, then checked against a fresh pure static resolution. A mismatch fails the transaction instead of silently repacking it.
- The former `normalizeCardSlots()` wrapper was removed after its final interactive callers were migrated.

## Removed Helpers

Repository-wide reference searches showed that these helpers had definition-only reference counts after the transactional migrations:

- `reorderCardSlot()`
- `shiftRowsAfterFaceChange()`
- `setEditorPowerDistroFaceHeight()`
- `ensureEthernetPair()`
- `normalizeCardSlots()`

They were removed. `reorderConnectorInDirection()` remains because it owns the special faceplate/adapter drop path, but it now delegates its commit to the atomic structural transaction.

## Consumer Contract

Engine canvas, Device Editor Engine preview, Legacy preview, and standalone viewer consume the same stable connector IDs, semantic sides, card-slot rows, installed connector IDs, and rebased V2 anchors. The standalone viewer retains a self-contained copy of the deterministic static resolver because exported files cannot import application modules; release tests execute that copy against the repository fixture and compare its geometry with Engine normalization.
