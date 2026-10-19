# Multi-Core Phase 4.1: Production Source and Edit Validation

## Baseline and scope

Started on `engine-prototype`; local HEAD and freshly fetched remote HEAD both
equaled `14fe5a931f07bf8c9a558c43a6facdfed765ea38`. No reset, rebase or rollback.
Build: **54.38.106 / Multi-Core Validation**.

This phase adds no Multi-Core Editor, graphics, remapping UI, rack docking,
teleportation, strand fanout or Cable Schedule changes. Legacy is untouched.
The newer card shared-bus implementation and tests remain unchanged; changes
to `index.html` are build/cache metadata only. Unrelated local faceplates,
Masters, artwork, backups and untracked PDF probes are not staged or edited.

## Production reference

`src/engine/multiCoreReferenceDefinitions.js` now owns
`hybridMultiCoreDefinition()`. The canvas imports it directly. The test fixture
imports/re-exports it and retains only project/reference/stress helpers.
Dependency direction is production source -> fixture consumer, never the reverse.
There is no new catalogue, schema, registry, asset store or loader.

The complete JSON definition has the same SHA-256 as the committed pre-move
function, including property order and normalized connector metadata:

`7ba53e2f706e528fd968c2a00d6d6849aaa649dd1143ad0fa3074fb9f90cda0f`

Identity remains `mc-def-7e2`, revision `hybrid-14-r1`, name `Hybrid Multi-Core`,
model `Hybrid 14`. All 14 circuit IDs, 28 port IDs, explicit A/B mappings,
manufacturer/model metadata, two strands per duplex circuit, rack-panel/stage-box
styles and 75 m trunk remain identical. Calls return independent definitions;
existing embedded project instances do not depend on the new source location.

The only inappropriate production dependency found was the direct import in
`multiCoreCanvas.js`. Automated esbuild graph inspection covers productionBridge
and the normal catalogue bootstrap, with zero fixtures/test/scripts inputs.
A separate test copies only `src/` and package module metadata to a temporary
directory and actually imports the reference and canvas there. Chrome also
boots with fixtures/test/scripts URLs blocked and places the production reference
from an otherwise empty definition library, without requesting those paths.

## Pure transaction boundary

`src/engine/multiCoreEditValidation.js` exports:

```js
validateMultiCoreEdit(beforeProject, afterProject)
validateMultiCoreEdit(beforeFields, afterFields, { project: canonicalProject })
```

The second form is used by `commitMultiCoreEdit()`. It overlays detached
Multi-Core fields on the project solely for validation, retaining access to
external cables and global owner identities. No normalized value is written back.
Field-only transactions cannot expand their write scope to external cables or
other project records.

The result contains `valid`, `structural`, `affectedMultiCoreIds`, `diagnostics`,
`introducedDiagnostics`, `inheritedDiagnostics`, `resolvedDiagnostics` and
`blockingDiagnostics`. The bridge keeps its boolean return contract and exposes
the structured result through `lastMultiCoreEditValidation`, plus an existing
error notification on rejection. The helper has no DOM, Inspector or gesture
dependency and is available for the future editor.

Diagnostic matching is a multiset, keyed by code/category, severity, aggregate,
end, circuit, port, cable, reference, rule and identity-qualified field path.
Array indices are replaced by authored IDs wherever present. Presentation names
and message wording do not participate. Malformed records without IDs retain
their positional context rather than receiving fabricated identities.
Global ownership diagnostics use sorted owner sets; the older model's
later-owner duplicate-end diagnostic is keyed by the conflicting end ID.
Physical mapping errors also carry the incompatible attribute, so a newly
incompatible polarity cannot hide behind an inherited media-specification error.
Model diagnostics receive an additive stable `code` equal to their category;
existing message/category/path fields remain available to all consumers.

## Acceptance and connection impact

- Accept coherent edits that add no new errors, including repairs of unresolved
  mapped ports, valid geometry changes and disconnected/unassigned edits.
- Preserve inherited diagnostics; unrelated invalid aggregates do not block an
  edit. Warning-only unknown physical metadata is not an incompatibility.
- Reject new duplicate identities, mappings, missing/wrong-end ports, invalid
  geometry, physical incompatibility and ownership conflicts.
- Preserve future-schema records byte-for-byte, including unknown fields. They
  cannot be edited, deleted or silently downgraded; no migration bypass exists.
- Run the existing Phase 3 resolver on structural before/after snapshots. Check
  endpoint validity, compatibility, derived occupancy and channel eligibility.
- Block removing/renaming assigned aggregates, ends, ports, circuits or strands;
  changing their existing A/B correspondence; disabling assigned channels; or
  invalidating a valid cable/channel. A truly missing mapped port can be repaired
  without changing the cable's typed reference.
- External cable data is never removed, renumbered, rewritten or generated by
  these edits. No automatic disconnect/remap workflow is introduced.

On rejection the bridge never calls begin-commit, apply-fields, scene refresh,
selection update or record-command. On success it creates one command containing
detached validated before/after snapshots. Even a caller retaining and later
mutating its draft cannot alter history. Undo/redo applies stored snapshots
without revalidating, migrating or normalizing canonical data.

## Geometry and performance

Geometry-only changes are recognized by their actual fields, not an arbitrary
operation label. They include end x/y, trunk route points/style and the route-point
identity counter. They still receive model/geometry diagnostics, but do not build
the passive graph. The existing native end/assembly/route DragSession preview
and constrained positional writeback are unchanged. No validation, normalization,
Cable Schedule rebuild or passive graph build was added to pointer frames.

`node scripts/multi-core-edit-performance.mjs` measures five warm-ups and 30
samples for each operation, with two external patch leads, on Node v24.4.1:

| Channels | Geometry median / p95 | Structural median / p95 | Rejected median / p95 |
| --- | --- | --- | --- |
| 8 | 1.72 / 2.04 ms | 3.44 / 3.85 ms | 3.42 / 3.69 ms |
| 16 | 3.05 / 3.20 ms | 5.96 / 9.08 ms | 5.69 / 5.97 ms |
| 32 | 5.47 / 5.76 ms | 11.01 / 12.14 ms | 10.69 / 11.07 ms |
| 64 | 11.19 / 11.63 ms | 21.60 / 23.36 ms | 21.09 / 22.52 ms |

These are informational machine-local validation timings, not performance SLAs.
The largest case is a short commit-time main-thread cost (over one 60 Hz frame),
not a per-frame dragging cost. Model diagnostics examine the Multi-Core envelope;
the whole-project connectivity resolver runs only for structural commits because
owner collisions and external cable dependencies can cross aggregate boundaries.

## Verification

- Full Node suite, including Phase 2/3/4, new transaction/import tests,
  personal definitions, device duplication/layout, Loom/Jump, snapshots,
  HTML/Publish and PDF/vector tests: **1,499 passed, zero failed/skipped**.
- All 16 static validators pass. Output Viewer bundle regenerated and its
  reproducibility validator passes. PDF and Cable Schedule bundles remain current.
- Nine changed/new JavaScript files pass syntax checks; inline script validation
  and `git diff --check` pass.
- Real Chrome: 17 Multi-Core acceptance checks, zero page errors. Production-only
  bootstrap/picker, cancellation/placement, patch leads, independent A/B movement,
  assembly movement, route add/drag/remove/reset, route style, undo/redo, mixed
  selection, delete protection, actual Save/reopen, Signal Chain, invalid API
  transaction rejection, offline/hosted output and PDF toolbar download.
- Rejection checks assert unchanged canonical project, history count/index,
  scene object identity and selection. Unit coverage also checks exact undo/redo,
  escaped-draft isolation, reordered diagnostics, opaque schemas and malformed
  historical endpoint/cable records.
- The Phase 3 reference path retains circuit `c-a1`, exactly two external cable
  records, existing cable numbers/endpoints, and independent 3 m / 75 m / 2 m
  length sources. Cable Schedule remains two rows; no synthetic cable is created.
- Existing personal-definition Chrome smoke: six checks including actual
  Duplicate Device registration, factory isolation, persistence, export/reload
  and two-tab IndexedDB conflict handling.
- Existing card shared-bus Chrome smoke: all 11 checks pass unchanged. Loom
  creation priority: 18 checks. Unified Loom/Jump, Jump link persistence and
  Phase 3 Multi-Core connectivity browser regressions also pass.
- Live/Output Viewer/offline HTML/simulated Publish wire polylines match exactly;
  both ends and one trunk remain schematic. Screenshots of the main canvas,
  offline viewer and rendered vector PDF were inspected.
- Actual Multi-Core PDF: two pages, drawing contains 8,261 vector paths,
  836 text operations and zero raster images. Both ends and 75 m label survive.
  Existing production PDF generator and pypdf inspection: 23 cases pass.
- Publish was simulated at an HTTPS origin, not uploaded to a real hosted account.
  No Safari/Firefox, real hosting upload or manual PDF link-click acceptance is
  claimed by this phase. PDF navigation code is unchanged.

The first new smoke assertions were corrected to scope the picker selector to
its own dialog and to compare rejected edits against the reopened canonical
cables, not serialized empty Loom defaults. The expected stale-bundle validation
failure was resolved by rebuilding the Output Viewer. No production assertions
were disabled and no unrelated tests were weakened.

## Changed files

Production: `multiCoreReferenceDefinitions.js`, `multiCoreEditValidation.js`,
`multiCoreCanvas.js`, and the additive diagnostic code in `multiCoreModel.js`.
Fixture: `fixtures/multi-core.mjs` imports the production definition.
Tests: `test/multiCoreEditValidation.test.mjs`,
`test/multiCoreProductionDependencies.test.mjs`,
`scripts/multi-core-canvas-smoke.mjs`, `scripts/multi-core-edit-performance.mjs`.
Build metadata only: `index.html`, `src/engine/productionBridge.js`,
`src/engine/renderer.js`, and four existing build-aware static validators.
Generated: `src/engine/generated/outputViewerBundle.json`.
Documentation: this file.

Stop after this Phase 4.1 commit for review. Phase 5 is not implemented.
