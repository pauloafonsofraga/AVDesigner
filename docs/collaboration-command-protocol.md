# Phase 6.1: Device command protocol

This is a local preparation layer, not real-time collaboration. No transport,
subscriptions, backend, Supabase migration, entitlements, registration or deployment
is added. Local Engine mutations and history remain the source of truth.

## Coverage and integration

The production bridge records ordinary device library creation/duplication,
deletion, pointer-up movement, Inspector position/property/lock commits and adapter
rotation. Existing history commands carry protocol device IDs so their Undo/Redo
records the resulting inverse/forward edit with a new command ID. Related cable
route changes, cable removal/restoration, Jump attachment positions and Jump-link
cleanup/restoration are captured as effects of these device transactions.

Recording occurs at committed Engine boundaries, not pointermove. Selection,
camera, canceled/no-op gestures, Inspector previews and Device Editor drafts stay
local and produce no command. The existing single-user mutation and history paths
are not replaced by replay. Protocol recording errors are exposed by
`bridge.getDeviceCommandProtocol().error` without blocking existing editing.

## Version 1 envelope

Every command contains `version`, a UUID `commandId`, a UUID load `sessionId`,
`type`, `origin`, `affected` and `changes`. Types are `device.create`,
`device.delete`, `device.move`, `device.properties` or a mixed `device.transaction`.
Origin is `edit`, `undo` or `redo` and describes provenance, not authorization.

Each affected entity is addressed by collection plus its existing stable ID;
never an array offset alone. A change records `expectedRevision`, resulting
`revision`, exact JSON `before`/`after` values and insertion indices. Null means
absent; deletion retains a tombstone revision. An update increments its entity
revision once per transaction. Existing device/connector/cable identities are not
renamed. Creation IDs are allocated by the established Engine path and captured
verbatim; replay never allocates IDs or reruns placement, snapping or numbering.

Payloads contain only changed entities, not the entire project. Version 1 uses
full before/after values for each changed entity to make validation and replay
explicit. Embedded per-device artwork can therefore make commands large; this
must be bounded/asset-referenced before a future network protocol is enabled.
Unchanged templates, libraries, selections and camera state are not transmitted
or included as project snapshots. There is currently no transmission at all.

## Replay and validation

`replayDeviceCommand(project, command, state)` returns a new project and replay
state. All preconditions are checked before returning an accepted result. Inputs
remain untouched on failure. Exact before-value checks catch intervening edits
even when the local numeric revision has not observed an unrelated operation.

The same command ID and contents are idempotent. Reusing an ID for different
contents, stale entity revisions/content, a different session, malformed identities,
invalid property types/geometry, mismatched affected sets and unsupported intent
are rejected. Cycles, executable values, unsafe keys and nonfinite numbers are
rejected. Optional undefined object fields are omitted exactly as in JSON saves.
Known structural device changes are rejected; ordinary property edits cannot
silently replace connectors, templates or modular cards. Cable effects cannot
rewire endpoints. Deletion may not leave cables or attached Jumps pointing to a
removed device; restored cables/links must reference existing endpoint owners.

These are protocol/precondition checks, not a replacement for future server-side
workspace authorization, compatibility, occupancy and full topology validation.
The future server must validate the trusted dependency state and all domain rules,
not trust client-supplied before/after images or origin fields.

## Persistence and deliberate limitations

The bounded journal is diagnostic, available through
`bridge.getDeviceCommandProtocol()`. Its retention follows existing history limits;
it is not a durable outbox or a complete event log. Entity revisions and operation
receipts belong to the current in-memory session. A project refresh/reopen starts
a new session. No protocol metadata is inserted into `.avd` or saved definitions.
Receivers start with the same session baseline and replay-state revision map.

Wire-only edits, Device Editor definition/card commits, rack transactions,
clipboard transactions, layers and specialized canvas objects are not standalone
protocol operations in this phase. A mixed workflow cannot be reconstructed solely
from this device journal; missing prerequisites correctly cause stale-content
rejection rather than implicit merging. Globally collision-resistant object ID
allocation, durable project identity/revisions, dependency revision vectors,
selective collaborative undo and server validation remain subsequent design work.
This implementation does not claim to prepare those stages automatically.

## Verification

`node --test test/deviceCommandProtocol.test.mjs` exercises deterministic replay,
duplicate handling, stale sessions/revisions, malformed commands, deletion safety,
collection order, Jump/cable effects, Undo/Redo and JSON save/reopen compatibility.

`node scripts/device-command-protocol-smoke.mjs` runs Chrome against the full Engine:
actual drag preview/cancel/commit, Inspector edits, device creation/deletion, history,
independent replay equality and local Save As/reopen. Configure
`AVDESIGNER_BASE_URL` for the local server when needed.

Validation also includes the full repository test suite and 16 static validators,
plus existing Chrome history-memory, card-safety and adapter-rotation workflows.
The adapter workflow exercises save/reopen and HTML/PDF export without adding
protocol state to those outputs. No collaboration or server deployment is tested
or enabled by this local phase.
