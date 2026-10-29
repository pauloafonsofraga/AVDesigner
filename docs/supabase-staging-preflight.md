# Phase 6.6B: Supabase staging preflight

Date: 2026-10-29. Branch: `engine-prototype`. Inspected repository baseline:
`a94a39c35ba15315904e845f34106fce481551ba` (application baseline `776ff65`).

Historical Phase 6.6B finding below: signup was enabled during that preflight.
It is now verified disabled in [Phase 6.6C](staging-security-configuration.md).
That follow-up inspects MFA/email/Realtime and does not apply migrations or deploy.

## Decision: inventory verified; setup approval still required

**Blocking configuration finding: public Auth signup is currently enabled.**
The hosted Auth settings endpoint returned `disable_signup=false`. Nothing was
changed to conceal or repair this during a read-only preflight. Approval to disable
signup is required before proceeding with the proposed staging setup. No signup
request or test-user creation was sent.

Target verified through the newly connected Supabase integration:

| Identity | Verified result |
| --- | --- |
| Project reference | `puyrylatmtcwlvyycplc` |
| Project name | `WireNexus Staging` |
| Dashboard | https://supabase.com/dashboard/project/puyrylatmtcwlvyycplc |
| API URL | `https://puyrylatmtcwlvyycplc.supabase.co` |
| Status / region | `ACTIVE_HEALTHY` / `eu-west-1` |
| Database version | PostgreSQL `17.11` |
| SQL inspection | `postgres`, explicit READ ONLY transactions; `transaction_read_only=on` verified |

An initial browser attempt redirected to Supabase sign-in. Access subsequently
became available through the Supabase integration and the hosted checks below
were completed there. The earlier browser sign-in obstacle is **not** the current
database-access blocker. No browser login or configuration form was submitted.
The user designates this project as isolated staging; its verified reference/name
match. Vercel/Blob/mail resource isolation still needs independent confirmation.

## Hosted inventory

| Check | Verified result |
| --- | --- |
| Application migrations | Empty migration list; no `supabase_migrations.schema_migrations` table |
| Application schema | No `wirenexus_private`; no tables/views/materialized views/foreign tables/sequences in `public` or `wirenexus_private` |
| Application functions | No public functions or `wirenexus_*` RPCs |
| Schemas | Only managed/default `auth`, `extensions`, `graphql`, `graphql_public`, `public`, `realtime`, `storage`, `vault` |
| Auth data | 0 users, 0 identities, 0 sessions, 0 verified TOTP factors |
| Storage | 0 buckets/objects; 0 analytics/vector buckets or vector indexes; 0 pending multipart uploads/parts |
| Vault | 0 secret records (COUNT only; no secret values accessed) |
| Realtime | Managed `messages` table exists with RLS ON; 0 subscription rows; no message-table application triggers |
| Policies | No policies in `public`, `wirenexus_private`, `storage` or `realtime` |
| Edge Functions | None deployed |
| Advisors | Security and performance both returned no findings; this is not application readiness approval |
| API credentials | One active modern publishable key and one active legacy anon key available; values not printed or committed |

This is **application-empty**, not a physically empty PostgreSQL installation.
Supabase-managed migration metadata already exists (Auth 82, Storage 74, Realtime
91 rows); preserve it. Non-system base tables were inventoried across all schemas,
not just `public`. No customer projects, accounts, application tables or stored
assets were found in the checked inventory. No managed row contents, passwords,
refresh tokens, provider secrets or project bodies were read.

Required migration dependencies exist: `auth.uid()`, `auth.jwt()`,
`auth.mfa_factors`, `sha256(bytea)`, `gen_random_uuid()`, `realtime.messages`,
`realtime.topic()` and `realtime.send(jsonb,text,text,boolean)`. No substitute
Realtime tables/functions or extension installation is proposed.

Default managed grants allow `anon`/`authenticated` SELECT/INSERT privileges on
`realtime.messages`, but RLS is ON and there are no policies. These table grants
alone do not prove client access or public Broadcast configuration. The application
must install its specific own-inbox/restrictive policies through migration 8;
never change managed ownership or disable RLS. `anon`/`authenticated` have public
schema USAGE but not CREATE, and there are no application relations to expose.

## Auth and remaining configuration gates

Read-only HTTPS GET `/auth/v1/settings` using the existing browser-safe publishable
key returned HTTP 200:

- `disable_signup=false`: **public signup enabled; fails the closed-registration requirement**.
- `external.anonymous_users=false`: anonymous sign-ins disabled.
- `external.email=true`, `external.phone=false`: email enabled, phone disabled.
- `mailer_autoconfirm=false`: email confirmation required.
- Other listed external providers disabled.

No user was created to probe signup. The application database registration guard
does not yet exist because migration 3 has not been applied. The local UI flag is
absent/default false, but it is not a server-side registration control. The three
gates must be verified closed after approved setup, not inferred from the UI.

The exposed-schema setting was absent from both the current SQL setting and
database/role settings. This does **not** prove the Data API's externally managed
exposed-schema list; Dashboard or read-only management configuration access is
still required. The current integration exposes database inspection but not Auth
or Realtime configuration retrieval. Remaining hosted checks:

- Realtime Allow public access OFF/private Broadcast settings, connection limits
  and actual private-socket delivery after policies/users exist.
- Full Auth configuration: Site URL/redirect allowlist, OTP/recovery templates,
  SMTP delivery, password policy, TOTP enrollment/challenge configuration and rates.
- Dedicated staging Vercel project/origins, runtime, deployment protection and
  signed Blob callback routing; distinct private Blob store and mail senders.
- Secret-manager/application environment binding, backend credential readiness,
  backup/restore evidence and quota/performance budgets.

These require an authenticated Dashboard account with permission to inspect those
settings, or an equivalent narrowly authorized read-only management connection.
Complete login/MFA directly with Supabase, never send passwords/codes/keys in chat.
No additional SQL credential is now required for catalogue inspection. A browser
login is needed only for settings that the connected integration cannot expose.

## Environment and credential availability

The integration's secure authorization successfully inspected the target. That is
not proof that the WireNexus server has its application credentials configured.
The publishable credential was used only for read-only Auth settings requests;
no privileged backend credential was retrieved, displayed or requested.

No following application variables are available in this process (presence-only
checks): `WIRENEXUS_SUPABASE_URL`, `WIRENEXUS_SUPABASE_PUBLISHABLE_KEY`,
`WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY`, `WIRENEXUS_REGISTRATION_ENABLED`,
`BLOB_READ_WRITE_TOKEN`, `PUBLIC_VIEWER_ORIGIN`, `WIRENEXUS_EDITOR_ORIGIN`,
`WIRENEXUS_INVITE_EMAIL_API_KEY`, `WIRENEXUS_INVITE_FROM`. A separately managed
Vercel/secret store was not inspected, so its configuration remains unknown.

Supabase CLI and `psql` are not on PATH; Vercel CLI is available. There is no
`supabase/config.toml`, project link, `.vercel/project.json`, `.env`, `.env.local`
or `.env.staging.local` in this checkout, nor `DATABASE_URL`,
`SUPABASE_ACCESS_TOKEN` or `SUPABASE_DB_PASSWORD` in this process. Do not place
secrets here: the current repository ignore rules do not exclude those files.
No keychain, unrelated project configuration or production secret store was searched.

## Exact proposed changes, pending separate approval

**None of these changes have been authorized or executed by the preflight request.**

1. First disable public signup on **this staging project only** and read back
   `disable_signup=true`; keep anonymous access disabled and confirmation required.
   Verify SMTP/templates/password/TOTP and exact staging Auth URL configuration.
   No temporary public signup is needed to create test accounts.
2. Apply the eight unchanged, checksum-verified migrations in order, with an
   approved atomic runner and backup/recovery procedure:

   | Order | Migration |
   | ---: | --- |
   | 1 | `202609290001_owner_library.sql` |
   | 2 | `202610270001_secure_publishing.sql` |
   | 3 | `202610280001_accounts_workspaces.sql` |
   | 4 | `202610280002_cloud_projects.sql` |
   | 5 | `202610280003_plans_entitlements.sql` |
   | 6 | `202610280004_organizations_teams.sql` |
   | 7 | `202610290001_collaboration_operations.sql` |
   | 8 | `202610290002_live_collaboration.sql` |

   The hosted application inventory and empty ledger match a fresh installation.
   Recheck immediately before applying; intervening users/schema changes invalidate
   that assumption. Do not reset/seed, edit managed migrations, import production
   data or mark unapplied migrations successful. Files 1/2 require runner-level
   atomicity; 3-8 contain explicit transactions. Then run the existing
   [post-migration read-only preflight](staging-preflight.sql) and verify the private
   registration row remains false and all intended RLS/RPC grants are installed.
3. Keep `wirenexus_private` out of exposed schemas; configure private Broadcast
   with Allow public access OFF. Migration 8 supplies the own-inbox and restrictive
   client-send policies. Do not add application tables to Postgres Changes.
   No Supabase Storage bucket is required by WireNexus.
4. Bind only the dedicated staging environment to this API URL and matching
   publishable/backend credentials through the secret manager, with explicit
   staging viewer/editor origins, private staging Blob and test SMTP/Resend.
   Never reuse production/development tokens, stores or variable scopes. Application
   service credentials remain server-only. Configuration and deployment approvals
   are separate; do not deploy to unblock this preflight.
5. Provision seven synthetic controlled-inbox Auth users P/A/B/C/D/E/F through
   trusted Admin `createUser` with
   `app_metadata.wirenexus_provisioned=true` and confirmed test emails. Grant P
   Platform Admin in its private role table, require verified TOTP/aal2 and keep P
   outside test companies. A/F create separate companies through existing RPC/UI;
   P assigns Enterprise with revision checks. A invites B(Admin), C/D(Editors),
   E(Viewer) through actual email acceptance. Do not directly insert memberships
   or seed the legacy singleton owner. Publishing requires a separate publisher
   grant and an eligible plan. Do not enable public registration.

Provisioning, exact environment requirements, validation matrix and nondestructive
rollback are specified in [the existing runbook](supabase-staging.md). Keep all
accepted operation logs, head/replay/checkpoint state, versions, RLS and active
collaboration snapshot-save guards during recovery; reconstruct into a separate
project. No automatic destructive cleanup is proposed.

## Real-service validation prepared, not yet run

After explicit setup/deployment approval, use isolated real sessions and independent
API/database connections to verify cloud snapshots/artwork/version recovery, stale
saves and failed uploads, role/workspace isolation, concurrent quota reservations,
private socket hints, revocation with existing JWTs, idempotent submissions,
cable/card/Jump/Loom/Multi-Core transaction races, selective own-operation undo/redo,
queued edits/drafts, disconnect recovery and checkpoint failure boundaries.
Preserve local `.avd` open/save/download/export behavior. Do not substitute a single
serialized PGlite connection or successful polling for real concurrency/Broadcast
evidence. The existing large publishing-HTML/hosted-response-size mismatch remains
a capacity gate, not an unrelated fix included here.

## Local and remote evidence boundary

- Clean archive of `a94a39c`, excluding unrelated working-tree changes.
- All eight originals match [the Phase 6.6A manifest](staging-migrations.sha256).
- 144 focused account/library, workspace, publishing/logo, cloud, plan,
  organization, operation-store, live and conflict/undo tests passed; zero failures/skips.
- Existing read-only SQL preflight executes **locally** against PGlite with
  `transaction_read_only=on`; 11 expected RPC grant checks and 28 application
  tables with RLS pass. These are post-migration fixture results, not claims that
  those tables/RPCs already exist on the hosted staging project.
- All 245 protected/unrelated-file hashes match. Original Device JSON Import
  edits, artwork, backups and Masters remain untouched and excluded.
- Hosted access used only project/URL/key-metadata/migration/table/function/advisor
  reads, explicit read-only SQL catalogue/COUNT queries, and GET Auth settings.
  No password, service-role key, database secret or full user record was exposed.
- No application source, migration, `.avd` format, remote configuration or
  production/development infrastructure changed. No deployment or user provisioning.

Preflight stops here. The first required approval is to close the currently enabled
staging signup setting; the proposed migrations/configuration/provisioning and any
deployment remain separate explicitly approved work.
