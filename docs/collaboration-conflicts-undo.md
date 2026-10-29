# Phase 6.5: Advanced collaboration conflicts and undo

This extends Phase 6.4 without changing local-file editing, the v1/v2 command schemas,
project storage or the database schema. No deployment, production migration, CRDT or
Phase 6.6 work is included.

## Conflict Policy

Strict `submit` is unchanged: stale sequence/read/entity guards still reject. After
a confirmed stale response during an online session, the client may request `rebase`
with the original command/expected sequence and a pinned current `ontoSequence`.
The server, not the browser, constructs the accepted operation:

1. Reauthorize Enterprise write access and read the durable head.
2. Read contiguous accepted history and rewind the head/revisions to the authored
   sequence. Replay the original command with all original guards and validators.
   Browser-provided before-images alone are not evidence of a valid baseline.
3. Compare write footprints against intervening accepted operations, including
   overwritten-and-restored values (ABA). Overlapping writes conflict even if their
   final values happen to match. First accepted server sequence wins those conflicts.
4. Combine only disjoint effects into the current head, addressing objects and
   nested card slots/connectors/circuits by stable IDs. Concurrent insertions in the
   same gap retain server-accepted order. Manual reorder conflicts are conservative.
5. Create and replay a fresh v2 command using current read/revision guards and the
   existing compatibility/topology validators, then commit with the existing SQL CAS.
   A race at commit retries at most three times; clients can refresh online pins at
   most three times. The durable log stores the actual accepted command, not a stale
   browser command or an arbitrary JSON patch.

Different devices/cables, separate card slots/circuits, or independent properties of
one object can survive concurrently (for example, a move and a rename). Composite
state is deliberately not split into accidental hybrids: geometry, cable endpoints,
Jump pairs/attachments, Loom membership, Multi-Core circuit endpoints, installed-card
configuration and connector compatibility are guarded together. Arrays without
unambiguous stable IDs remain atomic. Shared counters/order are shared resources,
not independently mergeable allocations.

Deletion/replacement commands must include their intended cable/relationship cleanup.
They never silently cascade over another user's newly accepted cable, Loom membership,
connector edit or card state. If the combined candidate would orphan endpoints,
violate occupancy, break compatibility/mapping, or invalidate Jump/Loom/Multi-Core
ownership, the entire operation rejects. No project/head/log/version partially advances.

## Selective Undo And Redo

`undo`/`redo` requests identify a target accepted sequence and a new stable command ID.
The server fetches that operation and verifies its recorded actor is the authenticated
requester. It derives inverse effects from durable history, checks intervening write
footprints, validates the complete candidate and commits a new operation. Redo inverts
the accepted undo, not a browser snapshot of the original project.

Only fields owned by that operation are reversed. Another user's unrelated name,
geometry, circuit label or card-slot change remains intact. Reversing a creation or
restoring a deleted cable can be refused if a collaborator now depends on the object
or occupies its port. ABA writes also block undo. No partial compensation is applied.

Local undo/redo stacks move only after the accepted operation is read/acknowledged.
Lost responses retry the same request ID. Rejected undo and unrelated edit conflicts
do not erase previously accepted undo history. Stacks remain per-tab, bounded to 100
entries and are not persisted in `.avd` files. This does not change non-live undo.

## Optimistic Canvas And Recovery

After a rebase/undo acknowledgement, the client replays the ordered accepted log up
to its receipt, then projects later queued local intents over that authoritative state.
It does not overwrite later optimistic edits with a full stale snapshot. Queued
follow-ups are checked against intervening write footprints before projection, and
nested stable-ID card/connector arrays retain independent accepted row edits. A
follow-up invalidated by a remote edit or deletion is retained as a recovery fork,
while the earlier accepted operation remains undoable. Catch-up applies one verified page at a
time, with no intermediate scene rebuilds between operations in that page.

Drafts, focused input fields, active tools and gestures defer visible remote changes,
including conflict rollback. If a gesture finishes during recovery, that additional
committed edit is retained before replacing the canvas. Camera, selections and local
view state stay local. Conflict text remains visible alongside **Unsynced Copy**;
distinct recovery forks are retained, counted and downloaded individually, rather
than silently replacing an earlier fork. Copies remain available after leaving live
mode. Recovery data is in memory only: download it before closing/refreshing the page.

## No Automatic Offline Merge

Rebase is an online response to a known stale rejection, not a persistent offline
queue. Offline-authored intents do not automatically rebase. Advanced requests are
pinned to the head observed online: after uncertain delivery, an identical retry may
retrieve its existing receipt, but cannot newly merge against a later unseen head.
New undo/redo requires a connected session. Permission revocation still denies all
advanced operations and history reads at the existing authorization/CAS boundaries.

## Bounds And Staging

Advanced reconciliation reads at most 100 operations per request and is v2-only.
Older history/v1 boundaries, conflicting manual reorders, or excessive contention
produce explicit recovery feedback; use existing project versions for deeper recovery.
The combined accepted command still obeys the 256 KiB command limit. Existing project,
storage, history, checkpoint, throttle and entitlement limits are unchanged.

No new migration or configuration is required beyond Phases 6.1-6.4. Deploy matching
client/server code only after real Supabase/Vercel staging verifies independent database
connection races, token/role revocation, private Realtime delivery, large projects,
timeouts, quotas and checkpoint recovery. Local PGlite/Auth/Realtime simulations do not
certify production locking or WebSocket behavior. Keep durable operation/snapshot guards
and project checkpoints intact during rollback; accepted records remain ordinary v2
transactions and need no file/schema migration.

## Development Validation

Validated on an isolated staged tree, excluding unrelated Device JSON Import work:

- `node --test`: 2,277 passed, zero failures/skips (30 new Phase 6.5 regressions).
- Focused conflict/live/operation suites: 70 passed.
- All 16 `scripts/*-validation.mjs` validators passed.
- Chrome smoke suites passed: live collaboration, topology command protocol,
  cloud projects, plans and organizations. The enhanced two-client live workflow
  covers independent same-device edits, own toolbar undo/keyboard redo, conflicting
  edits/recovery, editor drafts, catch-up and membership revocation.
- Server collaboration API bundle succeeded; desktop/narrow screenshots inspected.
- All 245 protected artwork, backup, Masters and unrelated-work hashes matched.

Chrome uses local Auth/mail/Realtime simulation with actual UI, API and SQL/RLS.
Real multi-connection Supabase/Realtime staging remains a release prerequisite.
