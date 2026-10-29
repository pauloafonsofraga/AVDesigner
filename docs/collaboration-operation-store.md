# Phase 6.3: server-side collaboration operation store

Development scope: durable operation acceptance and recovery, not live collaboration.
No editor networking, presence, cursor broadcasting, registration changes or production
deployment. Local editing, history, Save/Save As and `.avd` serialization are unchanged.

Development validation (2026-10-29): 2,230 isolated repository tests pass, including 24
focused operation-store tests; all 16 static validators pass. Chrome topology-command,
Cloud Projects, plans and organizations smoke workflows pass. The Node API bundle builds.
This confirms local development coverage, not production Supabase/Vercel readiness.

## Trust Boundary

`POST /api/collaboration-operations` verifies the bearer with Supabase Auth, using the
existing source-IP authentication throttle. The server overwrites actor identity/AAL.
Requests containing actor, snapshot, patch or replay-state fields are rejected.
Service credentials stay in server environment variables and never reach the editor.

The API replays v1/v2 commands using `replayTopologyCommand`, including existing Engine
compatibility, card, Jump, Loom and Multi-Core validators. Only the detached validated
candidate reaches the service-role-only `wirenexus_collaboration` RPC. Neither anonymous
nor authenticated database roles can execute it or read/write its private tables.
RLS is enabled, with no browser table policies/grants; all access uses the authorized RPC.
The SQL RPC is a trusted server commit boundary, not an independent JS validator.
Never expose it to browser roles or provide a generic service-role RPC proxy.

Every RPC resolves workspace ownership from the project row and rechecks membership.
Mutations require Owner/Admin/Editor, an Enterprise workspace and the configurable
`collaboration` entitlement. MFA Platform Admin can override entitlements, not membership
or the Enterprise workspace requirement. Viewer members can read/catch up, not submit.
Downgrades preserve authorized recovery reads and all existing cloud data/history.

## Protocol

Actions (all include `projectId`):

- `activate`, `expectedRevision`: initialize from the current complete Cloud Project
  version. The server validates the baseline collection identities before activation.
  The database checks the cloud revision again and allocates the stable session UUID.
  Repeated activation returns the existing session; caller-selected epochs are not used.
- `read`: current durable `document`, `sequence`, `sessionId`, compact `replayState`,
  checkpoint sequence/version ID/replay state. This is authoritative once activated.
- `submit`, `expectedSequence`, `command`: ordered atomic compare-and-swap. Commands
  must use the returned server session and entity/scope revisions. A client journal's
  unrelated local-load session cannot be submitted without deliberate future integration.
- `history`, `after` (default 0), `limit` (1-25): ascending operations with server actor,
  sequence and timestamp; returns `after`, `hasMore`, head/checkpoint metadata.
- `checkpoint`, `expectedSequence`: materialize the current validated head, not a
  caller-supplied snapshot, as a normal private Cloud Project version.

The head sequence starts at 0. Accepted commands allocate the next number under the
workspace/project lock. Unique project/command and project/sequence constraints enforce
durable idempotency/order. Receipts bind command contents, expected sequence and actor.
Same-ID changed content or another actor's retry conflicts. Stale requests fail with
409; malformed/topology-invalid requests with 400; permission/plan/quota failures with
403. No candidate, receipt, sequence or checkpoint advances on failure.

Validation occurs outside the database transaction, but commit rechecks membership,
entitlements, epoch and sequence under locks. A revoked or downgraded user cannot commit
an already-validated candidate. Locks use workspace then project order, matching existing
membership and quota operations. Reads also take the workspace lock: once revocation
commits, subsequent reads/receipts/catch-up deny access. Already-delivered bytes cannot
be recalled. No bearer authorization cache is introduced.

## Durability And Cloud Saves

`collaboration_heads` holds the complete head and compact replay revisions.
`collaboration_operations` retains every command, ordered sequence and durable receipt;
the head's in-memory receipt dictionary stays empty. No operation pruning is introduced.
Checkpoints reuse `cloud_uploads`, `cloud_chunks` and `cloud_versions`, with integrity
digests and immutable prior versions. The default interval is 50 committed operations,
configurable in the private singleton `collaboration_policy`. Checkpoint + operation
commit is one transaction, including quota checks. A failed checkpoint rolls back the
triggering operation, leaving the prior valid head/version intact.

For reconnect, read the latest head or download the indicated checkpoint through the
existing authorized Cloud Project chunk reader, initialize its `checkpointState`, and
replay operations after `checkpointSequence`. Follow each page's `after` until caught up.
Recheck the latest head if other operations commit during catch-up. Historical commands
remain readable, including those before the latest checkpoint. A process restart needs
no in-memory state; recovery uses PostgreSQL alone.

For activated projects, ordinary cloud `begin`, `finish`, `recover`, `duplicate` and
`archive` reject. This includes uploads staged before activation. Reads/history and
renaming remain available; Cloud Open is the latest **checkpoint**, not necessarily the
operation head. Use the operation read for current state. To recover an older version,
open it read-only and save a separate new project. Unactivated projects retain all
existing cloud workflows. There is intentionally no deactivate/reset-epoch operation
or editor UI in this server-only phase.

## Limits And Outstanding Work

- Initial head limit: 3 MiB JSON, replay metadata 512 KiB. Oversize activation/edits fail
  without altering the project; ordinary cloud/local files still support existing limits.
  Limits bound serverless responses and validation work; large-project asset separation
  and streaming are deferred. Do not raise the ceiling without transport/load testing.
- Commands: 256 KiB canonical JSON; catch-up command pages: at most 1 MiB and 25 entries.
  Checkpoint metadata is additional. A per-account database minute limiter allows 600 RPC
  calls; a submission uses multiple calls. Existing IP Auth throttle is also active.
- Storage usage includes head, replay/checkpoint metadata, operations/receipts and normal
  cloud version bytes. Workspace serialization prevents quota races. History limits also
  apply to checkpoints: reaching them blocks the checkpoint-triggering operation, without
  deleting history. A plan upgrade/config change is needed before continuing.
- Conservative v2 dependency guards reject concurrent commands from the same head, even
  for independent edits. No merging, rebasing, offline queue, live transport or CRDT added.
- Existing topology defects remain tolerated only if the shared transition validator
  says the operation introduces no new defects, matching Phases 6.1/6.2.

## Setup And Rollback

Apply all existing migrations through `202610280004_organizations_teams.sql` first,
then `202610290001_collaboration_operations.sql`, in a disposable/staging Supabase project.
Keep `wirenexus_private` outside exposed schemas. Use the existing server-only
`WIRENEXUS_SUPABASE_URL` and `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY`; client anon credentials
must never call this service RPC. Deploy the API only after staging validation. This
task does not apply migrations, deploy, enable registration or change environments.

Required staging gates: independent PostgreSQL-connection concurrency/lock tests;
revocation and downgrade races; real Supabase Auth/RLS/service-role grants; schema cache;
serverless bundling, timeouts, request/response limits and large artwork; forced network
loss around commit/checkpoint; quota boundary races with existing uploads. Local PGlite
tests execute the actual SQL with role simulation and controlled interleavings, but do
not certify production multi-connection locking or Supabase/Vercel behavior.

Rollback: disable the operation API first and export/backup heads, logs, replay metadata
and cloud versions. Keep the migration and cloud-save guard while any activated project
has uncheckpointed operations. Restore a checkpointed head to a **separate** project if
needed. Do not drop collaboration tables, remove the save guard or roll back to a
snapshot-only writer until all heads are reconciled; doing so can lose accepted edits.
