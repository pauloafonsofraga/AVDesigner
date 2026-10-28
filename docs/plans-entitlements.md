# Accounts Phase 4: plans and entitlements

Implementation only: no deployment, production SQL, environment changes, public
registration, billing or collaboration is enabled by this change.

## Interface and policy

Device Editor > Defaults > Account now includes Plans & Usage for every workspace
the signed-in user belongs to. It shows the effective plan, role, feature flags,
used/reserved storage, project/publication counts, maximum per-project history use
and available limits. Refresh Plans reloads current server data. Authentication and
personal-library reads do not depend on the optional plan-status panel succeeding.

An MFA-verified Platform Admin additionally gets Plan Administration. Enter a
workspace UUID (shown in its member's plan summary), Load Plan, then Assign Plan
or Revoke Plan. The interface supports Free, Paid and Enterprise; Enterprise can
only be assigned to an organization-kind workspace. No list of private customer
projects, project names, file bytes or memberships is exposed by this interface.
The privileged assignment lookup returns billing-policy metadata only.

Configure Plan edits the central feature flags and numeric limits. Blank means
unlimited; zero means no capacity. Assignments/configuration use revision checks,
and successful edits append an immutable-to-users private audit event. An admin
must reload stale assignment/configuration data instead of overwriting it.

New workspaces, including a new user's personal workspace, start Free. Existing
workspaces are backfilled Free without rewriting or deleting any existing data.
Revoke preserves the recorded assignment but makes Free the effective plan.
Assigning a plan again reactivates it. Workspace Owner/Admin roles cannot edit
subscriptions; only the separate Platform Admin role with current verified TOTP
and a provider-verified aal2 session can do so.

Initial configurable defaults (product policy values, not billing tiers):

| Limit | Free | Paid | Enterprise |
| --- | ---: | ---: | ---: |
| Cloud projects | 3 | 100 | 1,000 |
| Storage | 100 MiB | 5 GiB | 50 GiB |
| Versions per project | 5 | 100 | 500 |
| Concurrent live/pending publications | 0 | 25 | 250 |

All three plans initially enable cloud saving and version recovery. Publishing
is enabled for Paid and Enterprise. These values live in one private database
catalogue, not conditional checks scattered across the editor. Local editing,
local Save/Save As, .avd loading, local exports and personal-library reads remain
unchanged. Library artwork/registry growth is subject to the same storage policy.

Platform Admin gets all defined feature flags and unlimited plan quotas, including
future centrally defined keys. This override still requires membership and a
write-capable role in the target workspace. It does not grant access to another
customer's workspace. Admin authoring/API authority remains independent of plans.

## Enforcement and accounting

The public cloud/library RPCs wrap the existing tested implementations. Their
unmetered functions move into the private schema and lose all browser execution
grants; keeping an old client, forging plan flags or directly invoking a private
function cannot avoid enforcement. All new tables have RLS enabled and no browser
table grants. Public plan status is restricted to the caller's memberships.

Every quota-relevant write locks the workspace before checking current membership,
plan and usage. Reservations and plan reassignment use the same workspace lock.
Writers take SHARE locks on the selected plan-definition row; configuration writes
take its exclusive lock. Quota measurements are recomputed inside the mutation
transaction, not trusted from the browser or a cached account identity.

- Projects count includes archived projects and unexpired reservations for new
  projects. Archiving is not a quota bypass. Cancel/expiry releases reservations.
- Storage counts immutable project snapshots/history, live staging reservations,
  personal library artwork and registry JSON, and all registered publication byte
  reservations. It is logical application storage, not a provider billing meter.
- Duplicate/recover allocate another immutable snapshot and consume storage/history.
  Each pending save reserves one history slot for its project; parallel stale
  writers cannot reserve the last slot twice. Cloud revision CAS remains unchanged.
- Begin, chunk and finalize recheck the current plan. Lowering quotas or disabling
  a feature while an upload is pending can block it; cancel remains available.
  A failed finalization never replaces the valid cloud head or removes history.
- Over-limit downgrades retain every project, asset, version and existing viewer.
  Read/open/list, local save/export, cloud rename/archive/restore and cancellation
  remain available. Positive cloud writes can remain blocked until an upgrade;
  no automatic history pruning or destructive quota cleanup is performed.
- Content-identical library artwork is charged once; registry shrink/deletion is
  allowed even when over quota. New/growing metadata and artwork must fit storage.

Publishing now authorizes write-capable members through the workspace plan, rather
than requiring a legacy publisher allowlist row for every newly Paid account.
An explicit disabled publisher row remains an operator kill switch. Public API
calls still verify the bearer with Supabase Auth, allocate immutable paths on the
server, enforce ownership, throttle requests and validate upload sizes, types and
password metadata. Optional workspaceId chooses an authorized organization; absence
uses the user's personal workspace. The existing editor publishes to personal by
default; Phase 5 can expose organization publishing selection.

Admin publishing overrides use AAL only from the exact Auth-verified JWT, with a
matching subject, followed by database role/factor checks. A request-body flag,
user metadata, a forged account ID or unverified token cannot elevate it. Upload
token authorization and finalization both recheck entitlement. Already issued
short-lived Blob tokens may finish uploading after downgrade, but cannot finalize
a now-forbidden publication. Existing password-protected lookup is plan-independent;
owners can revoke their publications after downgrade or loss of membership.

Revoked/expired publication reservations conservatively continue consuming storage:
their private Blob files may still exist. Revoke frees live publication count, not
physical storage. Unregistered legacy Blob objects cannot be inferred from SQL and
must be inventoried before release. No automated Blob deletion, storage reclaim or
retention policy is introduced. Cloud staging expiry/cleanup remains as in Phase 3.

## Migration and release prerequisites (instructions only)

1. Back up Auth, memberships, personal libraries/artwork, cloud snapshots/history,
   publications and Blob storage. Test restore. Record original checksums/counts.
2. Apply once in order, skipping already-applied migrations:
   202609290001_owner_library.sql, 202610270001_secure_publishing.sql,
   202610280001_accounts_workspaces.sql, 202610280002_cloud_projects.sql, then
   **202610280003_plans_entitlements.sql**. Run with a trusted migration role.
   The new migration is transactional, attaches existing registered publications
   to their owner's personal workspace, and backfills Free assignments only.
3. Confirm each workspace has an assignment, no browser roles can execute the
   unmetered RPCs or write/read plan tables, and the private schema is not exposed
   through PostgREST. Keep the publishing RPC service-role-only. Check that custom
   deployment grants/policies do not create alternate upload/write paths.
4. Provision/verify the existing Phase 2 Platform Admin role and TOTP, then assign
   desired plans explicitly. Existing owners/publishers are not silently upgraded.
   Their old viewers stay readable, but new publication attempts require Paid,
   Enterprise or an MFA-verified Admin override. Review initial defaults before
   production approval and account for pre-existing over-limit workspaces.
5. No new environment variables or client secrets are needed. Preserve existing
   Supabase settings, server-only service key, Blob token and isolated viewer
   origin. Keep all registration gates and anonymous sign-ins OFF.
6. In real staging, validate all workspace roles with separate users, MFA elevation
   and removal, forged claims, Enterprise isolation, library growth, exact quota
   boundaries, two-connection concurrent reservations/finalizations and plan/config
   changes while uploads are active. Local PGlite tests interleave reservations but
   do not certify hosted multi-connection locking, SMTP, JWT or Blob behavior.
7. Verify existing/historical .avd and asset round trips, existing password viewers,
   new Paid publishing, quota-denied uploads, lost responses, provider-token expiry,
   large-project timeouts/capacity, database/Blob storage inventory and backups.
   Retain the pre-existing broad account-library download-test limitation recorded
   in docs/secure-publishing.md; verify actual local downloads in staging.
8. Release SQL, publishing server code and the account UI together after approval.
   Old tabs remain subject to server policy. A missing status RPC displays a plan
   information error without preventing sign-in or local work. No release occurs
   during this implementation.

Rollback by disabling affected UI/actions while retaining the policy RPCs, plans,
audit trail and all user data. Do not restore public unmetered functions or the
older unmetered publishing endpoint as a workaround. A billing-provider integration
will need a separately authenticated/idempotent webhook and explicit handling of
manual overrides, provider events and revision conflicts. Reserved provider/ref
columns are private preparation only; no Stripe API, checkout or billing runs now.

## Validation

`test/plans.test.mjs` executes the real migrations/RLS and metered RPCs: default
Free, migration preservation, assignments/configuration, MFA and privilege denial,
quota boundaries/reservations, plan changes during upload, old-version reads,
Enterprise isolation, artwork accounting, publishing and revoked-plan access.
`test/planPublishingSecurity.test.mjs` exercises verified AAL propagation and the
actual Paid API/SQL/password-viewer workflow across downgrade/revocation.
`scripts/plans-smoke.mjs` runs the full Engine/account UI in Chrome against actual
SQL/RLS with locally simulated Auth issuance, checking Admin controls, configurable
limits, Free denial, upgrade, downgrade, preserved projects and organization plans.
