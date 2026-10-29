# Phase 6.6D: staging database initialization

Date: 2026-10-29. Repository branch: `engine-prototype`; starting documentation
commit `18befc3053d274ceae1476a4e1629903d66824c7`.
Exclusive target: `puyrylatmtcwlvyycplc`, **WireNexus Staging**, VideoCore,
`ACTIVE_HEALTHY`, `eu-west-1`, PostgreSQL `17.11.0.003`.

## Outcome

All eight approved migrations applied successfully in dependency order. The
hosted ledger contains exactly eight entries, and the stored SQL for each entry
has the same byte count and SHA-256 as its original file in the Phase 6.6A manifest.
No historical migration file was edited and no additional migration was applied.

The existing SQL preflight executed successfully against hosted Supabase, followed
by explicit catalogue/grant assertions and read-only role-denial probes. All of
those database checks passed. Authentication restrictions were verified unchanged.

**Stopped at an additional external Data API schema-exposure check:** a read-only
GET `/rest/v1/` with the browser-safe publishable key and
`Accept-Profile: wirenexus_private` returned HTTP 401, message
`Secret API key required`, rather than the expected HTTP 406/PGRST106 schema-list
response. The checker exited nonzero; no subsequent Supabase operations were run.
This is an unresolved verification prerequisite, not evidence that the private
schema is exposed or that the migrations failed. No secret was retrieved to work
around it. Inspect the exposed-schema list through an authorized Dashboard or
read-only management view before calling the entire external API surface verified.

Database initialization is complete; end-to-end staging security/application
acceptance is **not** claimed. No resets, destructive recreation, corrective SQL,
configuration change, user provisioning or application deployment was performed.

## Before applying

Fresh read-only checks confirmed:

- Exact target ID/name/healthy status matched the approved staging project.
- Migration list empty; no `wirenexus_private` schema, public functions or
  application tables/views/sequences; no existing application policies.
- Zero Auth users/identities/sessions/MFA factors and zero Storage buckets/objects.
- Supabase-managed Auth, Storage and Realtime objects retained; this was
  application-empty, not a physically blank PostgreSQL installation.
- Required Auth/JWT/MFA, SHA-256/UUID and managed Realtime functions existed;
  managed `realtime.messages` RLS was already ON.
- All eight original checksums matched `docs/staging-migrations.sha256`.
- Auth API: HTTP 200, `disable_signup=true`, `anonymous_users=false`,
  email enabled and `mailer_autoconfirm=false` (confirmation required).
- Initial Supabase security advisor returned no findings.

Current Supabase changelog topics were reviewed: PostgreSQL 17.11 extension/operator
changes do not require modifying these fresh built-in-only migrations; managed
Realtime changes permit message-table RLS policies but not managed object/ownership
DDL. Migration 8 only adds the approved policies there, not replacement tables or
functions. No SMTP, Realtime service/privacy setting or production target changed.

## Applied ledger and source provenance

The MCP migration runner allocates its own 14-digit ledger versions. Each migration
name retains the complete original file stem, including its original version.
Every stored `statements` array has exactly one element containing the unchanged
original SQL; the SQL SHA-256 values below match the existing manifest exactly.

| Order | Original migration | Hosted ledger version | Recorded bytes |
| ---: | --- | --- | ---: |
| 1 | `202609290001_owner_library.sql` | `20261029094042` | 5,671 |
| 2 | `202610270001_secure_publishing.sql` | `20261029094059` | 6,248 |
| 3 | `202610280001_accounts_workspaces.sql` | `20261029094109` | 14,074 |
| 4 | `202610280002_cloud_projects.sql` | `20261029094122` | 12,768 |
| 5 | `202610280003_plans_entitlements.sql` | `20261029094131` | 22,432 |
| 6 | `202610280004_organizations_teams.sql` | `20261029094137` | 25,444 |
| 7 | `202610290001_collaboration_operations.sql` | `20261029094144` | 17,628 |
| 8 | `202610290002_live_collaboration.sql` | `20261029094210` | 9,490 |

| Source version | SHA-256 of original file and recorded SQL |
| --- | --- |
| `202609290001` | `050d5d4c74bb04ffff2d866c11649af24e1d36bba6dba0c2f5e2a4cc477cd000` |
| `202610270001` | `6cf33d7173d3bf9035781feb75c5c1faded79d22aa8c537c26da50bb8205c903` |
| `202610280001` | `8d51bf316c18f1892b184d37d9bf59f6876f437b4dc5928512263b7a3132b682` |
| `202610280002` | `d66f9360d7b28643a7ce8a986f6ae54700425c306705c9030a7ba089f5418ebe` |
| `202610280003` | `0eda7f4d1f95c5a778d9114da91a1dfba63e347ec51738c5e2d5f57f7c3e2423` |
| `202610280004` | `27b1c2e255ce613a69cb86ac109765518322bb385180208922b61c97b244df54` |
| `202610290001` | `a305870037cdebae67bde6853a493e8be8f344cfac28cdf4decb4b58d0fec811` |
| `202610290002` | `06400ef83b3d66b4784d6731d816d465ab04686e62696d0a68576683c15961a4` |

**Future CLI caution:** local filename versions and hosted runner versions differ.
Do not blindly run `supabase db push` from the original migration directory; it
can treat already-applied source versions as pending. Preserve the files and this
mapping. Any CLI ledger reconciliation/repair must be separately reviewed and
approved using names, order and exact stored-SQL checksums. No repair, history
rewrite, squash, rename or replay was performed in this task.

## Hosted SQL verification

The complete, unchanged [staging-preflight.sql](staging-preflight.sql) executed in
a read-only transaction without SQL errors. Its final settings result was
`checkpoint_every=50`, `max_project_bytes=3145728`. Because the remote query API
returns only the last result set of a multi-statement script, additional read-only
aggregate queries exposed and checked the preceding security results explicitly:

- All **28** expected application tables present with RLS enabled; no missing tables.
- No anonymous table privileges; no authenticated table-level INSERT/UPDATE/DELETE.
- Authenticated private SELECT allowlist exactly `artwork`, `cloud_projects`,
  `cloud_versions`, `library`, `organization_artwork`, `organization_library`.
- Column UPDATE grants exactly profile `display_name`, workspace `name` and
  `organization_settings`; no other direct column writes.
- All **11** public RPC signatures present with expected effective grants.
  The six account/library/cloud/plan/organization browser RPCs permit authenticated
  callers, not anonymous callers. The five publishing/invite/collaboration/live/
  throttle service RPCs deny authenticated/anonymous execution and permit service_role.
- All 11 RPCs have their approved SECURITY DEFINER boundary and fixed empty search
  path. Private authenticated execution is limited to `platform_admin` and
  `workspace_role`; no anonymous private function execution.
- All **7** expected application triggers present and enabled: registration guard,
  account provisioning, workspace plan, organization library/settings, accepted
  operation notification and membership-change notification.
- All **14** expected policies present and reviewed: own-account predicates,
  membership-based workspace/project/version/company-library access, Owner/Admin
  rename checks, own Realtime inbox plus restrictive receive/send namespace rules.
- `live_presence` is UNLOGGED as designed. Policy-based access was not replaced
  by public table reads or application-supplied role flags.
- Registration database policy is false/closed. Auth users, Platform Admins and
  workspaces remain zero; no unintended bootstrap owner/Admin was granted.

Read-only `SET LOCAL ROLE` probes, rolled back afterward, also passed:

- `anon` cannot read profiles, execute the account RPC or execute the service-only
  collaboration RPC (expected SQLSTATE 42501, caught as an expected denial).
- `authenticated` without user identity cannot use account identity, plan status
  or organization listing, or directly execute the service-only operation RPC.
- Such a session sees zero profiles, workspaces and memberships.

These checks establish installed RLS predicates/grants and unauthorized-identity
denials. With no provisioned users/data, they do **not** prove two real customers'
data isolation, verified JWT/MFA enforcement, quotas under concurrency, real socket
delivery or application workflows. Those require separately approved test accounts
and staging runtime validation. No fake Auth rows, real users, project data or
persistent test functions were inserted to simulate acceptance.

## Advisor notices reviewed

Post-migration security advisors reported these expected design notices, not a
clean advisory list:

- **19 INFO** [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy):
  private service/RPC-only policy, admin, upload/chunk, operation/presence and audit
  tables deliberately deny direct browser access. RLS and revoked grants were
  verified; adding permissive policies would weaken the approved architecture.
- **6 WARN** [authenticated SECURITY DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable):
  exactly the six approved browser RPCs. Their user/account/workspace authorization,
  empty search paths, anonymous denial and inaccessible unmetered helpers are the
  intended trust boundary. Do not flip them to SECURITY INVOKER or grant direct
  writes to silence the warning. Real-user authorization validation remains a
  staging prerequisite; this report does not suppress these findings.

No unapproved security repair was attempted. The subsequent external schema probe
stopped further remote checks as described above.

## Authentication unchanged

Before and after migration, the same Auth settings API values were observed:

```json
{"status":200,"disable_signup":true,"email_enabled":true,"anonymous_enabled":false,"mailer_autoconfirm":false}
```

The new approved database registration guard is closed independently. No Auth
service setting, TOTP setting, SMTP/template, Site URL or global Realtime privacy
setting was changed. Phase 6.6C's remaining configuration findings are not resolved
by installing database policies. No password, backend secret, service-role key,
database credential or project body was exposed. Only the browser-safe publishable
key was used for read-only HTTP checks; its value is not included in this report.

## Remaining staging requirements and recovery

1. Resolve the stopped Data API exposed-schema verification using approved
   read-only configuration access; confirm `wirenexus_private` is not exposed.
   No backend secret needs to be pasted into chat or retrieved as a shortcut.
2. Separately approve private-only Realtime (public channels were ON in 6.6C),
   controlled SMTP/code-entry templates, approved staging Auth URLs, password
   policy review and isolated server/Blob/Resend environment bindings.
3. Separately approve synthetic users, MFA Platform Admin and Enterprise company
   provisioning; then real cross-account/workspace, quota/concurrency, cloud
   snapshot/artwork, publishing, revocation and collaboration recovery tests.
4. Preserve existing local `.avd` behavior, original artwork and unrelated work;
   address large-viewer response limits only in an independently scoped change.
5. Keep all tables/RLS, immutable versions, operation logs and snapshot-save guards
   during rollback. There is no reason to reset this successfully initialized
   database. Back up any later test data and recover into a separate project.

Only documentation changes are committed for this phase. The eight historical
files and manifest are untouched. No app deployment, user provisioning, SMTP/
Realtime configuration changes, production/development changes or destructive
database operation occurred. No new local full-suite or real-browser functional
test pass is claimed; the verification above ran on actual hosted PostgreSQL.
