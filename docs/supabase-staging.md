# Phase 6.6A: VideoCore Supabase staging preparation

Status: preparation only, 2026-10-29. Application baseline:
`776ff65eb9f32450ab24c0b38015381ef5ce0917` on `engine-prototype`.
Phase 6.6A performed no remote inspection, provisioning, migrations, environment
changes or deployment. Closed registration is a required setup condition, not a
claim about the subsequent hosted inspection below. This is not staging acceptance.

This consolidates the current account, publishing, organization, cloud and live
collaboration setup. Older phase documents describe their historical phase boundary;
use the complete chain below, including Phase 6.5 conflict/undo behavior.

Phase 6.6B now verifies target `puyrylatmtcwlvyycplc` (WireNexus Staging) through
read-only hosted inspection. **Its existing Auth configuration has public signup
enabled (`disable_signup=false`); approval is required to disable it.** The inventory
and outstanding hosted checks are recorded in
[the staging preflight report](supabase-staging-preflight.md). Supplying a project
reference or passing inventory checks does not authorize setup or deployment.

## 1. Isolation and approval gates

Record this non-secret target sheet before any remote action:

| Item | Required value / current evidence |
| --- | --- |
| Supabase project | Verified `puyrylatmtcwlvyycplc`, WireNexus Staging, active in eu-west-1; application-empty inventory; signup currently enabled; see Phase 6.6B report |
| Isolation | Dedicated project with no production/development users, data or secrets; project name alone is not proof |
| Vercel | Dedicated staging project/origin, not an existing production deployment or shared preview secret scope |
| Published viewer | Explicit staging HTTPS origin; may be the staging editor origin because HTML remains sandboxed |
| Blob | Dedicated **private** staging Vercel Blob store; never attach the production store/token |
| Mail | Test-only verified SMTP/Resend senders and operator-controlled recipient inboxes |
| Candidate | Record approved application SHA, lockfile hash and migration manifest |
| Operator | Named migration operator, deployment approver and recovery owner |

Separate approvals are required for (A) remote schema/provisioning/configuration and
(B) deploying the staging application. Neither is authorized by this preparation.
Stop on any target mismatch, unknown existing schema, missing backup or shared token.
Do not import production Auth users, customer snapshots, personal libraries or old
publications. Use synthetic AV projects and original test artwork. Production and
development configuration must remain unchanged.

Use a clean archive of an approved commit in a separate working directory, not the
dirty authoring checkout. Keep all secrets in an external secret manager/session.
The repository's current `.gitignore` does **not** ignore `.env*`, `.vercel/` or
`supabase/.temp/`; do not write credentials or CLI state into this checkout. There
is no linked Supabase/Vercel project or Supabase CLI config here. Supabase CLI and
`psql` are not installed on this session's PATH; Vercel CLI is available. No account
environment variables are present in this session. These observations do not prove
whether someone has separately configured the new hosted project.

## 2. Migration chain

All eight files are required, in this exact order:

| Order | File in `supabase/migrations/` | Dependency / result |
| ---: | --- | --- |
| 1 | `202609290001_owner_library.sql` | Private schema, legacy owner, original artwork bytes, personal registry/RPC |
| 2 | `202610270001_secure_publishing.sql` | Publisher grants, publication reservations, durable throttles, service-only publishing RPC |
| 3 | `202610280001_accounts_workspaces.sql` | Registration guard, per-user workspace/Owner provisioning, MFA Platform Admin, memberships and personal-library RLS |
| 4 | `202610280002_cloud_projects.sql` | Private chunk uploads, immutable project versions, workspace-authorized cloud RPC |
| 5 | `202610280003_plans_entitlements.sql` | Default Free plans, quotas/reservations, plan administration, metered library/cloud/publishing wrappers |
| 6 | `202610280004_organizations_teams.sql` | Company settings, email-bound invitations, seat quotas, shared library/artwork, membership wrapper |
| 7 | `202610290001_collaboration_operations.sql` | Enterprise collaboration entitlement, durable sequence/head/log/checkpoint, snapshot-save guard |
| 8 | `202610290002_live_collaboration.sql` | Private per-user Broadcast policies, notification triggers, ephemeral presence, live-aware cloud list |

Phases 6.1/6.2/6.5 introduce no additional migrations. Later files intentionally
rename/wrap earlier RPCs; never apply a subset out of order. These are not generally
idempotent scripts. Files 1 and 2 have no explicit transaction wrapper; ensure the
chosen runner applies each atomically (or wrap each of those two once in BEGIN /
COMMIT for an approved SQL Editor procedure). Files 3-8 have their own transactions.

Verify the unchanged source files locally, from repository root:

```sh
shasum -a 256 -c docs/staging-migrations.sha256
```

After approval, use a pinned, recorded Supabase CLI version in the external staging
working directory: initialize its local configuration, copy these exact migrations,
and link only the independently verified staging reference. Have a second operator
review the dashboard project identity and connection target. First run:

```sh
supabase migration list
supabase db push --dry-run
```

These are **future remote commands, not executed here**. The dry-run must show exactly
the eight pending versions for a fresh project. Inspect existing application schemas,
Auth users and the CLI ledger before approving `supabase db push` (also not executed).
If any file was manually applied without a ledger entry, stop and reconcile its
actual schema/checksum with the operator; do not blindly replay, repair the ledger,
or use `--include-all`. Do not use remote `db reset`, seeds or `--include-seed`.

Back up any existing staging state first; verify a restore in a disposable target.
The following initial inventory is read-only and works before application SQL:

```sql
begin transaction read only;
select current_database(), current_user, current_setting('server_version');
select count(*) as existing_auth_users from auth.users;
select nspname from pg_namespace where nspname='wirenexus_private';
select to_regclass('supabase_migrations.schema_migrations') as existing_cli_ledger;
select to_regclass('realtime.messages') as managed_messages,
       to_regprocedure('realtime.topic()') as managed_topic,
       to_regprocedure('realtime.send(jsonb,text,text,boolean)') as managed_send;
commit;
```

The schema uses Supabase-managed `auth.users`, `auth.mfa_factors`, `auth.uid()`,
`auth.jwt()`, roles `anon`/`authenticated`/`service_role`, built-in `sha256(bytea)` /
`gen_random_uuid()`, and `realtime.messages`, `realtime.topic()`, `realtime.send()`.
No application Storage bucket or pgcrypto extension installation is required.
Run read-only dependency checks before file 8; never invent placeholder Realtime
functions/tables on hosted Supabase. Refresh PostgREST's schema cache through the
approved provider procedure if new RPCs remain undiscoverable; verify errors first.
Retain CLI migration-list output and all eight checksums as deployment evidence.

## 3. Configuration contract

Configure only the dedicated staging deployment after approval:

| Variable | Exposure | Requirement |
| --- | --- | --- |
| `WIRENEXUS_SUPABASE_URL` | Public URL | Exact staging project API URL, shared by editor/server |
| `WIRENEXUS_SUPABASE_PUBLISHABLE_KEY` | Browser-safe | Matching staging `sb_publishable_...` key; legacy anon accepted by existing code |
| `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY` | Server secret | Matching elevated backend key; prefer provider secret key where supported, keep existing variable name; prove `service_role` RPC access in staging |
| `WIRENEXUS_REGISTRATION_ENABLED` | Public UI flag | Absent or literal `false`; never `true` in this procedure |
| `BLOB_READ_WRITE_TOKEN` | Server secret | Dedicated private staging store, for publish/upload/viewer APIs |
| `PUBLIC_VIEWER_ORIGIN` | Public URL | Explicit staging HTTPS origin; **required here** because code defaults to the old production AV Designer origin if absent |
| `WIRENEXUS_EDITOR_ORIGIN` | Public URL | Exact staging HTTPS origin for invitation links |
| `WIRENEXUS_INVITE_EMAIL_API_KEY` | Server secret | Dedicated Resend credential, not SMTP password or Supabase key |
| `WIRENEXUS_INVITE_FROM` | Sender identity | Verified test sender supported by Resend |

Supabase CLI access tokens/database passwords and test-account passwords are
operator-only provisioning credentials, not application environment variables.
Never use `VITE_*`, `NEXT_PUBLIC_*`, account-config.json, bundles, `.avd`, test
reports, browser console or chat to carry elevated keys. Never log bearer tokens,
invitation tokens, passwords or uploaded project bodies. Configure no production
environment scopes. Ensure automatic Vercel integrations have not injected a
different project's key/store. Use fresh browser profiles with no production login
or browser-recovery library; do not import real personal defaults for testing.

Supabase's modern secret keys use the `service_role` database role, but are not
JWTs. Keep them as SDK server credentials; don't construct user Authorization
tokens from them. Verify with the pinned SDK and API gateway rather than requiring
a deprecated legacy key. If hosting the viewer separately, its viewer APIs must use
the same **staging** database and private Blob store; neither deployment may fall
back to a production credential. `/account-config.json` must expose only URL, publishable
key and registration flag; verify privileged keys are rejected and responses
are `no-store`. The committed static configuration remains disabled.

## 4. Auth, data and transport configuration

**Auth:** keep Supabase Allow new users to sign up OFF, anonymous sign-ins OFF,
email provider/confirmation ON, and database `account_policy.registration_enabled`
false. The UI flag is the third independent gate. Do not enable registration even
temporarily for a signup test: verify public signup is rejected with a test address.
Trusted Admin API provisioning remains the way to create the test accounts.

Set Site URL to the dedicated staging editor origin. Use only exact approved
staging redirect URLs, no broad production wildcards. Email OTP and recovery use
code entry with `detectSessionInUrl:false`; configure magic-link, recovery and
confirmation templates to display `{{ .Token }}`. Test real SMTP delivery to every
test inbox, expiry and password recovery. The app minimum password length is 12;
set Auth policy accordingly. Supabase's default SMTP is restricted to authorized
team addresses; use a test SMTP provider for other recipients. Enable and test TOTP
enrollment/challenge/verification and refresh to aal2, including factor removal.
Do not install a custom access-token hook or add browser-controlled role claims.

**PostgREST/RLS:** expose the required `public` APIs, not `wirenexus_private`,
`auth`, or `realtime` as browser REST schemas. Grants to authenticated on private
helpers are not permission to expose that schema. Confirm with Dashboard as well
as SQL: database settings may not reflect externally managed exposed-schema config.
Run [staging-preflight.sql](staging-preflight.sql) after all migrations using the
trusted staging database inspector. It is a read-only transaction with catalogue,
grant, policy, trigger and provisioning checks; inspect every result, not just exit
status. Check CLI ledger versions separately using `supabase migration list`.

Expected effective permissions:

- Anonymous has no application table/RPC access. Password-viewer branding/unlock
  intentionally uses the server API, never an anonymous database bypass.
- Authenticated executes only the six browser RPCs listed in the preflight.
  Profiles, workspaces, memberships have workspace/own-row RLS SELECT policies.
  Direct column updates are only profile `display_name`, workspace `name` and
  `organization_settings`; workspace settings revision is maintained by its trigger.
- Authenticated private SELECT is limited to `library`, `artwork`, `cloud_projects`,
  `cloud_versions`, `organization_library`, `organization_artwork`, with own/member
  RLS. No direct browser table writes; no chunk, operation, presence, policy, invite,
  plan or publication table access. Private helper execution is only
  `workspace_role(uuid)` / `platform_admin()`; all unmetered and snapshot wrappers
  remain inaccessible. Security-definer search paths must remain fixed/empty.
- Publishing, invitation delivery, collaboration operations/live/throttle RPCs are
  service-only. APIs verify real Auth tokens, stamp actor/AAL, and reauthorize
  ownership/membership in SQL. Service credentials bypass RLS: testing isolation
  with them proves nothing. Use separate real user sessions for denial tests.
- All application tables have RLS, all registration/provision/plan/library/live
  triggers are enabled. Zero users lack personal Owner workspaces/plans. New
  accounts/workspaces are Free until an MFA Platform Admin explicitly assigns plans.

**Storage:** personal/company artwork and cloud snapshots/chunks are PostgreSQL
data, not Supabase Storage buckets. Do not create a public bucket or bucket policy
for these features. Budget database space/backups for embedded images, immutable
history, pending uploads and collaboration logs. Private Vercel Blob handles
published `.avd`/HTML only. Keep production links and original Blob store untouched;
legacy-viewer compatibility can use synthetic old-format objects in staging only.

**Realtime:** enable private Broadcast and disable Allow public access. Do not add
tables to Postgres Changes replication for this feature. Keep managed Realtime
ownership and RLS unchanged. File 8 adds one permissive own-inbox SELECT policy
plus restrictive own-inbox SELECT/client-send-denial policies. Verify all three,
including against a broader permissive policy in a disposable local test (never
add broad policies to staging). Clients subscribe privately to
`wirenexus:user:<verified-auth-uid>`; they cannot send into this namespace or read
another user's inbox. Broadcast payload is only a project-ID invalidation hint.
Snapshots/commands and temporary cursor data are fetched from authorized APIs.
Membership revocation is checked at send/read/commit, not assumed from cached
Realtime channel authorization. Test real sockets and token refresh; 10-second
API catch-up can mask a broken Broadcast configuration, so separately prove
actual private WebSocket notifications arrive. Presence expires after 30 seconds
and its unlogged table is intentionally not durable recovery data.

## 5. Runtime/API dependencies

The staging host must serve Node APIs, not just static HTML. Use the committed
lockfile with `npm ci` in the clean candidate, and record the supported Vercel Node
runtime (local validation used Node 24.4.1; no repository engines pin exists).
Do not resolve `@vercel/blob:latest` afresh or rebuild committed bundles casually.
Validate `api/account-config`, `publish`, `upload`, `project`, `organization-invite`,
`collaboration-operations`, `collaboration-live`, plus build-info for SHA evidence.
Retain `/account-config.json` and `/v/:id` rewrites from `vercel.json`.

Place functions near the database and verify timeouts, cold starts, egress/TLS,
Auth/Data API connectivity and Resend connectivity. On Vercel, source throttles
trust only `x-vercel-forwarded-for`; other hosts need a separately reviewed trusted
proxy adapter. Do not spoof headers or weaken the limiter. Review shared-IP team
budgets: live Auth 3,600/minute/IP, live RPC 360/minute/user, operation RPC
600/minute/user; multiple RPCs occur per advanced operation. Other publishing/Auth
limits remain separate; test controlled 429s and recovery, not a load flood.

Staging deployment protection must still permit authenticated testers and the
provider-signed Blob completion callback at `/api/upload`. Prove callback routing
without disabling application authorization or exposing a protection-bypass secret
in HTML. Do not assume localhost/static smoke checks certify callback delivery.
Published HTML remains in an opaque iframe (`allow-scripts allow-downloads`) with
network-blocking CSP, even on a separate viewer origin. Verify logo/project name,
password failure/success, ownership/revoke and sandbox isolation on staging.

Capacity blockers to measure before acceptance:

- Cloud `.avd`: 64 MiB logical limit, 192 KiB binary chunks; direct RPC transfer,
  statement timeout, database memory and quota usage need representative testing.
- Collaboration: 3 MiB head, 256 KiB command, 512 KiB replay metadata, 25 operations /
  1 MiB catch-up page, checkpoints every 50 operations. API envelopes must fit the
  hosting request/response limits. Advanced conflict/undo has a 100-operation window.
- Publishing allows 128 MiB HTML uploads, but `/api/project` returns the **whole HTML
  in JSON**. Vercel's documented 4.5 MB function response limit means the upload
  limit is not an end-to-end viewer guarantee. Measure encoded response size and
  refuse release claims for oversized viewers; streaming/chunk repair is separate
  implementation work, not part of this documentation pass.
- Test interrupted finalization, private Blob downloads and quota-boundary
  checkpoints. No automatic pruning/garbage collector or billing is implemented.

## 6. Test accounts and Enterprise provisioning

After migration approval, create synthetic accounts with separate controlled inboxes:

| Account | Purpose |
| --- | --- |
| P | Platform Admin only; deliberately NOT a member of the test company |
| A | Company Owner, personal library and publishing owner |
| B | Company Admin |
| C / D | Two independent Editors for conflicts and undo |
| E | Viewer (read-only) |
| F | Outsider, owns a second company for cross-organization denial |

Use the trusted Supabase Admin SDK in an external operator process. The following
is an **unexecuted** provisioning example; inject credentials/password from the
secret manager, never command-line literals or source files, and redact logs:

```js
const supabase = createClient(process.env.WIRENEXUS_SUPABASE_URL,
  process.env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const {data,error} = await supabase.auth.admin.createUser({
  email:process.env.STAGING_TEST_EMAIL,
  password:process.env.STAGING_TEST_PASSWORD,
  email_confirm:true,
  app_metadata:{wirenexus_provisioned:true}
});
if(error || !data.user) throw new Error('Test account provisioning failed');
// Record only the new synthetic user UUID in the restricted operator worksheet.
```

Import `createClient` from the pinned `@supabase/supabase-js`. Do not copy UUIDs or
password hashes from another environment. The administrator-only app-metadata marker
is required by the closed registration trigger; `user_metadata` cannot substitute.
Ordinary Dashboard user creation may fail without it. These accounts are confirmed
synthetic test identities, not evidence that public signup/confirmation is enabled.

Provision P's role via a trusted staging SQL administrator **only after approval**:

```sql
insert into wirenexus_private.platform_admins(user_id, reason)
values ('<P-STAGING-UUID>', 'Approved isolated Phase 6.6 staging test');
```

P signs in, enrolls TOTP, verifies aal2; role alone must not grant privileged UI/RPC.
A creates `STAGING VideoCore Team` through Account Organizations (real
`wirenexus_organizations('create', ...)` path); F creates a different company. Each
starts Free. P uses Plan Administration to load the companies' current assignment
revisions and assign **Enterprise**; enable `organizationTeams` and `collaboration`
through the existing central policy (default Enterprise features after file 7).
Do not spoof JWTs or hand-edit plan rows. P still cannot open either company's data.

A invites B/C/D/E through the real email API with Admin/Editor/Editor/Viewer roles;
each signs in as its verified recipient and accepts. This tests reservation,
delivery, fragment redaction, email binding, current inviter authority and seats.
Do not directly insert memberships to bypass invitation acceptance. Revoke D and
test immediate denial with its existing open tab/token; re-invite for later tests.
Test last-Owner protection and Admin inability to grant Owner/Admin.

For publishing, assign A's **personal** workspace Paid (or use an Enterprise
workspace selection if the UI supplies it) and separately authorize the publisher:

```sql
insert into wirenexus_private.publishers(account_id, enabled)
values ('<A-STAGING-UUID>', true);
```

This does not grant Platform Admin or ownership of other publications. Do not seed
the legacy singleton owner table for new staging accounts: it is unnecessary after
Phase 2 and carries separate historic publisher authority. Keep the three signup
gates closed throughout. Invitation acceptance does not create Auth users.

## 7. Reproducible validation and evidence

First run local regressions on the clean candidate, with no remote credentials:

```sh
npm ci
shasum -a 256 -c docs/staging-migrations.sha256
node --test
for f in scripts/*-validation.mjs; do node "$f" || exit 1; done
```

Serve that candidate locally and run the account, publishing isolation/Auth,
cloud, plans, organizations, topology-command and live-collaboration smoke scripts
with `AVDESIGNER_BASE_URL` pointing to that local server. These scripts use local
Auth/Realtime/PGlite simulation; **do not point them at staging expecting real
multi-user acceptance**. Do not run `test/fixtures/*Database.mjs` SQL or its role/Auth/
Realtime stubs against hosted Supabase. Baseline Phase 6.5 passed 2,277 repository
tests and 16 validators; rerun on the exact future deployment candidate.

Then, after separate deployment approval, execute with isolated real browser
profiles and actual Auth JWTs. Record status, actor role, request ID, project ID,
before/after revision/sequence, invariant assertions and sanitized screenshots;
never record tokens or complete customer/project bodies. Use two **independent**
database/API connections, not one serialized PGlite connection. For race tests,
coordinate concurrent HTTP submissions at a barrier using commands captured from
the real Engine/protocol; do not expose a generic service-role commit endpoint.

| Gate | Procedure and pass evidence |
| --- | --- |
| Configuration / Auth | Build-info matches candidate; public config points only at staging; closed signup, real email code/password/recovery, refresh/sign-out work; P lacks Admin at aal1, gains it at aal2, loses it after role/factor revocation |
| Libraries / isolation | A/B separate personal registries/artwork; cross-user and F cross-company reads/writes denied; C edits shared company library, E reads only; stale library generation/revision rejects; original bytes/hash and `.avd` portability preserved |
| Plans / seats | Free defaults; ordinary self-upgrade denied; P upgrades/downgrades with revision checks; concurrent last-seat/project/storage/history reservations cannot over-allocate; existing data/read/local export survives downgrade |
| Cloud / versions | Save/open embedded artwork and dependencies; rename/duplicate/archive/restore/history recovery; simultaneous same-revision saves admit only valid winner; interrupted/corrupt uploads retain prior head; edits made during save remain dirty |
| Publishing | Unauthorized upload/replace denied, server paths only, two owners isolated, mismatched size/MIME/expired token rejected; signed callback succeeds; real password/logo/project-name viewer and sandbox; revoke works; representative HTML fits response ceiling |
| Live / transport | C/D join same project, actual private socket hints arrive, no client broadcasts/foreign-inbox receive; committed edits converge while camera/selection/drafts remain independent; cursor/ghost expiry; notifications off still catches up by API |
| Conflict / topology | Simultaneous independent device/cable metadata and separate card-slot/channel edits survive; same cable endpoint, same card slot, ABA and delete-vs-new-cable races deterministically reject loser with no partial log/head/topology change |
| Jump / Loom / Multi-Core | Exercise atomic pairing/deletion, membership/ownership/mapping and external endpoints; disconnected/deleted endpoint or incompatible replacement cannot leave dangling IDs; compare final graph on both clients and reopened project |
| Own undo / redo | C undoes/redoes own accepted edits while retaining D's unrelated edits; cross-user target rejected, same-field later edits reject, queued follow-ups preserve remote nested card changes; toolbar/keyboard agree |
| Recovery / revocation | Drop HTTP response after commit then retry identical command ID: one sequence only; disconnected stale edit never automatically merges; recovery copy downloads; busy gesture/draft defers rollback without losing local fork; revoked D's existing JWT loses submit/history/status and new project data hints |
| Checkpoints / failure | Cross 50-op checkpoint boundary, compare head/checkpoint/replayed sequence; failed quota/timeout checkpoint commits nothing; API process restart and missed-page catch-up restore identical graph; active project rejects full-snapshot cloud save/recover/duplicate/archive |
| Local compatibility | Existing historical synthetic `.avd` with artwork opens/saves/reopens and exports HTML/PDF; Cmd/Ctrl+S/local Save As unchanged; single-user undo works; no account dependency for local files |
| Capacity / protection | Measure largest representative RPC/snapshot/API envelope and shared-IP load; controlled 429s recover; no 413/timeouts/secret leakage or failing sandbox; originals and unused production infrastructure unchanged |

Revoked users may retain previously delivered bytes; no system can recall those.
Do not call a test passed merely because the UI hides a button. Prove RLS/RPC/API
denial with the real lower-privilege token, and recheck rows/sequences/checksums.
Baseline known broad `account-library-smoke.mjs` `.avd` download timeout is recorded
in [secure-publishing.md](secure-publishing.md); explicitly validate real local
download in staging, without weakening that test or treating the timeout as a pass.
Capture API/DB/Realtime/provider mail evidence together. One failure leaves its
gate open; no production-ready or Phase 6.6 completion claim follows from this prep.

## 8. Rollback and recovery

Before tests, inventory dedicated staging resources and record empty/initial
database state, applied migration versions, plan definitions, synthetic UUIDs,
Blob objects and checksums. Store database/Auth backups and Blob inventory in
restricted storage with an independently tested restore path. Auth/key/mail/Realtime/
Vercel settings are configuration evidence too; a database dump is not their backup.
Never store these secrets/evidence in the repository.

If migrations fail, stop before deployment, inspect transaction/ledger state and
fix the staging procedure. Do not manually stamp unapplied migrations successful.
For a genuinely disposable staging project, a separately approved replacement
project is safer than improvising destructive reverse migrations; verify its new
reference and credentials afresh. Never reset shared development/production.

For runtime/conflict incidents, stop staging writes/disable the faulty staging
entry points first, retain recovery copies, and back up authoritative heads,
sequences, operation logs/receipts, replay/checkpoint state and immutable cloud
versions. Checkpoint through the validated operation API when safe; preserve any
uncheckpointed head and replay logs independently if checkpoints are blocked.
Reconstruct into a **separate** project and compare hashes/topology before use.
Do not resume a snapshot-only writer against an active collaboration project.

Roll back UI/API to a compatible build, not unauthenticated publishing or public
storage. Keep schema, RLS, registration guard, ownership, quotas and snapshot-save
guard intact. There is no implemented deactivate/reset-epoch operation. Leave
approved test data available for diagnosis; cleanup/Auth deletion and resource
destruction require separate approval, especially foreign keys and last-Owner
responsibilities. Keep registration OFF and all production tokens/stores untouched.

## 9. Open prerequisites and release decision

Not yet verified: exact VideoCore staging project identity/access, absence of
existing remote data, migration ledger/managed dependencies, exposed schemas/RLS,
SMTP/TOTP and Resend domains, private Blob/store isolation, private Broadcast,
Vercel runtime/protection/callback routing, secret scopes, real connection races,
quotas/large payload performance, backups/restoration and all real-user gates.
No remote-connected Supabase tool or authorized project link was available for
this preparation. Credentials should be configured out of band, not pasted here.

Preparation validation: all eight migration checksums match; the read-only
post-migration inspection executed successfully against the local PGlite fixture
(11 expected RPC grants, 28 RLS-enabled application tables, only the two intended
authenticated private helpers, no unexpected column writes). The 144 focused
account/library, publishing/logo, workspace, cloud, plan, organization and
collaboration tests passed without failures/skips. This validates the procedure's
SQL syntax and existing local contracts, not the new hosted project. All 245
protected/unrelated-file hashes remained unchanged. No application source or
migration file was edited, and no browser or hosted test was claimed for this pass.

Known repository configuration gaps: no CLI config/link, no ignored secret-file
patterns, no Node engines pin, no committed deployment/migration CI workflow,
explicit production viewer fallback if its variable is omitted, and publishing
upload/response size mismatch above. These are preparation findings, not changes
silently applied to infrastructure or unrelated application code.

Request approval with the verified target sheet, exact candidate SHA/checksums,
proposed migration/configuration operations, recovery evidence and test owners.
Deployment approval is separate. Keep Phase 6.6 implementation, billing and public
registration out of this preparation.

## References

Repository source: `supabase/migrations/`, `api/account-config.js`,
`src/server/publishing.js`, `src/server/organizationEmail.js`, `api/project.js`,
`src/liveCollaborationUi.js`, `src/engine/collaborationConflicts.js`, `vercel.json`.
Detailed policies: [Accounts](accounts-workspaces.md), [Publishing](secure-publishing.md),
[Cloud](cloud-projects.md), [Plans](plans-entitlements.md),
[Teams](organizations-teams.md), [Operation store](collaboration-operation-store.md),
[Live](live-collaboration.md), [Conflicts/undo](collaboration-conflicts-undo.md).

Provider references checked for this preparation:
[Supabase environments](https://supabase.com/docs/guides/deployment/managing-environments),
[migration dry-run](https://supabase.com/docs/guides/local-development/cli-workflows),
[Auth configuration](https://supabase.com/docs/guides/auth/general-configuration),
[trusted user creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
[SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Realtime authorization](https://supabase.com/docs/guides/realtime/authorization),
[database Broadcast](https://supabase.com/docs/guides/realtime/broadcast),
[Vercel payload limits](https://vercel.com/docs/functions/limitations),
[Blob client callbacks](https://vercel.com/docs/vercel-blob/client-upload).
