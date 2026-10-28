# Accounts Phase 3: private cloud projects

Phase 4 adds server-enforced workspace plans and quotas on top of these storage
operations; see [Plans & Entitlements](plans-entitlements.md). The Phase 3 closure
record below describes its approved implementation before that policy layer.

This change does not deploy, apply production SQL, change environment settings,
enable registration, or add billing or simultaneous editing.

## Phase 3 closure: complete (2026-10-28)

Implementation and local regression verification are complete on engine-prototype.
The approved implementation commit is
`a1ab83918d0a5a638e341bb021ede4400d6454f0`, verified on GitHub before closure.
This closure changes documentation only, not the approved application or SQL.
Production readiness remains conditional on the staging checks below; Phase 4
has not started.

Fresh verification ran from an isolated archive of that exact commit, excluding
unrelated working-tree changes:

- `node --test`: 2,144 passed, zero failed, skipped or canceled. This includes the
  nine focused cloud tests and existing local Save/Save As, shortcut, dirty-state,
  account isolation and historical project compatibility regressions.
- All 16 `scripts/*-validation.mjs` static validators passed.
- `scripts/cloud-projects-smoke.mjs` passed: Cloud Save/Open, actual .avd loading,
  embedded artwork/topology, browser rename/duplicate/archive/restore, recovery,
  earlier-version opening, stale-save conflicts, interrupted uploads, edits during
  upload, project switching and desktop/mobile layout.
- `scripts/accounts-workspaces-smoke.mjs` and
  `scripts/publishing-auth-smoke.mjs` passed, retaining existing authentication,
  MFA, account isolation, publishing-token and local-project behavior.
- Actual migration/RPC tests enforce workspace roles, read-only Viewers, revoked
  membership and cross-user denial, including an MFA-verified Platform Admin.
  Failed/corrupt uploads and stale revisions retain the valid cloud head/history.
- Local Save/Save As implementations and .avd format are unchanged. Cloud operations
  reuse serialization/loading; no account IDs or ownership schema enter .avd files.

Browser Auth issuance is locally simulated and database tests use PGlite. These
passes do not certify a hosted Supabase installation. Before any deployment,
follow Migration and deployment below: backups/restoration, migrations in order,
private-schema/RPC/RLS grant checks, real staging accounts for all workspace roles,
real JWT authorization, two-browser conflicts, failed transfers, historical artwork
round trips and representative maximum-size performance/capacity checks.

Remaining limitations are intentional: 64 MiB snapshots, eight pending uploads per
account, 24-hour staging expiry, no automatic merge, quotas/retention, billing or
simultaneous editing. Lost finalization responses require catalogue refresh before
retrying. The pre-existing broader account-library .avd download timeout remains
documented below; a real-browser local-download staging check is still required.
Unrelated work and artwork were preserved. No production data, migrations,
environment settings or registration gates were changed during closure.

## User workflow

Sign in through Device Editor > Defaults > Account. The main toolbar now has
separate **Cloud Save** (Save to Cloud) and **Cloud Open** (Open from Cloud)
actions. Local Save, Save As and Cmd/Ctrl+S still save local files exactly as before.

Cloud Save opens a workspace/name chooser. A project loaded or saved in cloud
can save a new version in its linked workspace, or Save Separate Copy. New/local
projects create a new cloud project. Cloud Open lists active projects in a chosen
workspace. Each row supports Open, Versions, Rename, Duplicate and Archive;
the Archived filter exposes Restore. Viewer members see only Open and Versions.
Names in this browser are cloud catalogue names; renaming does not rewrite the
project's authored projectName or title blocks inside its .avd snapshot.

Versions supports opening an earlier snapshot or Recover as Latest. Recovery
creates a new latest version; it never deletes or rewrites history. Opening an
earlier snapshot detaches the latest-version save target, so its next cloud save
creates a separate project. Recovery from the browser leaves the current canvas
alone; open the recovered project explicitly. New and successful local-file opens
detach the cloud target. Local Save/Save As do not change the cloud target.

Saving marks only the captured snapshot as saved. Edits made during upload stay
dirty. Failures/conflicts do not mark anything saved. Cloud open asks before
discarding unsaved changes. Closing the project browser does not change a project.

## Storage and authorization

The existing projectJsonPayload serializer embeds complete .avd data and resolves
its artwork/dependencies before any upload begins. Cloud data is the exact UTF-8
snapshot, not a partial list of objects. No schema or account IDs are added to .avd.
Historical files continue through the existing compatibility-aware loader.

Private Supabase PostgreSQL tables store metadata, immutable versions and binary
snapshot chunks. This phase deliberately uses no public/private Storage bucket,
Vercel Blob path, signed asset URL or browser-selected storage path. Embedded
images remain inside the private project snapshot. Staging uploads and bytes have
no direct browser table grants; all file access uses the authenticated RPC.
Metadata/version SELECT is workspace-filtered by RLS; mutations are RPC-only.

Owner, Admin and Editor membership grants project writes; Viewer grants reads.
No role can choose an account identity or bypass workspace membership. Platform
Admin has no customer-project bypass. Enterprise-kind workspaces already
provisioned under Phase 2 can contain shared projects, but this is sequential
versioned editing, not live collaboration or an invitation/product-management UI.

The client sends expectedAccountId on every call, including each chunk download.
Account changes cannot silently redirect an old project's save to a new account.
Local New/load during a save prevents its result from being applied to the new
canvas. Already authorized requests may complete in their original workspace.

## Uploads, integrity and conflicts

- Maximum snapshot: 64 MiB UTF-8, including embedded images. Larger projects can
  still use local Save As. Chunks contain at most 192 KiB binary (256 KiB base64).
- begin reserves a server-generated upload/project identity, not a visible project.
  An account may have eight pending uploads. Uploads expire after 24 hours.
- Each chunk is private to its initiating user and requires current write membership.
  A revoked membership, switched account or expired upload cannot finalize.
- finish validates chunk count, total bytes, SHA-256, UTF-8 and basic .avd JSON
  structure. It locks the project and compares the originally expected revision.
  Only then does one transaction publish the version and advance the head.
- Content, rename, archive and recovery mutations all compare revisions. A stale
  save never silently overwrites. The user can open the latest snapshot or Save
  Separate Copy. No automatic merge or force-overwrite operation exists.
- A failed upload is canceled best-effort; expired staging is removed on that
  user's next begin. Committed history never expires or gets removed by cleanup.
  Operators can periodically delete only uncommitted expired upload rows (chunks
  cascade), never uploads referenced by committed versions.
- If finalization succeeds but its HTTP response is lost, the UI conservatively
  leaves the canvas dirty. Refresh/open the catalogue before retrying; do not
  assume the server did not save. No automatic retry can overwrite a newer head.
- Downloads pin an immutable version ID and verify byte count and SHA-256 before
  exposing content to the existing loader. Database integrity checks are independent
  of the browser. Duplicate/recover copy a verified immutable snapshot server-side.

## Migration and deployment (instructions only)

1. Back up Auth, all private account/library tables, memberships and Phase 1
   publishing metadata. Retain the existing .avd local recovery path.
2. Apply once in this order, skipping already applied migrations:
   - 202609290001_owner_library.sql
   - 202610270001_secure_publishing.sql
   - 202610280001_accounts_workspaces.sql
   - 202610280002_cloud_projects.sql
   Use a trusted database migration role. The new migration is transactional and
   does not rewrite existing users, personal libraries or publications.
3. Keep wirenexus_private outside the PostgREST exposed schema list. Only public
   wirenexus_cloud(text,jsonb) is callable. Keep anonymous sign-ins and public
   registration disabled, with all Phase 2 signup gates closed.
4. Keep the Phase 2 browser-safe Supabase URL and publishable key. There are no new
   credentials or environment variables. Existing server-only service-role/Blob
   credentials remain server-only; this feature does not need them in the browser.
5. Verify public RPC execution grants, all four new tables' RLS, no anonymous or
   direct write/chunk grants, and no unexpected policies inherited from custom
   deployments. Database owner/service credentials remain privileged and must not
   be exposed. Preserve Phase 1 publishing isolation and ownership policies.
6. In staging, test two real accounts, a shared workspace with each role, recovery,
   network interruption, two-browser save conflicts, and representative historical
   .avd files/artwork. Validate largest expected projects against the instance's RPC
   request size/statement timeout, database memory, disk and backup budgets before
   production release. PostgreSQL stores base64 artwork within the snapshot, so
   retained history consumes database capacity; storage quotas/retention are not
   a billing system and are not implemented here.
7. Release the scoped UI/modules together after SQL and staging approval. Refresh
   older tabs. An installation without the new RPC fails cloud operations safely;
   local projects remain usable. There is no deployment in this task.

Rollback by hiding/reverting only cloud UI integration, retaining tables, versions
and access policies. Never revert to public files or weaken RLS. Do not drop cloud
data on rollback; restore service with a compatible RPC and preserve new versions.

## Verification

node --test test/cloudProjects.test.mjs runs the actual Phase 1/2/3 migrations and
permissions in PGlite: complete payloads, byte-preserving artwork/dependencies,
version recovery, archive/restore, duplicates, cross-user and Platform Admin
denial, Enterprise Viewer/Editor, direct RLS/grants, broken/expired uploads,
immutable chunks, revision conflicts, account switching and download integrity.

scripts/cloud-projects-smoke.mjs uses Chrome, the full Engine app, the real bundled
Auth SDK and actual local SQL/RLS. Email/JWT issuance is simulated locally; this is
not a claim of production Supabase, SMTP or network acceptance. It exercises the
actual .avd loader, cloud browser, failed upload, stale-save/copy handling, archive,
rename/duplicate, recovery, dirty state and desktop/mobile layout.

The pre-existing broad account-library .avd download timeout documented in
docs/secure-publishing.md remains outside this scope; local save code/tests are
not weakened to bypass it. No billing, subscriptions, realtime sessions or conflict
merging are introduced.
