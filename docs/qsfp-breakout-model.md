# QSFP breakout model, version 1

Phase 3B.1 stores and validates breakout topology. It does not add canvas
objects, simulated links, a module picker entry, or report/Viewer presentation.
No existing factory device opts in.

| Where | Fields |
| --- | --- |
| Authored device or card connector | `cageCapabilities.breakoutModes` lists verified mode IDs. Existing supported form, rate, media, signal, and module restrictions also apply. Use the breakout cable type in `supportedModuleTypes` if a host explicitly declares that end. |
| Placed device | `breakoutPortModes: [{ connectorId, modeId }]`; a connector on an installed card uses its existing slot-scoped ID. An instance override cannot grant breakout support. |
| Project | Optional `breakoutAssemblies` collection of `{ schemaVersion: 1, id, source, modeId, cableType, length, channels, branches }`. `source` is the original `{ deviceId, connectorId, anchorId }` reference. |
| Channel | `{ id, lanes: [1], state }`; current modes use physical lanes 1 through 4 exactly once. IDs are local to the assembly, independent of array order. |
| Branch | `{ id, channelId, destination }`; destination is an existing device connector/anchor reference or explicit `null`. Each channel owns one permanently attached branch. |
| Length | Shared `{ value, unit }` (positive, e.g. `{ value: 3, unit: "m" }`); missing or null means unknown, not a canvas measurement. |

The modes are `qsfp-plus-4x10g` (QSFP+ to four SFP+ ends) and
`qsfp28-4x25g` (QSFP28 to four SFP28 ends). Cable types are
`breakout-<modeId>-dac` and `breakout-<modeId>-aoc`. They are not
point-to-point cable types. The assembly owns the integrated plugs; its cages
must not also have separately installed modules or wires.

**State:** Connected requires a destination. Unused and disconnected both
require null and retain their distinct authored states. Disabled can be
attached or unattached; an attached disabled end still reserves its socket.
The source cage is reserved even with no connected branches. A cage's anchors
do not create additional sockets.

**Import and editing:** Unverified imports are preserved without assigning a
mode, lane, anchor, or destination. Structural uncertainty or missing explicit
source support blocks authoring; unknown end qualification or physical length
can remain unverified on a structurally complete assembly. Known conflicts
are errors. For a retained assembly, source/mode and channel/branch mappings
are immutable; replace it explicitly instead of repurposing its IDs.

**Persistence:** Current Engine save/reopen, revision snapshots and topology
replay preserve records. Old non-breakout topology commands keep the same
dependency envelope; breakout-aware collaboration needs matching clients and
server. Older application builds are not lossless editors of new breakout
projects. Device-only clipboard copies preserve instance mode preferences but
do not duplicate an installed assembly. A WNX definition carries only host
capabilities, not attached project assemblies. Full assembly clipboard,
interactive undo/redo, canvas rendering, logical tracing, and reports are
deferred until there is an authoring workflow.
