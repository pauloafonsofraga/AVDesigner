# Secure publishing: Accounts Phase 1

This change is not deployed automatically. Apply the database migration and
configure all serving deployments before releasing it. Public registration and
subscriptions remain disabled. Local projects, exports and libraries are unchanged.

## Activation order

1. Back up the existing Supabase database and Blob metadata. Retain the existing
   Blob store/token; replacing the store would break old viewer links.
2. Apply `supabase/migrations/202609290001_owner_library.sql` if not already
   provisioned, then `supabase/migrations/202610270001_secure_publishing.sql`.
3. Configure server-only `WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY` and the existing
   `WIRENEXUS_SUPABASE_URL`, `WIRENEXUS_SUPABASE_PUBLISHABLE_KEY`,
   `BLOB_READ_WRITE_TOKEN`, and `PUBLIC_VIEWER_ORIGIN`. Never put the service key
   in account-config.json, a browser bundle, build-time public variables or logs.
   The public configuration endpoint still exposes only the publishable key.
4. The existing singleton owner may publish. Any other publisher must first be
   created administratively in Supabase Auth and explicitly enabled by a trusted
   database administrator:

   ```sql
   insert into wirenexus_private.publishers(account_id, enabled)
   values ('VERIFIED-USER-UUID', true);
   ```

   This is a publishing grant, not platform Admin or library administration.
   Disable a grant with `enabled=false`. The singleton owner's grant follows the
   existing owner table; publisher disable does not override owner authority.
   The existing sign-in UI is still owner-oriented; general account onboarding
   and non-owner personal-library access are outside Phase 1.
5. Validate Auth/email delivery, migrations, real Blob upload token handling,
   existing password links and throttling in a non-production environment.
   Then explicitly release the APIs, shell and viewer together. Old editor tabs
   must reload: the unauthenticated publish protocol is intentionally rejected.

Missing credentials, missing SQL or limiter failures return a safe 503. There
is no unauthenticated or process-memory fallback, including for viewer requests.
Consequently database/service-key provisioning is a prerequisite for preserving
availability of existing links at deployment time.

## Protocol and permissions

- The browser sends its Supabase bearer access token. The server verifies it
  through Auth `getUser(token)`; a decoded JWT or browser flag is not trusted.
- `POST /api/publish`, `action=reserve`, accepts projectBytes and htmlBytes only.
  SQL allocates a new UUID publication ID and owner-scoped exact paths. It returns
  the reservation to the browser; caller-selected IDs and paths are refused.
- `/api/upload` authorizes only those exact pending paths and enforces MIME type,
  declared byte limit, ten-minute token expiry and `allowOverwrite=false`.
  Signed Blob completion callbacks are verified by the SDK, not by a user JWT;
  they cannot create a publication or issue upload credentials.
- `action=finalize` accepts the reservation ID, title, password and logo, never
  paths, HTML, raw project data or compressed payloads. The server checks uploaded
  object paths, exact byte sizes and content types. SQL activates the link once,
  checking current publisher permission and owner under a row lock. A concurrent
  revoke/second finalize cannot overwrite the committed publication.
- `action=revoke`, with id and bearer token, is owner-only and stops future
  viewer unlocks. It does not erase stored artwork or files. There is no new
  management dashboard or replace-in-place feature in this phase. Publish again
  to create a fresh link; already-open or downloaded viewers cannot be recalled.
- Publication tables have RLS enabled and no browser table privileges. The RPC
  is executable only by service_role. Authentication and permission checks are
  separate: being signed in alone never grants publishing authority.

## Existing publications

Legacy `avdesigner/projects/<id>/meta.json` and viewer files are never modified.
When a registry entry is absent, the password reader retains the original Blob
metadata lookup and PBKDF2 format. New registry revocations take precedence over
legacy lookup. Existing title/logo metadata remains readable before unlock; no
password hashes, paths or private drawing data are returned by branding requests.

Legacy publications remain unowned/read-only. The API has no claim operation:
knowledge of a URL/password is not proof of management ownership. An eventual
legacy-management migration requires independent administrative ownership
verification and an explicit registry import; it must not infer the owner from
the first person who signs in. No legacy claim/import is performed here.

## Isolation, bounds and throttling

Published HTML executes in an opaque-origin iframe with only allow-scripts and
allow-downloads. It cannot access editor DOM, cookies or local authentication
storage, navigate the parent or open popup windows. A CSP inserted before the
untrusted document blocks network connections, forms and external resources.
Self-contained Engine viewers and user-initiated downloads remain supported.
Legacy exports relying on external resources must be republished self-contained;
do not weaken the sandbox to accommodate active third-party code.

Project JSON is limited to 64 MiB, viewer HTML to 128 MiB, API JSON to 1.1 MB.
Legacy metadata and HTML reads have streaming bounds. Gzip-in-request publishing
is removed, so no unbounded decompression path remains. Password derivation is
asynchronous PBKDF2 with the existing salt/hash format and constant-time comparison.

Postgres atomically enforces fixed-window limits across API instances: 90 branding,
15 unlock and 60 authentication requests per minute per IP; 20 reservations,
120 upload authorizations and 60 finalizations/management operations per hour
per publisher. Reservations are additionally capped at 40 per publisher per day;
unlock requests at 60 per publication per minute, across source IPs.
Reservations expire after 30 minutes. IPs are HMAC-hashed with the
server key. Vercel's trusted x-vercel-forwarded-for is used only when VERCEL is set;
local Node uses the socket peer. Other proxy platforms require an explicit trusted
adapter before deployment. Missing/invalid trusted IPs fail closed. Responses use
no-store, generic errors, and Retry-After on 429; provider errors/tokens are not echoed.

Limits are safety bounds, not subscription quotas or a complete DDoS defense.
NAT users share an IP budget. Configure edge/WAF limits as well. Monitor storage
and database usage; no automatic destructive garbage collection is introduced.
Expired pending uploads and old limiter rows may be cleaned by a separately
reviewed administrative retention job. Raw HTML remains untrusted even when
uploaded by an approved publisher; never serve it unsandboxed on the editor origin.

## Verification

- `node --test test/securePublishing.test.mjs test/companyLogo.test.mjs test/accountLibrary.test.mjs`
- Serve the repository locally and run `scripts/company-logo-smoke.mjs` and
  `scripts/publishing-isolation-smoke.mjs` with AVDESIGNER_BASE_URL set.
  `scripts/publishing-auth-smoke.mjs` verifies the real Auth SDK session bridge
  and sign-out against locally simulated Auth; it never enables signup.
- The SQL tests execute the actual migrations/RPC using PGlite and controlled
  identities. Browser tests exercise production viewer markup and self-contained
  output. They do not certify production provisioning or email delivery.

The broader existing account-library browser smoke has a PRE-EXISTING failure:
on untouched baseline `253d2f57af18cecead3045ce11788c6d75501bf4`, run
`AVDESIGNER_BASE_URL=http://127.0.0.1:8792 AVDESIGNER_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node scripts/account-library-smoke.mjs`
against a static server serving that commit. It reaches the portability fixture,
then reports `page.waitForEvent: Timeout 30000ms exceeded while waiting for event
"download"` at `scripts/account-library-smoke.mjs:113:16`. The scoped tree reproduces
the same download timeout. Full account-library browser acceptance therefore
remains blocked at that older .avd-download scenario; the focused publishing Auth
bridge is tested independently. No production save code or failing test is changed
to bypass this failure.

Primary integration references: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser),
[Vercel client uploads](https://vercel.com/docs/vercel-blob/client-upload), and
[Vercel trusted request headers](https://vercel.com/docs/headers/request-headers).
