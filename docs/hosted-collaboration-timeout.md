# Hosted collaboration timeout investigation

## Scope

Investigated on `engine-prototype`, using the retained, independently
authenticated Owner and Editor Chrome profiles at localhost:61274 against
Supabase staging `puyrylatmtcwlvyycplc`. No tokens, cookies or MFA state are
exported. No Cloud Run/Vercel deployment is involved.

## Confirmed failure

The isolated project `f43029f3-0d59-4d65-a7c4-df3caaa8d28a` reached sequence 4.
Both clients prepared conflicting device movements against sequence 3:

| Client | Command | Durable result |
| --- | --- | --- |
| Owner | `09a4b62a-2e2a-47f4-a885-8d2cef9c2185` | Not committed; absent from operation history |
| Editor | `e5c30a23-d953-4237-8f7c-e2283725d823` | Committed as sequence 4 at 2026-11-05 11:39:22.775541 UTC |

Neither uncertain command was retried during diagnosis.

The browser calls `createCollaborationApi`, whose existing deadline is 15 seconds.
The localhost handler authenticates the caller, then performs receipt lookup,
head read, deterministic replay, and the SQL compare-and-swap commit. Hosted
edge logs show the two final RPC requests starting at 11:39:22.707 and
11:39:22.718 UTC. One completed successfully (209 ms origin, 66 ms upstream).
The other returned gateway HTTP 504 after 125,165 ms. Its database rejection
was already recorded at 11:39:22.850 UTC, at the RPC's sequence guard.

The RPC deliberately raised SQLSTATE `40001` for a permanent stale revision.
Postgres logs contain 154 repetitions of that same guard between 11:39:22.850
and 11:41:59.410 UTC. Thus the browser deadline was not evidence of slow artwork
upload, a large document replay, or a successfully committed Owner move. The
head document was only 11,895 bytes and replay metadata 177 bytes.

Supabase documents the PostgREST retry problem for application-generated
`40001` errors:
[SQLSTATE 40001 and infinite RPC retries](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions).
Ordinary Supabase JS POST RPC requests are not automatically retried by its
[client retry policy](https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js).
The observed latency is upstream retry amplification after an immediate SQL
conflict, not a reason to lengthen the browser timeout.

## Repair

Migration `20261105120111_collaboration_conflict_http_code.sql` changes the
five deliberate conflict guards in `public.wirenexus_collaboration(text,jsonb)`
from `40001` to the explicit PostgREST HTTP error `PT409`. It checks the expected
guard count before changing anything and preserves the function's OID, grants,
security-definer settings, locks, checks and data mutations. Historical migration
files are unchanged. The server maps `PT409` to its existing safe HTTP 409
response, retaining `40001` compatibility with older installations.

No timeout, authorization, topology validation or idempotency check is weakened.
True PostgreSQL serialization failures are not rewritten.

## Validation

- 90 focused tests passed: collaboration operations/conflicts, live sessions,
  and cloud artwork SQL/migration tests.
- A forced commit race verifies that the loser makes exactly one commit call,
  receives `PT409`, creates no operation/receipt and leaves the winner intact.
- Migration regression compares the full function definition, OID, grants and
  security configuration before/after; only the five error literals differ.
- `node scripts/cloud-artwork-validation.mjs` passed.
- Read-only inspection confirmed baseline project
  `19617748-8724-4bfe-a6eb-37515a2e30fd` remains revision/version 1, collaboration
  sequence 31.
- Encrypted database and roles backup checksums still match the verified
  20261104T130739Z recovery point outside the repository.

## Approved staging verification

After explicit approval, the exact migration (SHA-256
`551a602fb77e6c0895c3dd3a281c924fc1a85b3de79af6a44a735d7f66b8425c`)
was applied only to staging, recorded as hosted version `20261105121022`, name
`collaboration_conflict_http_code`. The existing function OID remained `18170`;
normalizing the five new error literals back to their old values reproduced the
original definition MD5 `d0acfeaf26fd5ac404ea78eef512a175`. Security-definer and
grants remained unchanged (`postgres`, `service_role` only). No other migration
was applied.

The localhost API was restarted with the new mapping. Both persistent browser
sessions remained authenticated; no new login or replay of the original uncertain
commands was needed. The 90 focused tests were rerun successfully before applying.

Real hosted acceptance began at 2026-11-05 12:10:59 UTC:

| Check | Result |
| --- | --- |
| Original operation reconciliation | Only the Editor command was present at sequence 4 |
| Fresh competing movements | One HTTP 200 in 1,434 ms; one HTTP 409 in 1,664 ms; exactly one new operation |
| Selective undo/redo | Editor undid/redid its own sink movement; independent source edits preserved; sequence 7 |
| Artwork while Editor offline | Owner exchanged two existing artwork references; one new operation |
| Reconnect/catch-up | Editor received the missed operation; both head documents and SHA-256 of fully hydrated artwork/project JSON matched |
| Checkpoint/reopen | Checkpoint sequence 8, project revision/version 2; both accounts reopened the matching hydrated project |
| Recovery version | Synthetic project's version 1 still present; no recovery overwrote the baseline |
| Protected baseline | Original project remained revision/version 1, collaboration sequence 31, with its original single version |

Hosted Postgres logs for 12:10:59--12:11:20 UTC contained **one `PT409`** and
**zero `40001`** errors, confirming the conflicting request was rejected once,
without the previous retry amplification. The browser deadline remains 15 seconds.
All other measured collaboration API requests returned HTTP 200.

Safe timing/result evidence is retained outside Git in the protected persistent
profile directory as `collaboration-investigation.json`. It contains action names,
statuses, timings and synthetic project identifiers, never authentication material.
Both browser profiles and the localhost server remain open for inspection.

These checks exercise actual authenticated browser/API/RPC/Storage flows and
explicit ordered catch-up. They are not a new manual multi-cursor UI acceptance
or a deployed Cloud Run verification. The localhost server rechecked closed
registration on startup and retained its publishing freeze; new publication POSTs
remain denied. No Cloud Run revision, IAM, secrets or hosting configuration changed.

## Recovery and limits

The migration changes error semantics only; accepted data and stored versions
are untouched. Reverting the JS mapping is backward-compatible but reverting the
SQL error code would reintroduce the retry problem and is not recommended.
Use the documented encrypted database recovery procedure only in an isolated
restore environment, never by overwriting staging as part of this test.

The separate embedded 46 MB finalization timeout and distroless zlib deployment
blocker are not fixed or waived by this repair. Production, Vercel, IAM, DNS,
public registration and publishing configuration remain unchanged.
