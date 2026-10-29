# Phase 6.2: Deterministic topology transactions

This extends Phase 6.1 locally. It adds no networking, Supabase synchronization,
registration changes, backend service, migration or deployment. Existing Engine
mutations and history remain responsible for single-user editing.

## Protocol v2

`createTopologyCommand(before, after, {state, commandId, intent, origin})` produces
one serializable `topology.transaction`. All object IDs, connector references,
card/slot identities, Loom anchors, Multi-Core channel mappings and allocated
counter values come from the committed edit. Replay never allocates replacements,
reruns placement, consults selection/camera state or guesses array offsets.

Each command includes:

- A protocol version, session UUID, operation UUID, bounded intent and edit/undo/redo origin.
- Changed entities with exact before/after JSON, collection-qualified identity,
  expected revision and resulting revision. Deleted entities keep tombstone revisions.
- An exact affected-entity list, including explicit cable cleanup and ownership effects.
- Stable-ID collection order/presence changes for insertions, deletions and reorders.
  Numeric array positions are not part of the v2 command protocol.
- Dependency guards containing scope revisions and SHA-256 hashes of the baseline
  topology collections and modeled settings, including definitions and number counters.

The current read set is deliberately conservative: changes anywhere in a guarded
scope cause a stale-revision rejection. It does not yet merge independent concurrent
edits. Targeted dependency read sets and production payload/performance limits are
future work, not silently assumed in this phase.

`replayTopologyCommand(project, command, state)` returns new project/state values.
Validation happens on a detached candidate before returning an accepted result.
Neither input changes on stale dependencies, malformed effects or topology failure.
Identical retries are idempotent; reusing an operation ID for different content fails.
Phase 6.1 commands remain supported through this API and receive transition validation;
the original Phase 6.1 replay API is unchanged.

## Existing validation reused

`projectTopologyValidation.js` uses the normal Engine project adapter and SceneGraph,
connector compatibility/module and DAC rules, external-port occupancy indexes,
connector topology/exclusive-group validators, Jump pairing validation, modular-card
replacement safety, Loom normalization/Jump ownership checks, Multi-Core connectivity,
gateway diagnostics and Multi-Core edit validation.

Raw reference/identity checks run alongside normalization so a candidate cannot be
accepted merely because normalization dropped or repaired its broken data. Missing
ports/anchors, incompatible cable types, occupied/exclusive connectors, ambiguous
pairings, dangling attachments, missing cards, invalid slot IDs, Loom membership or
portal errors and conflicting Multi-Core gateway claims are rejected.

Card replacement with connected ports must retain valid cables or explicitly include
their cleanup in the same transaction. Explicit rewiring/removal is validated against
the final graph; it is not implicit validator cleanup. Multi-Core transactions likewise
validate the final external wiring and declared mapping changes together.

Unchanged historical topology defects are retained using diagnostic deltas; new
diagnostics are blocked. Existing opaque Multi-Core protection remains active. This
does not migrate, repair or discard old `.avd` records or claim undocumented hardware
rates have been verified. Server authentication/authorization is still future work.

## Engine integration

`beginProductionCommit` and `markCommitted` capture committed topology transitions.
Existing history replay supplies undo/redo provenance but retains its current behavior.
Device Editor card/definition Apply supplies its explicit pre-Apply snapshot because
the shell may already have changed the production definitions. Clipboard commits
also establish a baseline before applying their existing atomic plan.

Cable numbering performed by the existing save/report path is recorded separately
as an explicit derived transaction, without creating a history entry or changing
the numbering algorithm. That avoids an unexplained revision gap after Save.
Drag previews, selections, cameras and editor drafts remain local and unrecorded.

`await bridge.getTopologyCommandProtocol()` waits for ordered SHA-256/validation work
and returns a bounded in-memory diagnostic journal. Frozen captures isolate queued
work from subsequent edits. Recording failures do not change existing single-user
behavior; the journal exposes a sticky error rather than claiming a complete stream.
An untracked topology mutation also invalidates recording until a fresh load baseline.

No commands, hashes, receipts or revisions are added to `.avd`. Reopen/refresh starts
a new session. Unrecognized top-level project data is preserved by replay. The journal
is not a durable outbox, and a truncated journal requires the corresponding baseline
and revision state; it is not replayable from an arbitrary earlier file.

## Boundaries and verification

Version 2 emits only changed records and dependency hashes, not complete project
snapshots. Local before/after validation still scans topology at commit boundaries.
Large changed definitions can include embedded artwork, so this is not yet a
network-ready asset/payload or high-frequency synchronization implementation.

Focused tests: `node --test test/topologyCommandProtocol.test.mjs`.
Chrome acceptance: `node scripts/topology-command-protocol-smoke.mjs` against
`AVDESIGNER_BASE_URL`. This covers live cable creation/deletion, connector metadata,
Jump pairing, Loom membership, card replacement cleanup, Multi-Core deletion,
Undo/Redo, deterministic replay equality, derived numbering and `.avd` reopen.
Phase 6.1 and existing topology/history/export regression checks remain applicable.

Development validation: the isolated scoped tree passed all 2,205 repository tests
and all 16 static validators, including 18 focused topology protocol tests. Chrome
passed the v2 topology and v1 device protocol scripts, existing card-safety and
history-memory workflows, and managed-Loom stability acceptance.

Known pre-existing acceptance-script failure: `multi-core-jump-smoke.mjs` stops
after canceling a changed Trunk editor draft. The custom unsaved-changes backdrop
intercepts the next click; the stack points to `openTrunkEditor` at line 92 and
its second call at line 102 (`TimeoutError`). The same failure was reproduced on
the untouched starting commit `535ce7d8cecee44d940d1c9947a0398c17570f4b` and the
scoped implementation, using separately served checkouts:

```sh
AVDESIGNER_BASE_URL=http://127.0.0.1:8792 node scripts/multi-core-jump-smoke.mjs
```

This prevents that broader script from reaching its later export checks; it is
not a protocol regression. Its assertions and the production unsaved guard were
not weakened or modified. The new scoped acceptance independently verifies
Multi-Core edits/deletion, cable cleanup, history replay and `.avd` reopen.
