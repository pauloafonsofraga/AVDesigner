# Phase 6.6P: private staging browser acceptance

Date: 2026-10-30 (Asia/Dubai). **Scoped single-operator browser acceptance passed.**
This is not acceptance of real multi-user collaboration or public access.

## Target and method

- Existing service `wirenexus-staging`, project `wirenexus-staging`, region
  `europe-west1`; revision `wirenexus-staging-00001-nkj`.
- Origin: https://wirenexus-staging-837085353595.europe-west1.run.app
- Unchanged reviewed digest:
  `sha256:fdba185aa262f916bb705ae929eae68c61eaf05afba37ec4aa55b1f1e0919598`.
- Existing operator `paulo@videocore.net`, personal workspace and existing MFA.
- Isolated real Chrome/Chromium browser; operator IAM ID token attached only to
  this exact Cloud Run origin through browser request interception. No tokens
  were attached to Supabase or signed GCS requests by that transport.
- Real hosted application, Auth, RPCs, cloud project storage and GCS uploads;
  no fake authentication, mocked database or mocked application responses.
  Code-free diagnostics separately used local/fulfilled test pages.
- Only synthetic devices/project/publication were used. The original account,
  library, workspace membership, MFA factor and existing projects were preserved.

## Results

| Area | Observed result |
| --- | --- |
| Startup and assets | Engine ready; editor assets/artwork loaded; no application errors in independent UI checks. |
| Toolbar and canvas | Zoom, grid and routing controls respond; device dragging, undo and redo preserve four cables. Toolbar remains accessible at 1280px desktop width. |
| Device Editor | Factory Device, Faceplate, Connectors, Cards and Defaults tabs render. Project-instance artwork and connector tabs open/close without changing topology. |
| Local files | Real Save As download and `.avd` reopen retain two device definitions, embedded PNG and four connections. |
| Sign-in | Existing-account password sign-in succeeded in initial checks. Email-code sign-in was verified through the real application UI; fresh resend used the ordinary staging Auth OTP endpoint with `create_user:false`, not the Admin API. |
| MFA | AAL1 shows Owner membership but withholds Platform Admin. Existing TOTP verification reached AAL2; server Auth `getUser` independently verified the same operator and signed token. No factor was enrolled, removed or reset. |
| Cloud projects | Synthetic project saved as version 1, reopened, saved through versions 2 and 3, then version 1 recovered as new revision 4. Actual reopen of revision 4 restored original geometry, embedded artwork and four cables. |
| Publishing permissions | Free/AAL1 request denied with 403 and "Publishing is not included in this workspace plan." Missing application bearer denied with 401 even with valid Cloud Run IAM access. No plan assignment changed. |
| Positive publishing | After MFA activated existing Platform Admin entitlements, actual reserve, signed private GCS PUTs for both project and HTML, and finalize completed. |
| Viewer | Real password gate opened the hosted synthetic viewer, showing both devices, artwork and four cables. Incorrect password returned 401. |
| Isolation and CORS | Anonymous application/viewer requests returned 403. Anonymous read of the actual stored viewer object returned 403. Native origin PUT preflight allowed; untrusted origin received no allow-origin. No CORS configuration was changed. |
| Final infrastructure check | Same ready revision, digest, runtime configuration, IAM bindings and private bucket/CORS. No deployment or access-policy changes. |

The source fixture's embedded HDMI image was deliberately used as synthetic
faceplate artwork; it is not intended to depict a production chassis.
The synthetic cloud project and its four versions, plus one private synthetic
publication, remain as audit artifacts. No pre-existing project/publication was
overwritten. The random publication password was not printed or persisted; this
test publication is not a deliverable viewer link for later reuse.

## Defect and diagnostic disposition

No functional application defect was confirmed in the tested workflows.
Do not describe the raw browser telemetry as error-free:

- Temporary local code-entry helpers initially rejected forms because of
  `Origin: null` under their `no-referrer` policy and stale `/verify` form pages.
  Only those ephemeral helpers were corrected to preserve same-origin form
  headers, retaining loopback binding, host/origin checks, CSRF cookie and nonce.
  These were test-handoff failures, not Cloud Run or application authorization
  defects. Helpers were closed after completion; no helper code was deployed.
- One TOTP verification returned 422 before the operator used the existing
  application authenticator successfully. An email sign-in code is not a TOTP
  authenticator code. Neither rejection nor eventual success bypassed MFA.
- Two sandbox `navigator.serviceWorker` errors occurred with Playwright's
  `serviceWorkers: block`. A code-free HTTPS-document/sandbox control reproduced
  the same error with `block` and none with `allow`. An independent rendering of
  the exact stored 501,584-byte viewer HTML produced two canvases and no errors
  with `allow`, keeping `sandbox="allow-scripts allow-downloads"` and the original
  CSP, without `allow-same-origin`. No sandbox weakening or application fix needed.
- Raw teardown telemetry included two GCS request-abort events despite successful
  finalization and verified stored artwork/topology, and an Auth logout request
  abort. They are retained in sanitized evidence, not hidden. UI local sign-out
  and removal of browser credentials were verified; the final server logout
  response was not independently confirmed before browser teardown. A future
  harness should await that response before closing. This is not evidence that
  another user's session was affected or that an upload failed.

Focused repository tests:
`node --test test/cloudRunHosting.test.mjs test/cloudRunPrivateIam.test.mjs test/stagingInfrastructureConfig.test.mjs`
passed **16/16**, zero failures. Runtime/source code and the deployed image were
not changed. [Sanitized evidence](security/phase-66p-browser-acceptance.json)
retains both successful checks and the qualified telemetry.

## Before Real Multi-User Testing

1. Obtain separate approval for an Enterprise workspace and additional authorized
   test accounts/members. This phase used one personal Owner account; it does not
   establish cross-user isolation, revocation races or collaboration correctness.
2. Agree an IAM-compatible browser access path for each approved operator. A plain
   browser visit to `run.app` does not exchange Google login cookies for Invoker
   ID tokens; its 403 is expected. The scoped browser header transport used here
   is a pilot test mechanism, not a general user login interface. Do not make the
   service public to solve this. A new front door or broader Invoker policy needs
   its own review and approval.
3. Run the two-client concurrent-edit, reconnect/catch-up, revoked-member and role
   tests against the actual Enterprise workspace. No Enterprise user, invitation
   or company workspace was created here.
4. Retain Phase N's restricted-image risk acceptance and reassess before its
   2026-11-06 expiry. Successful browser tests do not patch the known advisories.

No DNS/custom domain, production, Vercel, Supabase policies/migrations,
registration settings or hosting resources were modified. No external users
were invited. Protected artwork, faceplates, Masters, backups and unrelated
Device JSON Import work remained excluded from this documentation-only change.
