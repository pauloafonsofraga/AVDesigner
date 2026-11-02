# Phase B: projects dashboard

The post-login dashboard is the Engine's project-management entry. It shows the
authorized active workspace, server-reported current plan, recent cloud projects
with modification timestamps and versions, search and archived-project filtering.
Owner/Admin/Editor project rows offer Rename, Duplicate and Archive/Restore;
Viewer rows retain Open without write actions. Server permissions remain decisive.

New Project uses the existing designer reset/confirmation and starts a local
canvas, not an automatic cloud save. Open Cloud Project uses the existing cloud
browser, including its versions and collaboration entry. Open Local `.avd` uses
the existing file loader with the unsaved-canvas confirmation. Canceling a file
picker or New Project leaves the current canvas in place. Returning from the
designer retains its document, history and camera. Phase A's account-switch
isolation remains: a different account cannot resume the old in-memory canvas.

Metadata actions call the existing cloud manager rather than a new backend. Its
original expected-revision checks and account-bound client remain intact. Own
rename/archive/restore operations advance a linked canvas's cloud binding only
when it still has the mutation's original revision. Duplicate never rebinds the
canvas. An external metadata change causes a conflict rather than silently
adopting the latest revision. Project document content is not rewritten by these
metadata actions. Search/sorting and management cancellation do not edit projects.

The current-plan control opens existing Account plan settings. Its label comes
from the existing authorized `wirenexus_plans` status RPC, including the server's
Admin override. Plan errors are shown as unavailable, not guessed entitlements.
Workspace switching reuses the existing library/workspace activation; delayed
lists and mutation prompts are scoped to their originating account/workspace.
No role, quota, cloud storage, authentication or account schema was added.

## Validation

The isolated staged implementation passed all 2,312 repository tests (no skips
or failures), all 16 static validators, and the expanded Chrome Dev browser
smoke at desktop and mobile sizes. The focused portal/cloud suite passed 16/16.
Unrelated Device JSON Import work and protected artwork were excluded.

- `test/accountPortal.test.mjs`: role-aware actions, recent sorting/search and the
  existing authentication/navigation gates.
- `scripts/account-portal-smoke.mjs`: local Auth fixtures with the actual Supabase
  SDK, Account/dashboard/designer and SQL/RLS. Covers rename cancellation, metadata
  actions, linked binding updates, stale-revision rejection, cloud-browser launch,
  local `.avd`, New Project cancellation/reset, Viewer restrictions, plan labels,
  canvas/camera preservation and desktop/mobile screenshots/overflow.
- Existing cloud-project tests cover ownership, role enforcement, immutable
  versions, failures, conflicts and file/artwork round trips.

Run against a local static server on port 8792:

```sh
node --test test/accountPortal.test.mjs test/cloudProjects.test.mjs
node scripts/account-portal-smoke.mjs
```

No deployment, production change, DNS/IAM change or Phase 6.6 test is performed.
Configured-host acceptance remains separate from the local Auth transport fixture.
