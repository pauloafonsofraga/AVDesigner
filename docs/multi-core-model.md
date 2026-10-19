# Multi-Core model: Phase 2

Implemented against `engine-prototype` baseline
`0d2de51601f953debda950457fe65a549a731afd`. This is a model and persistence
contract only. There are no insertion tools, new canvas objects, Multi-Core
editor, interactive cable endpoints, passive traversal or schedule rows.

## Ownership and schema

`src/engine/multiCoreModel.js` owns schema version **1**. A project may contain
`multiCores`, `multiCoreDefinitions` and `multiCoreIdCounter`. Absence is retained;
no empty collection is inserted into historical projects. Definitions use
`kind: "multi-core"`, `id`, `revision`, the existing name/brand/model/category/
description fields, trunk defaults, independent `ends.A` / `ends.B`, and circuits.
The optional definition collection is model data, not another library/database.

Instances have their own `id`, name, assemblyId, location, notes, definitionId,
definitionRevision and a detached `resolvedDefinition`. Live trunk/end/circuit
configuration is authoritative for the instance; a library update never merges
into it. The embedded snapshot retains the reusable source and provenance.
Unknown fields are retained. Instantiation copies source channels and ports;
their identity is scoped to the new aggregate/end, not globally reallocated.

Each end has its own stable instance `id`, `definitionEndId`, style, connectors,
faces, width/height, world x/y, manufacturer/model, notes and optional physical
or tail metadata. Styles are fanout, stage-box, rack-panel, wall-plate,
inline-breakout, custom-enclosure and generic. Style-only edits never change
connectors, circuits, mappings, reservations or the other end.

Ports use the existing connector vocabulary (`type`, `connectorType`,
`physicalType`, `signalDirection`, `displaySide`, local x/y, stable `anchors`).
Passive direction defaults to `bidirectional`. Gender, pinout, polarity,
mediaFamily/mediaSpec, physicalConstraints and physicalNotes are physical
metadata, not a new signal compatibility engine. Faces have stable IDs and
optional image, width/height and `portPlacements: [{connectorId,x,y}]` records.
Coordinates remain model units, never percentages. Detailed front/rear images
use the existing recognized `image` field and artwork storage/embedding pipeline.

## Correspondence and physical media

A circuit has `id`, `displayNumber`, `mediaFamily`, `mediaSpec`, `endAPortId`,
`endBPortId`, `administrativeState` and optional reservation/physical metadata.
The foreign key is the aggregate ID plus circuit ID; display number/order is
never a foreign key. Port references are scoped explicitly to ends A and B.
No pairing by label, position, index or sort order is permitted.

`fixtures/multi-core.mjs` provides the explicit 14-circuit reference product:
MC-001, 75 m, eight 12G-SDI coax, four Cat6A four-pair circuits and two OM4 duplex
circuits, FOH Rack Panel to Stage Box. Each duplex circuit has two stable strand
IDs. Coax core/shield, twisted pairs and fibre strands are physical metadata;
none creates a synthetic project cable or schedule row.

Administrative state is available/spare/disabled. Reservation is optional
authored data. Connectivity/occupancy is **not** persisted or derived here.
Validation returns separate mapping eligibility (`resolved`, `enabled`) and
diagnostics; these must not be copied into the canonical circuit record.
An enabled mapping is not a verified electrical path. Phase 3 must also check
project-wide identity diagnostics, actual cable occupancy and compatibility.

## Normalization, diagnostics and identity

Normalization is pure and idempotent. Safe absent-field defaults are schema 1,
kind, empty descriptive strings/circuit list, generic end presentation,
240x160 schematic dimensions, origin positions, empty faces/connectors,
bidirectional port direction, left display side, unknown gender, default
connector presentation anchors, Bezier/empty trunk route and available state.
Only an existing end/port/trunk gets presentation defaults. IDs, missing ends,
missing physical ports, physical length and ambiguous mappings are never invented.
Explicit malformed values are retained and diagnosed, not replaced with defaults.

Diagnostics have severity (info/warning/error), category, multiCoreId, path,
message and relevant end/endId/circuitId/portId. Errors cover invalid identities,
duplicate correspondence, missing/wrong-end references, non-finite geometry,
invalid counters, malformed strands and explicit media declaration conflicts.
Unknown physical details/styles/units and stale or missing definition snapshots
produce warnings. A missing/ambiguous mapped port remains referenced, but its
mapping is unresolved and disabled. Duplicate mappings disable all affected
circuits, including conflicts involving spare/disabled entries. No per-strand
fanout, connector mating, generic compatibility or routing logic is added.

`migrateMultiCore` is the migration entry point; version 1 has no historical
migration. Unsupported explicit versions remain opaque, including future end
shapes. Pure transformations refuse to rewrite them. JSON imports are the input
contract. Non-finite in-memory numbers are diagnosed; the existing strict output
serializer rejects them rather than silently producing repaired geometry.

Identity allocation occurs only through explicit allocation/creation helpers.
`allocateMultiCoreId` advances above both the supplied high-water and matching
IDs. It refuses malformed/exhausted counters, rather than wrapping or resetting.
Instantiation persists a project `multiCoreIdCounter`; child allocation persists
aggregate `idCounters` for circuit/port/routePoint/strand/face. Deletion must retain
these counters. Never derive IDs from names, labels, route samples or array order.
Imports with no historical counter cannot prove which already-deleted IDs once
existed; allocation scans extant IDs and then starts preserving a high-water mark.
No randomness or allocation occurs during ordinary normalization.

## Persistence and library boundaries

The classic shell preserves optional fields in file loading, project saves,
history snapshot/restore and clears them on New/old-project load. Unsaved-project
protection recognizes model-only documents. `projectAdapter` retains original
data and supplies a separate model snapshot, never scene devices/wires.
`ProjectMutationAdapter` retains these fields during unrelated edits and JSON
export, including its model-only reconstruction path. Historical clipboard and
interactive command behavior is unchanged.

The shell's ordinary snapshot follows existing Engine write-through ownership
using `multiCoreProjectFields(..., {cloneValues:false})`; history and output
boundaries detach their copies. This avoids repeatedly deep-cloning model data
when ordinary application code only needs a reference to canonical state.

Personal definitions use the existing registry, revision conflicts, provenance,
dependency collector and content-addressed artwork transaction. The typed
validator accepts Multi-Core products without pretending they have ordinary
device dimensions. `owner.multiCoreDefinitions()` provides model-level access;
`owner.library()`, `libraryContext()` and unscoped `nodes()` exclude those entries
until their UI is implemented. Cross-kind replacement of an existing ID is
rejected. Required connector/custom-node dependencies still use the existing
collector. Save/reload never requires fetching a definition from the network.

Project snapshots carry embedded definitions and the existing project node
library. Portable save compaction already retains these opaque model fields;
the artwork walker embeds their recognized image fields, including nested
snapshots, and reports missing required artwork. No new asset store is added.

Output scene version **5** adds optional `modelData`, a deeply frozen version-1
model envelope containing the exact persisted fields and diagnostics. It is
omitted for old projects. Renderable devices/connectors/wires, geometry, counts
and schedule semantics do not change. Output consumers retain the section but
do not render or interact with it. HTML/Publish serializes the same section;
PDF uses the same unchanged graphical primitives. Old self-contained viewers
retain their bundled contract; newly generated viewers use version 5.

## Validation and next phase

Dedicated Node tests cover the reference product, mappings and all requested
malformed cases, actual shell snapshot functions, typed personal storage,
portable artwork, output isolation, old fixtures and 8/16/32/64/256 channels.
`scripts/multi-core-persistence-smoke.mjs` exercises real Chrome file loading,
Save/download/reload, history restoration, model-only output, an offline HTML
viewer and clearing the collection when opening another project. Timing checks
are informational; no unsupported frame-rate claim is made for a model-only phase.

Phase 3 must introduce typed external endpoint resolution and passive edges,
derive connectivity from actual cables, and reject duplicate ownership at project
scope. It must not interpret `enabled` alone as occupancy or electrical approval,
create per-channel cable records, or use connector order for correspondence.
Future structural deletion/remapping needs explicit affected-cable validation.

## Verification record

Both starting local HEAD and fetched `origin/engine-prototype` were
`0d2de51601f953debda950457fe65a549a731afd`. Build/cache fingerprints now identify
**54.38.99 / Multi-Core Model**.

- Focused model/persistence tests: 44 passed.
- Complete Node suite: 1,374 passed, zero failed/skipped (22.3 seconds).
- All 16 `scripts/*-validation.mjs` validators passed.
- Generated output-viewer, PDF and Cable Schedule bundles checked current.
- Syntax checks passed for all 21 changed/new JavaScript files; the canvas
  validator also parsed the five inline application scripts.
- Real Google Chrome passed five acceptance groups: file load, actual Save and
  reload, history restore, HTML/Publish preparation plus offline viewer, and
  old-project/New isolation. Zero page errors or unexpected alerts.
- The existing personal-definition Chrome smoke also passed all six groups,
  including durable Device Editor duplication, two-tab revision conflicts,
  scoped node isolation and project download/reopen.
- Existing-scene and offline-viewer screenshots were inspected. No Multi-Core
  graphics or fabricated scene objects were introduced.
- Informational model timings include 64 and 256 circuits. These are model
  checks, not claims about future rendering performance.
- `git diff --check` passed. Unrelated local faceplates, Masters and backups
  were not staged or modified.

The preview validator passes but logs a non-failing `TextureCache.invalidateDevice`
asset-subscriber warning (`refCount` on an undefined entry). That renderer/cache
path is outside this phase and was not changed. Browser acceptance did not report
page errors. No manual PDF-reader navigation check was performed in this
model-only phase; existing PDF tests and bundle validation passed.

Changed-file groups: the new model module, reference fixture, two dedicated test
files, Chrome persistence smoke script and this document; shell/bootstrap and
personal-definition persistence; Engine project adapter/mutations and output
snapshot/contract boundaries; generated viewer bundle; four static-validator
fingerprints, three existing test harnesses, and bridge/renderer build identities.
No Legacy implementation, production routing, schedule or editor behavior was
changed.
