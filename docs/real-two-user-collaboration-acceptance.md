# Phase 6.6Q: Real two-user collaboration acceptance

Date: 2026-11-02. **Result: PASS for the requested two-user synthetic staging
acceptance scope on revision `00003-zpp`. Not production release approval.**

Follow-up: the sequential-undo blocker below was corrected in `dd109d4`, deployed
to private revision `00003-zpp`, and its narrow real two-user reproduction and
cross-user conflict protection passed. See
[the deployment and verification record](collaborative-undo-staging-deployment.md).
The remaining acceptance checks have now passed as recorded below. The original
failure evidence is retained in the historical section, not a current blocker.

## Completed Remaining Acceptance

Existing private staging service, workspace and synthetic project were reused.
Two isolated Chrome Dev contexts used independently verified real Owner and
Editor Supabase sessions through the existing authorized Google IAM transport.
The operator performed canvas actions; hosted API responses and ordered history
were independently inspected. No Auth, SQL, operation or Realtime response was
mocked, and server validation was not bypassed.

| Check | Evidence / result |
| --- | --- |
| Both users create and modify cables | Owner deleted/recreated the first HDMI cable at sequences 22/23, then set 11m at 24. Editor deleted/recreated the second at 25/26, then set 22m at 27. Both port pairs retained their intended device/connector endpoints; both windows agreed. |
| Simultaneous conflicting edits | Two actual browser commands held briefly by the test transport both specified expected sequence 27. Released together, the Owner command committed at 28; the Editor command returned 409 and is absent from accepted history. A subsequent overlapping pair also rejected the Editor rebase atomically. The operator observed recovery to the Owner position. |
| Connected objects preserve topology | Connected source/sink moves and cable edits retained two devices and four valid cables. The existing Engine `projectTopologyDiagnostics` returned zero findings at sequences 27, 29 and 31. Other cable identities/endpoints were preserved. |
| Genuine disconnect and catch-up | Only the Editor test browser was set offline at sequence 29; its actual collaboration requests failed with `net::ERR_INTERNET_DISCONNECTED`. Owner committed source movement 30 and first-cable length 33m at 31. After network restoration, Editor history read `after: 29` returned exactly `[30,31]`, then empty catch-up pages after 31. No reload or manual snapshot injection. |
| Final convergence | Both authenticated head reads returned identical documents at sequence 31. Operator confirmed the Editor canvas displayed the new source position, first HDMI 33m and second HDMI 22m, matching Owner without refresh. This combines server-document comparison and observed browser behavior, not a hash of browser-local camera/draft state. |
| Recovery and personal data | Original version 1 remains readable through the existing cloud client; complete chunk/digest verification matches the earlier recovery read. Shared saved version/revision remain 1. Both personal Owner memberships and company Owner/Editor roles remain; the existing personal project remains version/revision 4, with no secondary personal project created. |

Both contexts are online again; the temporary race gate was removed. No new
application defect was observed. Final hosted checks: revision remains
`wirenexus-staging-00003-zpp`, operator health 200, anonymous health 403 and
Supabase signup disabled. No deployment, infrastructure, IAM, DNS, registration,
workspace permission or production change occurred during these remaining tests.
Only synthetic shared-project operations and normal Auth/presence/read traffic
were exercised; no manual checkpoint, restore or personal-project edit was made.

### Remaining Release Boundaries

These results cover the requested two-user synthetic scenario, not arbitrary
large projects, many-user contention, prolonged outages, offline merging, all
modular/Jump/Loom/Multi-Core combinations, or browser-restart recovery. The test
demonstrates catch-up through the authoritative history API; it does not isolate
WebSocket notification delivery from the existing polling fallback. Historical
version integrity/read access was verified without destructively restoring the
baseline over the live head. Existing container/npm findings and the restricted
pilot's 2026-11-06 security re-review deadline remain; public/production release
and broader exposure are not authorized by this acceptance pass. See
[the image security disposition](collaborative-undo-staging-deployment.md).

Sanitized evidence: [completed acceptance](security/real-two-user-acceptance.json).

## Historical Blocked Run

Target: existing IAM-private `wirenexus-staging` service, revision
`wirenexus-staging-00002-4ph`, unchanged reviewed image. Existing Enterprise
workspace `8f039bb0-df58-411e-beb4-c815d7c88404`; synthetic project
`19617748-8724-4bfe-a6eb-37515a2e30fd`. Two independently authenticated Chrome
Dev contexts used the actual Owner and Editor accounts, hosted Auth, APIs and
database. No Auth, operation or Realtime response was mocked.

## Observed Results

- Both identities independently verified through hosted Auth.
- Both browsers joined collaboration successfully; the operator confirmed the
  UI worked and showed numbered collaborator names (expected current behavior).
- Actual presence/status/history requests from both contexts returned HTTP 200.
  Cursor rendering and private WebSocket delivery were not independently
  established by those HTTP responses.
- Device moves by both identities were accepted into ordered server history.
  Two Editor undo operations succeeded; further sequential undo exposed the
  defect below. Conflict refusals returned HTTP 409 without advancing the head.
- Both authenticated accounts subsequently read the same server document at
  sequence 6. This is server-state equality, not proof of identical rendered
  client state or completion of all synchronization tests.
- Saved version/revision remain 1. A non-mutating historical read using the
  existing cloud client verified the original version's complete chunk/digest
  integrity. No destructive restore or new checkpoint was performed.
- Head still contains two devices and four cables. No cable-edit acceptance or
  comprehensive final topology-validation claim is made.

## Reproducible Blocker: Sequential Undo

Observed accepted history:

| Sequence | Actor | Edit |
| --- | --- | --- |
| 1 | Editor | Move `source` from its baseline position |
| 2 | Editor | Move `source` again |
| 3 | Owner | Move independent device `sink` |
| 4 | Editor | Move `sink` |
| 5 | Editor | Undo sequence 4; Owner's sink position survives |
| 6 | Editor | Undo sequence 2; source returns to sequence 1 position |

Now Editor Undo submits `targetSequence: 1, expectedSequence: 6`.
The actual service returns **409**, with:

```text
Another accepted edit changed the same field or relationship.
```

No Owner operation changed `source`. Its later Editor move was already undone.
Nevertheless, `assertIndependent` in `src/engine/collaborationConflicts.js` checks
all intervening write footprints individually, including the canceled move and
its inverse. It does not recognize their net cancellation. This blocks undoing
the Editor's earlier move without an actual surviving competing source edit.
Calling the existing conflict classifier on the JSON-normalized accepted
commands reproduces `COLLABORATION_CONFLICT` locally, without changing staging.
Owner undo of sequence 3 also rejects after the intervening sink move/inverse;
the confirmed Editor-only source reproduction is the clearest isolated case.

No fix, validator relaxation, retry loop, deployment or security change was
attempted. Acceptance stopped at the application defect, as instructed.

## Not Completed

Cable addition/modification and endpoint validation; deliberately simultaneous
conflict tests; complete per-user undo/redo; disconnect/reconnect catch-up;
independent final browser-state/topology equivalence; recovery through the
browser UI. Numbered collaborator names are not classified as a defect.

The current accepted head remains durable at sequence 6. Baseline version 1 and
the original personal project at version/revision 4 remain intact. Both personal
workspaces were preserved. No permissions, IAM, infrastructure, DNS, registration
settings or production data were changed by this acceptance attempt. Only this
report is committed. Resume after a separately authorized undo correction and
revalidation; do not mark Phase 6.6Q complete.
