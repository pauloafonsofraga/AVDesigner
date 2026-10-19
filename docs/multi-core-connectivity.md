# Multi-Core Phase 3: Passive Connectivity

## Baseline and scope

Starting local and fetched `origin/engine-prototype` SHA:
`f26620e34b269147ec10381a0916db17f530cb91`.
This preserves the approved Phase 2 model at `a0ae5b2`, the subsequent SFP28
implementation, and the imported factory library. Build: **54.38.102 / Multi-Core
Connectivity**. Project model schema remains **1**; output scene remains **5**.

No insertion tool, editor, canvas ports/trunk, termination artwork, hit testing,
PDF graphics or Cable Schedule UI was added. No Legacy renderer or routing
implementation was changed. Two shared shell cleanup filters now retain
model-only cable references instead of treating them as missing canvas objects.

## Audit findings

- A physical external cable is represented in `state.connections`. Ordinary
  Jump legs may be multiple records for one physical reporting cable.
- An endpoint identifies a real owner/connector. Rack patch metadata is a
  presentation alias for an existing device connector, not a new electrical port.
- `groupedCables()` and `resolvePlayableSignalPath()` implement existing ordinary
  Jump cable grouping. They are unchanged; Multi-Core edges do not enter them.
- The existing `signalChainForWire()` returned a cable row with two terminal
  descriptions, not a general device-routing graph. Phase 3 adds a typed path
  extension, rather than replacing that consumer contract.
- Actual matrix routes use explicit input/output assignments. Adapter internal
  drawings are not generic authorization to traverse arbitrary device ports.
- Engine scene normalization needs renderable endpoint owners. Multi-Core cables
  therefore remain in canonical project/model data but are skipped as scene wires
  in this phase. No duplicate/fake device or connector is created.
- Existing Save/history boundaries preserve raw connection records. The
  scene-only mutation fallback needed the original model-only records as well;
  it now reads them from the optional connectivity snapshot.

## Endpoint contract and identity

```js
{ kind: "multi-core-port", multiCoreId: "mc-1", endId: "mc-end-2", connectorId: "a-91" }
```

`kind` may be omitted for the Phase 2 proposed reference shape. Mixed owner fields
and wrong kinds are malformed, not converted to ordinary device references.
The lookup key is a JSON tuple of kind/aggregate/end/port. Labels, display numbers,
faceplate coordinates and collection order never participate in identity.

`resolveMultiCoreEndpoint(project, reference, { snapshot })` reports validity,
status, stable key and resolved endpoint details. Missing aggregates, ends,
ports, wrong-end ports, unsupported schemas, ambiguous IDs, disabled circuits
and incompatible/unresolved channels are explicit outcomes. Invalid references
and cable IDs remain unchanged in canonical data.

The ownership index includes devices, rack definitions and scoped rack devices,
Jump Nodes, LED surfaces, areas, image objects, comments, title blocks, Multi-Core
aggregates and ends. A conflicting aggregate/end identity disables affected
connectivity. Duplicate ordinary owners/connectors, card definitions and cable
IDs cannot silently select an array-order winner. Ports and circuits may reuse
local IDs in different, uniquely identified Multi-Core instances.

## Physical policy and eligibility

The implementation reuses Engine connector type, fibre, cage/module, operational
status and signal-direction rules. A narrow Multi-Core physical check adds known
gender, physical connector, media/signal family, required specification, pinout,
polarity and physical-constraint comparisons. Metadata is not inferred from
display labels. Missing fibre information is not upgraded to verified single-mode
merely because that is the renderer's default.

Optional existing wire metadata `physical.ends.from/to`, when authored, describes
the **mating plug at that end**, not the socket on the remote device. No required
persistent fields were added. Two female termination sockets do not fail a
gender comparison against each other: an intervening patch cable has its own
terminations. Known contradictory mating facts reject validity; missing facts
are allowed with `physical-unknown` diagnostics. Unknown pinout and polarity
are never claimed as verified.

A channel requires a supported, valid Phase 2 aggregate, explicit bijection,
unambiguous owners/ports, permitted administration, single occupancy per port and
no known physical incompatibility. `mappings.enabled` is not used as electrical
truth: a **spare** circuit can still carry a valid connection. Invalid Phase 2
aggregate mappings disable that aggregate's passive edges, rather than guessing
which mapping was intended. Known failures discovered after structural validation
produce `incompatible`; structural failures take `unresolved` precedence.

Derived state precedence:

1. `unresolved`: invalid/missing/ambiguous mappings or attached references,
   duplicate occupancy or duplicate cable identity.
2. `disabled`: administrative state disables this circuit.
3. `incompatible`: known physical or directly attached equipment conflict.
4. `connected-both`, `connected-a`, or `connected-b`: actual external occupancy.
5. `reserved`: reservation exists but neither end is occupied.
6. `unused`.

Administration and reservation remain separate fields. Per-port occupancy records
have capacity 1 and retain every offending cable reference. Neither duplicates
nor unresolved imports are deleted. Complete paths additionally validate terminal
equipment and device/cable boundaries across Jump relationships. No cached
occupancy or passive wire is persisted into the project.

## Graph and Signal Chain

`createMultiCoreConnectivity(project, { getConnector, onStage })` creates a detached,
deeply frozen JSON snapshot. It includes owner diagnostics, endpoint and aggregate
indexes, channels/occupancy, original cable records with resolution results,
typed edges and adjacency. Internal Maps are private implementation details, not
output fields. Repeated path lookups reuse a WeakMap-backed index.

```js
{
  kind: "multi-core-passive-channel",
  key: '["multi-core-passive-channel","mc-1","c-a1"]',
  multiCoreId: "mc-1", multiCoreName: "MC-001",
  circuitId: "c-a1", displayNumber: "01",
  endAPortKey: "...", endBPortKey: "...",
  endA: { kind: "multi-core-port", multiCoreId: "mc-1", endId: "mc-end-2", connectorId: "a-91" },
  endB: { kind: "multi-core-port", multiCoreId: "mc-1", endId: "mc-end-3", connectorId: "b-41" },
  length: 75, lengthUnit: "m", strands: []
}
```

Other edge kinds are `external-cable` and `jump-link`. Cable IDs, Jump-link IDs,
and aggregate/circuit tuples remain their distinct identities.

`traceMultiCoreSignalPath(snapshot, wireId, { reverse })` walks both ends of a
starting cable. Returned segments carry traversal orientation (`A-to-B` or
`B-to-A` for channels), external cable IDs, terminal references, length sources
and diagnostics. One-sided channels reach the opposite open termination with
`partial: true` and an `open-termination` warning. They do not invent a device
destination. A visited-edge set stops explicit cycles deterministically; ambiguous
branches stop with an error. A Jump facing an invalid attached cable reports
`blocked-cable`, not a valid open termination. No arbitrary recursion-depth cutoff
is used.

Normal Jump pairs compose as separate typed relationships. Loom-owned/waiting
Jump continuations are explicitly blocked with `loom-jump-not-passive`, not
reinterpreted as ordinary passive cable links. Existing Loom/Jump roles, visuals,
portals and normal grouping remain untouched. Duplex fibre remains one circuit
with two unchanged strand IDs; no strand cable or polarity swap is generated.

Matrix and adapter ports are traversal boundaries in this extension. Their
existing assigned routing/drawing APIs remain unchanged; no implicit input/output
cross-connect is added. Rack patch aliases resolve to their real device endpoint,
without extra graph edges.

`buildCableSchedule()` associates one connectivity snapshot with its returned
rows when Multi-Core data/references exist. `signalChainForWire()` retains the
existing row-shaped result and adds **`path`** for affected chains. Its optional
third argument accepts an explicit `connectivity` snapshot (including a restored
JSON snapshot) and `reverse`. Connector and patch-port queries carry the same
extension. Existing `wireIds` still describes one physical reporting row;
`path.externalCableIds` describes the expanded logical path. Ordinary results
remain unchanged, including in a mixed project.

The existing two-terminal Signal Chain diagram has not been redesigned to draw
these segments. Phase 3 exposes them through the model/runtime API only.

## Counting, lengths and persistence

The reference fixture has 14 channels, **one trunk assembly**, and two patch
cables on Channel 01. It produces two Cable Schedule rows, one occupied channel,
and one path with three segments. It creates zero synthetic `state.connections`
records. Patch lengths remain `3 m` and `2 m`; trunk length remains `75 m`.

`lengthSources` provides context without assigning a total or overwriting any
length. Ordinary Jump legs can repeat the metadata of a single physical cable;
consumers must respect existing cable grouping, not blindly sum every leg.

The optional version-1 `modelData.connectivity` extends the existing version-1
model envelope in output scene version 5. It is omitted for historical projects
without Multi-Core fields/references. HTML/Publish carries the same self-contained
JSON; PDF and viewer render primitives are unchanged. The renderer intentionally
skips Multi-Core external cables until renderable endpoints exist in a later phase.
They remain in Save, history, adapter projectData and the model snapshot, including
missing-owner/port references and opaque future-schema records.

## Measurements

Node v24.4.1 on this Mac. Milliseconds, median of five samples after one index
warmup. Every channel has two patch leads; 1,000 lookups reuse the same index.
These are measurements, not future UI/frame-rate guarantees. Total index includes
JSON detachment/freezing and other graph bookkeeping.

| Channels | Patch cables | Validation | Endpoint index | Occupancy | Passive edges | Total index | Single lookup | 1,000 lookups |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 16 | 0.271 | 0.130 | 0.285 | 0.131 | 1.029 | 0.072 | 25.834 |
| 16 | 32 | 0.327 | 0.199 | 0.558 | 0.170 | 1.566 | 0.061 | 25.797 |
| 32 | 64 | 0.519 | 0.339 | 0.775 | 0.296 | 2.690 | 0.078 | 25.858 |
| 64 | 128 | 0.984 | 0.648 | 1.683 | 0.639 | 5.228 | 0.104 | 28.930 |
| 256 | 512 | 3.658 | 2.470 | 7.689 | 2.480 | 20.313 | 0.298 | 36.380 |

Reproduce with `node scripts/multi-core-connectivity-performance.mjs`.

## Verification

- 86 dedicated model/connectivity/persistence tests passed, covering the requested
  A-Z cases, typed Signal Chain, ordinary Jump composition, duplicate ownership,
  fibre/gender/media faults, card ambiguity, history add/remove/rewire/undo/redo,
  preserved missing references and JSON snapshot traversal.
- Full Node suite: **1,424 passed**, zero failed/skipped.
- All **16** existing static validators passed. Output viewer, Cable Schedule and
  PDF bundle reproducibility checks passed. Existing inline script syntax checks
  and `git diff --check` passed.
- Historical fixtures compare ordinary Signal Chain results, physical report
  rows and rendered output fields before/after adding unused Multi-Core data.
  Coverage includes ordinary devices/Jump pairs, LED, racks, assigned matrix
  routes, mixed-media Looms, Loom-owned/waiting Jumps and dedicated Loom Portals.
- Real Google Chrome passed **seven acceptance groups**: authored file load;
  actual Save/download/reload; complete/partial history restore; unresolved-port
  save/reload; Jump composition/counts; historical fixture isolation; shared
  HTML/Publish preparation and offline viewer with all network requests blocked.
  Zero page errors and unexpected alerts. Both screenshots were inspected.
- Chrome screenshots: `/tmp/wirenexus-multi-core-connectivity/historical-engine.png`
  and `/tmp/wirenexus-multi-core-connectivity/offline-model-contract.png`.
  The historical fixture deliberately contains placeholder artwork. This is not
  graphical Multi-Core acceptance; no Multi-Core visuals exist in Phase 3.
- No hosted Publish deployment or manual PDF-reader navigation test was performed;
  the shared output preparation, offline contract and existing PDF tests were used.
- The passing Engine preview validator still logs the previously documented
  `TextureCache.invalidateDevice` asset-subscriber warning (`refCount` on an
  undefined entry). This pre-existing renderer/cache issue is outside Phase 3;
  the Chrome acceptance run produced no page errors.

## Changed files and review boundary

New files: `src/engine/multiCoreConnectivity.js`,
`fixtures/multi-core-connectivity.mjs`, `test/multiCoreConnectivity.test.mjs`,
`scripts/multi-core-connectivity-performance.mjs`,
`scripts/multi-core-connectivity-smoke.mjs`, and this report.

Updated integration files: `src/engine/cableSchedule.js`, `projectAdapter.js`,
`projectMutations.js`, `outputSnapshot.js`, `outputSceneSnapshot.js`;
`src/factoryCatalogueBootstrap.js`, `index.html`; existing persistence/bootstrap
tests. Build/cache fingerprints were updated in the shell, bridge, renderer and
four validators, and both affected generated bundles were regenerated.

Unrelated faceplates/artwork, `Masters/`, backups and PDF probe files remain
untouched and unstaged. The final commit and matching pushed remote SHA are
reported with delivery; this document is part of that commit.

**Stop after Phase 3 for architectural review.** Phase 4 still needs a decision
on endpoint presentation/editor interactions and how the Signal Chain UI should
display typed passive segments/diagnostics. Future editing must use the validity
result before assigning a cable, and explicitly handle affected cables during
structural deletion/remapping. No Loom teleportation, strand breakout or generic
device/matrix traversal was smuggled into this foundation.
