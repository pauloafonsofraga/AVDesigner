# WireNexus Owner Account

Build 54.38.23 adds configurable Supabase Auth and PostgreSQL personal-library storage. No Supabase project or credentials were available during implementation. **Real email login, cross-computer synchronization and deployed authorization are activation checks, not yet verified.** Existing browser data remains an untouched recovery source. No cloud project-file management is introduced.

## Activate

1. Create a Supabase project. In Authentication settings, disable **Allow new users to sign up**. Do not enable anonymous sign-ins. Create the single owner user administratively in Authentication > Users and confirm its email. Record its UUID.
2. Run `supabase/migrations/202609290001_owner_library.sql` once in the SQL editor. Set the authorized owner using your actual UUID:

   ```sql
   insert into wirenexus_private.owner(account_id)
   values ('OWNER-UUID-HERE');
   ```

   There can be only one owner. The browser cannot grant this role. Back up this database and configure recovery before using it for important personal definitions.
3. Configure email delivery (production SMTP recommended). Set the Magic Link email template to show `{{ .Token }}` so the owner can enter an email OTP. Configure the deployed application as the Auth site URL. This app does not require redirect-link sign-in.
4. Set these Vercel environment variables for the intended deployment environment and redeploy:

   ```text
   WIRENEXUS_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   WIRENEXUS_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   A legacy `anon` JWT key also works. Never use a service-role or secret key. `api/account-config.js` rejects privileged keys; `/account-config.json` is rewritten to that endpoint on Vercel. The committed static file disables the service for ordinary local static serving. For local integration use `vercel dev` with the same two environment variables. Do not commit credentials or edit generated bundles to configure them.
5. In the normal deployed app open any Device Editor > Defaults > **Owner Sign In**. Send the code to the administratively created owner email, then enter it and press **Sign In**. Successful RPC authorization and full library/artwork verification must show **Synced**. Unprovisioned installations say browser recovery only, never Synced. Configured signed-out users can edit projects, but cannot save personal defaults until signed in.
6. Test an unauthorized signed-in test user and an anonymous session against the RPC: both must be rejected. Test sign-out and a new browser profile. Delete the unauthorized test user afterwards.

Supabase's maintained [email OTP flow](https://supabase.com/docs/reference/javascript/auth-signinwithotp) is configured with `shouldCreateUser: false`; signup must also be disabled server-side. SQL uses verified `auth.uid()`, revoked table privileges, RLS, and narrowly granted [security-definer functions](https://supabase.com/docs/guides/database/functions) with an empty search path. A local flag, account UUID or query parameter never authorizes a write.

## Everyday Workflow

1. **Sign in:** Device Editor > Defaults > Owner Sign In. The same account is used in every computer. Sign Out clears that browser's Auth session and returns to its original recovery library. Projects stay open and unchanged.
2. **Recover old defaults:** Sign in, then **Import Browser Recovery**. Review additions, duplicates and conflicts. Explicitly choose to keep the account version of each conflict; the other version remains in the original browser for recovery/export. Confirm Import. Completion is recorded only after a verified remote commit. Repeating an import is safe. Browser IndexedDB, older settings and artwork are never deleted. To recover a conflicting browser version later, sign out, export it as Device JSON, then import/review it explicitly as a separate device.
3. **Check another computer:** Sign in on a fresh profile and check names, nodes/cards, full artwork, favourites and order. Save a test default on computer A, Refresh Account on B, and inspect it. With B's draft still open, change the same default on A; B's stale Save must fail until Reload Saved Default. A background refresh updates the library, never the open draft. Remove a default on A and verify a stale B draft cannot resurrect it. Perform these against the provisioned project before calling cross-computer acceptance complete.
4. **Ordinary export:** **Export Device JSON** remains the portable device export. `.avd` Save/Save As includes placed and unplaced Project Devices, dependency nodes and embedded original artwork. It needs no account to reopen; repository or account changes do not replace project snapshots. Keep project backups separately.
5. **Promote:** A verified owner sees **WireNexus Library Administration** in Defaults in the normal app. **Promote to WireNexus Device Library**, Review Changes, approve dependencies, Queue Reviewed Snapshot, then Export Promotions. Exporting saves the receipt to the account; it is not deployment. No GitHub token is in the app. In the repository run:

   ```sh
   node scripts/import-factory-promotions.mjs /path/to/wirenexus-factory-promotion.json
   node scripts/import-factory-promotions.mjs /path/to/wirenexus-factory-promotion.json --apply
   node scripts/factory-catalogue-validation.mjs
   ```

   Review the diff, run validations, commit/push normally and deploy. See `docs/factory-promotion.md` for importer recovery. Receipt reconciliation compares reviewed device/dependency/artwork content and personal revisions. Later edits, including on another computer, survive; Project Devices are never cleaned up. Reload the application after deployment to recognize its new catalogue.
6. **Review updates:** The orange notice beside the editor title opens a read-only comparison. **Load WireNexus Version into Draft** asks for confirmation, changes only the draft and dependencies, and remains unsaved. Save as My Default and Project Apply remain separate explicit actions. **Use WireNexus Library Version** in Defaults is the separate reset action which removes a personal override when confirmed. Existing definitions without historical provenance do not falsely claim an update; newly based library definitions carry content provenance through copies and projects.

## Storage and Failure Rules

- Auth SDK: pinned `@supabase/supabase-js`; reproducible browser bundle via `node scripts/build-account-auth.mjs`. It is not included in exported viewers.
- `wirenexus_private.library` contains a version-2 personal registry with complete definitions, node/card/pair dependencies, preferences, receipts and migration markers. Server generation CAS and per-entry expected revisions reject concurrent writes and stale deletes. There is no automatic replay of cached mutations.
- `wirenexus_private.artwork` holds original bytes by SHA-256. Uploads verify bytes before registry commit; definitions cannot refer to absent artwork. Blobs are not resized. Abandoned uploads can remain intentionally unreferenced; there is no destructive garbage collector. Provision database/request/storage capacity for original artwork; oversized requests fail without activating an incomplete definition. Account storage is for device/node artwork, not project LED walls or company logos.
- **Saving** means a remote operation is in progress. **Synced** requires verified server response and artwork. **Pending sync** means sign-in/read/refresh is incomplete or unavailable. **Sync failed** leaves the previous saved version and open draft intact; reconnect, refresh/review, then retry explicitly. A browser recovery save is labelled as such, not cloud success.
- Auth tokens are stored by the SDK in the browser for session continuity. Do not use shared/untrusted browser profiles. Only the publishable key is public. The existing hosted-viewer password system remains completely separate.
- Offline app/project use does not need Auth. Start the app while its application files are available, then open the portable `.avd`; exported HTML remains a self-contained file.

## Verification Boundaries

`test/accountLibrary.test.mjs` runs the actual migration and RPC in local PostgreSQL (PGlite) with controlled test JWT identities. `scripts/account-library-smoke.mjs` uses the real bundled Auth SDK and two isolated Chrome profiles against a local simulated Auth service backed by that SQL. These verify code/UI behavior, **not** Supabase email delivery, production JWT validation, hosted availability, Vercel environment setup or real cross-computer acceptance. Run the activation checks above after provisioning. No private projects or production catalogue test entries are required.
