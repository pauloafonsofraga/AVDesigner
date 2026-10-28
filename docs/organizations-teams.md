# Accounts Phase 5: Enterprise organizations and teams

## Development status

Phase 5 development is complete. Approved implementation:
`e092cb83f6a90da26ab2f6c17561c10134ffd051` on `engine-prototype`.
Final closure on 2026-10-28 revalidates the isolated approved commit; this closure
changes documentation only. Production readiness remains conditional on the staging
and deployment checklist below, not on local test results alone.

Known limitations remain: invitees need verified, existing or trusted-admin-provisioned
accounts while registration is closed; library selection is session-local; switching
libraries retains editor drafts and may require Reload Saved Default; downloaded
local data cannot be recalled after revocation; organization deletion and PII
retention automation are not implemented. Simultaneous editing and billing remain
out of scope. The existing account-library download timeout still requires staging
verification as noted below.

Outstanding release gates include real Supabase RLS/grant and JWT checks with
separate users, independent-connection concurrency tests for invitations/seat quotas
and cloud/library conflicts, and actual email delivery, SPF/DKIM and invitation-link
verification. Migration ordering, server-only credentials, backups and rollback
must be reviewed before any separately authorized deployment. Phase 6 is not begun.

No deployment, production migration, public registration, billing, Auth account
creation or realtime collaboration is performed by this implementation.

## User workflow

Device Editor > Defaults > Account now includes Organizations & Teams. A verified
user can Create Company; this creates an enterprise-kind workspace, its Owner
membership, a Free plan and an empty, separate device library in one transaction.
Existing personal workspaces and libraries are not moved or renamed. The default
creation limit is five owned companies per user, configurable by a trusted database
operator in the private organization_policy table.

A company starts as a Free provisioning shell. A Platform Admin must assign its
Enterprise plan (or explicitly enable the central organizationTeams feature and
member quota) before ordinary users can invite teammates or write shared libraries.
Creating a company never self-grants an Enterprise subscription. Phase 4's plan
administration controls automatically include Enterprise teams and Members and
reserved invitations; initial seat limits are Free 1, Paid 1 and Enterprise 100.
Existing plan-specific values and quotas otherwise stay unchanged.

Owners/Admins can manage company name, HTTPS website and contact email. Settings
use revision checks; Owners/Admins retain management access after downgrade.
Invite email and Invite role send a real email through the configured server mail
adapter. Owner can invite/manage all four roles. Admin can invite/manage only
Editors/Viewers, never themselves or another Admin/Owner. Editors and Viewers
cannot manage settings, membership or invitations. Members can leave, but the
last Owner cannot leave, be removed or be demoted. Removing other members and
revoking invitations remains available after downgrade.

An invitation opens the editor and its Account dialog. Its secret is carried in
the URL fragment, removed from browser history immediately, and not sent as an
editor query parameter. The recipient signs in with the invited, verified email
and accepts. No role is inferred from the token alone or from browser/user metadata.
An existing member accepting a pending invite keeps their existing role; the link
does not silently elevate them. Role changes use the separate membership controls.

Public registration remains closed. Organization invitations deliberately do not
call Auth Admin inviteUserByEmail or create Auth users. Recipients must already
have a verified account, or use the trusted administrator-assisted provisioning
and verification process from Phase 2. Do not mark an email confirmed without
verification or expose the provisioning marker in a public API. An invitation may
be sent before provisioning, but it cannot be accepted until that account exists,
its email is verified and it is signed in. This is a known onboarding limitation.

## Shared projects and device libraries

Cloud Open/Save's existing workspace chooser exposes projects only in current
memberships. Owners/Admins/Editors can write shared projects; Viewers can read/open
and recover a local copy, but cannot modify server projects. All cloud versioning,
revision checks, upload integrity, private storage, publishing ownership and quota
checks remain active. No simultaneous editing, merge, realtime session or presence
protocol is introduced.

Active device library selects personal or company definitions using the same
existing library editor, asset protocol and persistence owner. Shared saves are
labelled Save to Shared Library and identify the workspace in the Defaults status.
Switching libraries does not rewrite the canvas or device-editor draft. Use Reload
Saved Default to edit a selected workspace's current saved version; retaining a
draft from another library can require reload before its revision check will pass.
The selection is session-local and returns to personal on a page reload/sign-in.

Owners/Admins/Editors can save definitions, dependencies and artwork to the selected
organization library. Viewers may load definitions and artwork but cannot upload,
commit, import recovery data or remove shared defaults. Personal and organization
registries/assets use separate database keys even if definition IDs or hashes match.
Company library favourites/order are shared workspace preferences, not a personal
preference copy. Browser recovery import remains an explicit reviewed action into
the active writable library; switching never automatically imports browser data.

Shared-library writes reuse version-2 registries, dependency validation, SHA-256
artwork verification, generation CAS and per-definition revision checks. Artwork
and registry growth are charged to the same workspace's storage quota. Missing
artwork, stale generations and quota failure retain the previous valid registry.
No personal/project file or artwork schema is changed.

Every fresh project/library RPC rechecks membership. Refresh Account, Refresh Teams
and the existing focus/library refresh update visible memberships and roles. Losing
access to the selected company library conservatively falls back to personal.
Cloud save binding detaches when its workspace is no longer a membership. Already
downloaded definitions and local project copies cannot be recalled, and are not
deleted or invalidated; local .avd save/editing remains available. Clients may show
cached data until refresh, but cannot use that cache to authorize a server write.

## Invitations and server permissions

Only the authenticated, service-backed organization-invite API can issue delivery
tokens. It reuses the verified Auth bearer, source-IP authentication throttle and
server-only Supabase client. SQL checks the verified actor's current organization
role, Enterprise teams entitlement, seat capacity and invite rate limits. A global
Platform Admin still cannot invite into or read a private company without membership.
Server AAL overrides come only from the exact Auth-verified bearer, as in Phase 4.

The database stores only a SHA-256 token digest. Tokens are single-use, normalized
email-bound and expire seven days after delivery. A pending delivery reserves a
seat for at most 30 minutes and cannot be accepted. The API activates it only after
the mail provider acknowledges; failure marks it failed and releases capacity.
Uncertain provider acknowledgement or a lost activation response can leave an
unusable emailed link; refresh/reissue rather than assuming membership was granted.
Reissue revokes older pending links. Revoked, expired, failed or consumed invitations
cannot join. Acceptance revalidates the inviter's current role, verified recipient
email, current plan and reserved-seat usage while holding the workspace lock.

Seat usage is current members plus live pending/sent invitations. Reservation,
acceptance, role changes, removal and leave operations take the same workspace row
lock as project quota writes and plan changes. Requests cannot overbook by accepting
or issuing simultaneously. Owner/Admin checks and last-Owner rules apply on the
server, not merely through dropdowns. Existing membership-foundation set_member
calls can change only existing members; they can no longer insert a new member
without invitation acceptance. Direct browser membership writes remain denied.

All new private tables have RLS enabled. Shared registry/artwork SELECT policies
are membership-scoped; writes are RPC-only. Invitation tokens, policy and bounded
audit details have no direct browser table grants. The delivery RPC is service-role
only; organization/member/settings RPCs authorize against auth.uid(). The private
schema must remain outside PostgREST's exposed schemas. There is no plan bypass,
new public upload path or change to the isolated password-protected viewer.

Security throttles initially permit 50 invitations/user/hour, 100/organization/hour
and 240 member-management operations/user/hour, in addition to the existing API Auth
source-IP limiter. Supabase/network-level abuse controls and real staging concurrency
checks remain necessary. Historical invitation/audit metadata is retained; no PII
retention automation or organization hard-delete operation is added.

## Migration and deployment (instructions only)

1. Back up Auth, profiles, memberships/workspaces, plans, personal libraries/artwork,
   projects/history and publications/Blob storage; test restore and record checksums.
2. Apply previous migrations in order, skipping applied versions:
   202609290001_owner_library.sql, 202610270001_secure_publishing.sql,
   202610280001_accounts_workspaces.sql, 202610280002_cloud_projects.sql,
   202610280003_plans_entitlements.sql, then **202610280004_organizations_teams.sql**.
   Use the trusted migration role. Existing organization workspaces receive empty
   separate libraries; personal registries, artwork and projects are not copied or
   rewritten. Plan definitions gain the team flag/seat limits and a new revision.
3. Verify RLS/grants, private-schema exposure, service-only delivery, organization
   settings column grants, and denial of private account_phase2/unmetered functions.
   Confirm migration compatibility and that each personal/company scope is intact.
4. Keep existing Supabase service credentials server-only. Configure these new
   server-only values only after deployment approval:
   WIRENEXUS_INVITE_EMAIL_API_KEY (Resend sending key), WIRENEXUS_INVITE_FROM (verified
   sender/domain), WIRENEXUS_EDITOR_ORIGIN (canonical HTTPS editor origin, not viewer).
   The adapter calls the fixed Resend /emails endpoint with plain text, a timeout
   and an invitation-ID idempotency key. It never trusts a client Host/origin/redirect.
   Missing configuration fails before reserving a token. Allow enough API execution
   time for Auth, SQL and the 10-second mail timeout. No mail is sent by local tests.
5. Retain Phase 2 SMTP/code-entry setup and all signup gates OFF. No invitation can
   enable registration. Verify invited accounts through the existing trusted process.
   Assign Enterprise to intended companies explicitly; do not auto-upgrade users.
6. In isolated real staging, use Owner/Admin/Editor/Viewer and nonmember accounts to
   test verified-email delivery/acceptance, wrong-account links, resend, expiry,
   delivery failure, inviter demotion/removal, last Owner, direct RPC/grant attacks,
   role changes/revocation and MFA Admin nonmember denial. Test both fresh and
   already-member acceptance, and never log raw invitation tokens.
7. Test independent PostgreSQL connections issuing/accepting invites while quota,
   plan or membership changes occur. Re-run shared project revision conflicts,
   failed uploads, library generation/asset conflicts, quota boundaries, data/asset
   checksums, local .avd save/reopen and original publishing ownership/password gates.
   Local PGlite interleaving does not certify hosted multi-connection locks, email
   delivery or provider JWT behavior. Verify provider SPF/DKIM/delivery and token
   fragment handling with the actual editor CSP/Referrer-Policy and browser history.
8. Release the migration, API and UI together after approval; refresh old tabs.
   Before rollout, retain the pre-existing broader account-library download timeout
   documented in docs/secure-publishing.md and verify actual downloads in staging.
   This task performs none of these production actions and does not start Phase 6.

Rollback by hiding team/invitation actions or disabling mail delivery while retaining
tables, memberships, invitation state, RLS, shared libraries and quota enforcement.
Do not restore the old direct-add member RPC or a public/unmetered shared library.
Transfer Enterprise Owner responsibilities before trusted Auth-user deletion; no
browser account-deletion flow is added. Keep local .avd recovery available.

## Validation

test/organizations.test.mjs and test/organizationInviteApi.test.mjs execute the
actual migrations, RLS, APIs and role/plan boundaries with local PostgreSQL-compatible
storage and controlled identities. scripts/organizations-smoke.mjs uses Chrome,
the full Engine, actual SQL/RPC/API code and locally simulated Auth/email issuance.
It covers company creation, invitation acceptance, the existing device-editor save
button, shared artwork, Editor project save, Viewer rejection, revoked access and
personal fallback while preserving local cable topology. Existing Phase 1-4 suites
and static validators remain part of regression verification.

Development validation (2026-10-28): the isolated staged tree passed all 2,172
repository tests and all 16 static validators. Chrome suites passed for
organizations/teams, accounts/workspaces, cloud projects, plans/quotas and
publishing authentication. Auth issuance and email delivery were simulated locally;
actual SQL, RLS and API implementations were exercised. These results do not replace
the real Supabase, concurrency and email-delivery staging checks above.

Provider references: [Resend email API](https://resend.com/docs/api-reference/emails/send-email),
[Supabase Auth users/invitations](https://supabase.com/docs/guides/auth/users).
