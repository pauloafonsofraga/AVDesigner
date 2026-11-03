# Routed cable replug, Jump playback and report row selection

Scoped Engine fixes on `engine-prototype`, starting from `667245e`.

## Confirmed defects

- Custom and manually routed orthogonal wires entered endpoint replug correctly,
  but the manual-drawing pointer-up guard returned before completion. Lost pointer
  capture also incorrectly retained the replug as if it were a multi-click drawing.
- Editor Play Cable treated a paired Jump span as an instantaneous teleport. The
  viewer already converted that semantic span to a visible animated Jump link.
- Report rows were grouped by type/length, but their click handler sent only the
  type, selecting every cable of that type instead of the represented row.

Five new focused assertions failed on the starting implementation before fixes.
The existing report grouping tests continued to pass.

## Corrections

Manual drawing still waits for explicit completion. Endpoint replugs now finish
on pointer release and cancel on lost capture. Existing endpoint mutation/history
paths retain route controls, cable identities, metadata and connection validation.
No new route algorithm or persisted schema is added.

Editor playback converts semantic Jump teleports to the existing Jump-link curve,
duration and overlay presentation, matching the viewer. The shared semantic tracer
and project topology are unchanged.

Report rows carry their actual physical wire IDs, including both legs of logical
Jump cables. Row clicks pass those IDs; selection intersects them with current
connections and type. Empty/deleted rows cannot expand into type-wide selection.
The original one-argument type-wide helper remains for older callers. No cable
lengths, IDs or report quantities are edited by selection.

## Verification

`test/cableInteractionRegressions.test.mjs` exercises actual bridge methods for
manual replug completion/cancellation and continuous paired-Jump playback.
`test/projectReportCableGrouping.test.mjs` verifies blank-length grouping,
physical IDs, Jump legs and row-scoped selection.

`scripts/cable-interaction-regressions-smoke.mjs` uses real Shift-drag gestures at
both ends of custom/manual-orthogonal/historical-orthogonal cables; checks exact
metadata, undo/redo and save/reopen; clicks the actual report popup; and watches
Play Cable advance onto the visible Jump link and then the other physical leg.
It uses only synthetic local projects and blocks remote requests.

The isolated staged tree passed all 2,325 repository tests, zero failures/skips,
all 16 validators, and the focused Chrome regression smoke. Unrelated Device JSON
Import work, protected assets and the VideoCore website were excluded from edits.

## Restricted Vercel Preview

Read-only preflight found `avdesigner` Preview/Production share Blob credentials
and no Supabase variables are configured. The owner approved a new restricted
Preview, not a production promotion or project-wide settings change.

The deployment must use an immutable scoped commit, omit the separate VideoCore
website and all unrelated files, and override Blob/Supabase credentials to empty
values for that deployment only, with registration false. This intentionally
supports local `.avd` editing, not account/cloud/publishing acceptance. Existing
deployments remain available for rollback. Google Cloud staging, Squarespace,
DNS and the account/collaboration security implementation are not modified.

Pre-deployment rollback references retained:

- Preview: `https://avdesigner-kdpz9lova-pauloafonsofragas-projects.vercel.app`
- Production: `https://avdesigner-gxz3eip4v-pauloafonsofragas-projects.vercel.app`
