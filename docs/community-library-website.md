# Community Library Phase 3

Development implementation complete; not deployed or enabled. No remote migration,
environment, account, publishing flag or Google Cloud staging setting was changed.

## Website and application

- `/wirenexus/library/` (with a redirect from `/wirenexus/library`) lists only the
  current approved version. Search and manufacturer/model/category filters execute
  on the server. Detail documents use `/wirenexus/library/device.html?id=<uuid>`.
- Details show front/rear PNG previews, connector/card definitions, display-name
  attribution with a verified/unverified state, and publication history. History
  exposes only previously approved version numbers/dates, never private notes,
  pending/rejected metadata, old package IDs or old package downloads. Unpublishing
  the active device removes public detail, artwork and history access.
- Public pages contain no Supabase session handling. Import/download links carry
  only a public device UUID and action to the existing application login. After
  normal authentication/MFA/recovery gates, the user explicitly confirms an action.
  Downloads retain server authorization, chunk limits and SHA-256 validation.
  Import uses the existing `.wnx` decoder, attribution check, dependency handling
  and collision confirmation; it changes the library, not the current canvas.
- Dashboard **Community** opens the existing Account dialog. Users see their own
  submissions and private status; MFA-verified Platform Admins can review pending
  versions or unpublish active versions. Every action is reauthorized server-side.
  This phase does not add submission upload controls or enable publishing.
- Uploaded HTML/SVG is never inserted into the DOM. Metadata uses text nodes;
  image data comes only from authorized, normalized PNG responses, checked for PNG
  type/signature and size before a local Blob URL is created. Stale account work
  and previews are canceled and URLs are revoked when content is cleared.

## Pending integration requirements

1. In a separately approved environment, apply Phase 2's
   `20261103181243_community_device_library.sql` first, then
   `20261104052902_community_library_website.sql`. Historical migrations are unchanged.
   The latter adds a private RLS presentation table and replaces the service-only
   RPC wrapper. The previous implementation moves to a private, non-callable helper.
   No anon/authenticated direct SQL access is granted.
2. Deploy the matching API, package validator and application together. Leave
   `WIRENEXUS_COMMUNITY_ENABLED` absent/false until separately approved. The default
   disabled response produces a visible unavailable state, not fabricated devices.
3. Build the isolated website with approved application/API URLs:
   `node scripts/build-videocore-website.mjs <new-output-directory> [absolute-app-url] [absolute-community-api-url]`.
   For separate origins, set server-only `WIRENEXUS_COMMUNITY_WEBSITE_ORIGIN` to the
   exact approved HTTPS website origin. Only public GET responses receive CORS;
   authenticated package/moderation POSTs remain within the application origin.
   No credentials are included in the static build.
4. Verify hosted RLS/RPC grants, approval/unpublication, account switching, browser
   CORS, real MFA administration, and downloads/imports in that approved environment.
   Local fixture results do not substitute for real Supabase staging verification.

Existing Phase 2 versions remain readable without backfill: their front preview
and connector-type summary are retained; model/rear/detailed ports are unavailable
until a newly validated version is submitted. Full normalized artwork remains
inside each complete `.wnx`; only separate front/rear thumbnails are stored for web
previews, avoiding a second copy of every full dependency image. No original source
artwork is rewritten. Catalogue facet menus show up to 500 values; search remains
available for larger catalogues. Version history currently has no pagination.

Rollback: disable the Community flag first and restore the prior application/API
build. Keep additive presentation data and migration history; do not drop tables
or edit historical migrations. The wrapper retains the Phase 2 actions and permits
legacy commits without presentation data.

## Local validation

- `node --test test/communityWebsite.test.mjs test/videocoreWebsite.test.mjs`
- `node scripts/community-website-validation.mjs`
- `node scripts/community-website-dev.mjs` serves port 8806 with Community disabled.
- `node scripts/community-website-smoke.mjs` uses isolated Chrome Dev sessions and
  local PGlite with the real API handlers. Network routes are restricted to local
  fixture endpoints; no real account, signing key, package or publication is used.
  It covers catalogue/detail/filter states, mobile layout, preview races, SVG
  rejection, private-version denial, password login, authenticated import/download,
  own submissions and MFA-admin approval/unpublication. Screenshots are temporary.

Run full tests/validators from the isolated staged tree before committing. Preserve
unrelated Device JSON Import edits, factory assets, faceplates, Masters and backups.
