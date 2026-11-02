# Phase 6.6Q: Real two-user collaboration acceptance

Date: 2026-11-02. **Result: BLOCKED / incomplete acceptance.**

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
