# Phase 6.4: Live multi-user synchronization

Enterprise project collaboration connects the Phase 6.1/6.2 Engine commands to the
Phase 6.3 operation store. No deployment, production migration or Phase 6.5 work is
included. Local projects, local Save/Save As, file format and non-collaborative cloud
projects retain their existing paths.

Development validation (2026-10-29): 2,247 isolated repository tests pass, including
16 focused live-client/security cases; all 16 static validators pass. Five Chrome
smoke suites pass: two-client collaboration, topology protocol, Cloud Projects, plans
and organizations. Both server API bundles compile. Browser tests simulate Auth and
Realtime delivery while exercising the actual Engine, API handlers and SQL/RLS.
Production Supabase/WebSocket and independent-connection staging remain mandatory.

## Entry And Authority

In Cloud Projects, an Enterprise Owner/Admin/Editor can choose **Collaborate** to
activate a project. **Open** joins an already-active project automatically. Viewers
can join active projects read-only. Historical versions remain recovery previews,
not live sessions. Active projects expose a status bar, checkpoint, retry, leave and
an unsynced-copy download when necessary. Save Separate Copy leaves collaboration
and binds the new independent cloud project. Local file opening/New also detach.

Only committed topology differences are queued. Commands are created against the
server epoch and replay revisions, submitted through the existing authenticated
operation API, and applied in accepted sequence order. No snapshots are broadcast
for movements. Local normalization differences, factory-resolved dependencies and
local-only view settings are not blindly copied back into server snapshots.

Supabase Realtime is an invalidation transport only. A notification asks the client
to read authorized API status/history; its contents never mutate the graph. The
database sends small project-ID hints to separate `wirenexus:user:<auth uid>` inboxes,
fan-out restricted to current entitled members. There are no project snapshots,
commands, identity claims or coordinates in broadcasts. Browser sends on this
namespace are forbidden, including in the presence of broader permissive policies.

This is deliberate: [Supabase caches channel authorization for a connection](https://supabase.com/docs/guides/realtime/authorization).
Removing a membership is not sufficient to eject a shared-topic subscriber at once.
Per-user inboxes and server-selected recipients avoid sending subsequent project
updates to that revoked connection. A revocation invalidation carries no project
data. Every data read and submission independently checks current membership.
Previously delivered bytes cannot be recalled.

## Optimism, Recovery And Local State

- Local commits appear optimistically; only one queued operation submits at a time.
  Accepted commands advance revisions. Uncertain delivery retries the exact command
  ID and expected sequence, using durable idempotency receipts.
- Stale/conflicting or invalid edits are not automatically rebased over another
  user's changes. An in-memory local recovery copy is retained, pending edits stop,
  and the accepted server head is restored. **Unsynced Copy** downloads the retained
  `.avd`. Never refresh/discard an offline canvas before saving that copy.
- Missed notifications, reconnect and online events catch up ordered history.
  A 10-second watchdog works without a functioning Realtime transport. In-flight
  responses are invalidated on detach/account change, not applied to another file.
- Camera, selection, active layer, tools and unfinished drafts are not transmitted.
  Remote scene application waits for active gestures, tools, dialogs and focused
  input drafts to finish. Presence/authorization can still refresh while deferred.
- Accepted remote topology updates preserve the camera and surviving selections.
  Engine-local snapshot history is not replayed over remote edits. Live undo/redo
  uses the user's own accepted command history (100 entries), issuing new validated
  inverse commands. If another user changed the affected entity/order, undo refuses
  rather than restoring a stale snapshot. This does not change local-file undo.

## Temporary Presence

Cursors and drag ghosts use the authenticated `collaboration-live` API. Actor IDs
are stamped server-side. Only bounded coordinates and an existing device reference
are accepted; Viewers cannot advertise editing previews. Ephemeral state lives in
an **UNLOGGED** private table, expires from reads after 30 seconds, and is removed on
leave/revocation or a database crash. It is absent from operation logs, cloud versions,
`.avd`, exports and project history. This is not durable project data.

The Realtime hint causes other clients to fetch API-verified temporary state. Cursor
updates are coalesced to at most twice per second, with idle heartbeats. Display names
use non-email collaborator identifiers. Drag ghosts do not move graph objects or
cable endpoints. A separate bounded source-IP authentication gate allows collaboration
traffic without raising the existing publishing authentication limit.

## Deployment Prerequisites (Not Performed)

1. Apply all migrations through Phase 6.3 in disposable Supabase staging, then
   `202610290002_live_collaboration.sql`. Keep `wirenexus_private` unexposed.
2. Enable Supabase Realtime private Broadcast and disable public-channel access.
   The migration uses the existing `realtime.messages`, `realtime.topic()` and
   `realtime.send()` APIs. Do not alter ownership/RLS enablement on Supabase's
   managed Realtime schema. Policies restrict the WireNexus inbox namespace.
3. Use the existing server-only Supabase URL/service-role key for both APIs. The
   browser uses only the existing publishable key/session. No service-role secret
   belongs in browser configuration, project files or Realtime payloads.
4. Verify real Auth token refresh, WebSocket policy enforcement, private Broadcast
   fan-out, connected-member revocation and role/plan changes. Test independent
   database connections, rollback/outage behavior, large projects and shared-IP
   request limits under expected team load. Local simulations are not staging proof.

Rollback the UI/API first, retaining operation tables, checkpoints and snapshot-save
guards. Reconcile/backup all active heads before removing collaboration infrastructure.
Do not point a snapshot-only writer at active collaboration projects.

## Current Limits

Phase 6.3's 3 MiB project, 256 KiB command, quota and checkpoint/history limits remain.
There is no persistent offline queue, CRDT, automatic merge, shared editor draft,
crosspoint editing or new collaboration billing. Reconnect is supported while the
page remains open. Closing/refreshing with unaccepted changes uses the existing
unsaved warning; recovery copies must be saved explicitly. Busy/draft tabs defer
visible remote changes until safe. Notification failure falls back to API polling.
Presence bounds/expiry are operational safeguards, not project entitlements.
