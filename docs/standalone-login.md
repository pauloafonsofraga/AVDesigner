# Phase A: standalone login and project entry

The Engine entry at `index.html` now presents a dedicated sign-in screen when
the configured account service has no verified account/library identity. A
restored session or successful sign-in opens a minimal workspace/projects
dashboard. Open Designer reveals the existing canvas; Projects returns to the
dashboard without unloading it. Cloud project Open uses the existing loader and
collaboration entry path, including the existing unsaved-change confirmation.
Newly opened projects fit after the visible Engine viewport is ready; returning
to an existing canvas retains its camera rather than fitting it again.

This is a same-document navigation foundation, not a new authentication service
or a second designer. It reuses the single client in `mountAccountLibrary`, the
same `wirenexus-owner-auth` SDK storage key, account RPCs, library owner, plans,
organizations and cloud serialization. Account and Sign Out are available from
the dashboard. Workspace selection uses the existing device-library membership
switch. Local Save/Save As and `.avd` payloads are unchanged.

Password, email OTP (with `shouldCreateUser: false`), recovery and MFA use the
existing Account controls, presented inline at entry and as Account settings
afterward. Existing verified factors require AAL2 before entering the dashboard;
Platform Admin's server-reported MFA requirement also gates entry. Authentication
events are processed outside the SDK session lock. Roles and entitlements still
come from authorized RPCs, not local plan flags. Registration is not enabled.

The entry screen blocks canvas shortcuts, and the bootstrap respects its inert
designer state. Returning to Projects or signing out preserves the current
canvas. If another account signs in within that same page, New Designer Session
reloads before revealing the prior canvas (the existing browser unsaved guard
remains active); opening that account's authorized cloud project instead uses
the normal project loader/history reset. A previous account's canvas is not
silently presented to the new account.

Known unconfigured local installations retain browser-only designer operation,
including a missing local `account-config.json` (404). Configuration service
errors other than 404 stay on the entry screen with Retry, rather than being
treated as a verified session. This UI gate is not an authorization boundary:
Supabase RLS, API authorization, IAM and publishing isolation remain mandatory.
Legacy and read-only viewer/export entry points are not routed through this UI.

## Validation

Final isolated staged-tree validation: **2,310 repository tests passed**, zero
failures/skips, and all **16 static validators passed**. The isolated browser
smoke passed with desktop/mobile screenshots, on-screen device bounds checks,
camera preservation and cross-account canvas isolation. Unrelated Device JSON
Import edits were excluded. No hosted authentication acceptance is claimed.

`test/accountPortal.test.mjs` covers login/dashboard/designer gates, restored
sessions, MFA/recovery, unconfigured local use and browser-role spoofing.
`scripts/account-portal-smoke.mjs` runs a local Auth transport fixture with the
actual Supabase SDK, Account/portal UI and SQL/RLS. It covers password errors and
Enter submission, OTP, recovery, MFA, session restoration, workspace switching,
project launch, Account settings and Sign Out. It also opens the actual Engine
page and checks that returning to the dashboard/signing out preserve a loaded
two-device/four-cable project. Desktop/mobile screenshots and overflow checks
are included. No real codes, credentials or remote account mutations are used.

Run a local static server on port 8792, then:

```sh
node --test test/accountPortal.test.mjs test/workspaces.test.mjs test/cloudProjects.test.mjs
node scripts/account-portal-smoke.mjs
```

The smoke script uses bundled Playwright by default; set
`WIRENEXUS_TEST_NODE_PACKAGE` to another dependency-runtime `package.json` when
needed, and `AVDESIGNER_BASE_URL` to select the local server.

No migration, configuration secret, dependency, backend permission or deployment
change is required for this frontend foundation. Real configured-host Auth,
MFA/refresh and collaboration re-entry acceptance remain staging prerequisites
after a separately authorized build/deployment. This task does not deploy,
change DNS, modify production, or enable public registration.
