# Reviewed Factory Promotion

Factory content lives in `data/factory-catalogue.json`. A browser can prepare a
portable review package, but cannot write the repository or publish a factory.
Git repository access and the normal reviewed commit/deployment remain the
publishing authority. No GitHub token, browser password, or write API is used.

## Enable an authoring build

The committed `src/buildCapabilities.js` disables authoring in public builds.
Query parameters and localStorage cannot enable its controls.

From a checked-out repository, create a **new, separate** static build directory:

```sh
node scripts/build-factory-authoring.mjs /tmp/wirenexus-authoring --enable-factory-authoring
python3 -m http.server 8769 --bind 127.0.0.1 --directory /tmp/wirenexus-authoring
```

Use `http://127.0.0.1:8769` consistently as your editing origin. The build copies
tracked application files, not untracked/private files, API endpoints or Git
credentials. It does not alter the normal checkout's capability flag. This is
an explicit development build, **not authentication**. Do not publish it as
the public application. A deployed admin build would need real server-side
access control outside this workflow.

## Edit, review and export

1. Edit the complete template and save it with **Save as My Default** or
   **Save to My Library**. Project instance names are not template names.
2. On Defaults, open **WireNexus Library Administration** and select
   **Promote to WireNexus Device Library**. Update the known library ID, or add a new stable ID.
   Retain a new personal device's ID unless a different ID is genuinely needed.
3. **Review Changes** shows changed fields, previous values, complete candidates,
   cards, required node/pair dependencies and affected users of shared definitions.
   Missing dependencies block queueing. Explicitly approve the dependencies and
   shared impacts, then **Queue Reviewed Snapshot**. A queue entry never follows
   later draft edits. Remove it and review again to change it.
4. Review the queued entries and **Export Promotions**. The download is
   `wirenexus-factory-promotion.json`. Export records a receipt, not a deployment;
   personal versions remain intact. A storage failure prevents tracked export.
   The in-memory review queue is not retained across a page reload; receipts are.

Packages contain only reviewed devices and their explicit required dependencies.
They exclude root-level project positions, wiring, private metadata, instance
names and favourites. Unsupported authored fields fail review rather than being
silently lost. Required original artwork is embedded once per SHA-256 identity;
curated thumbnails are retained, and missing faceplate thumbnails use the
existing 240x140 browser thumbnail path. No original artwork is resampled.

## Import, validate and deploy

```sh
node scripts/import-factory-promotions.mjs /path/wirenexus-factory-promotion.json --dry-run
node scripts/import-factory-promotions.mjs /path/wirenexus-factory-promotion.json --apply
node --test test/*.test.mjs
node scripts/factory-catalogue-validation.mjs
npm run check:output-viewer
git diff --check
git diff -- data/factory-catalogue.json assets/factory
```

Review and stage the intended catalogue/assets, commit, push and deploy through
the normal repository workflow. The importer **never commits or pushes**.
`--root /path/to/checkout` is available for temporary fixture repositories.
Dry-run is the default. Changed shared nodes are explicitly listed; unchanged
dependencies are checked but not rewritten. A stale per-definition base or an
unrelated dependency rejects the whole package. Identical repeated imports are
no-ops. Existing IDs and ordering are retained; new definitions append.

The importer verifies portable JSON, IDs, topology, reciprocal pairing, asset
formats/hashes and safe non-symlink paths. Existing content-identical repository
artwork is reused. New files use `assets/factory/<sha256>.<actual-format>`.
An exclusive process lock and durable recovery journal protect application.
The catalogue's atomic rename is the commit point. A failure before that point
rolls back added assets; a process crash is recovered by the next `--apply`.
After the commit point, recovery retains the complete new catalogue/assets.
If the files were independently edited during an interruption, automatic recovery
stops for manual inspection instead of overwriting those edits. The process lock
is intended for one local filesystem/host, not shared network-filesystem writers.

The catalogue keeps small promotion fingerprint receipts (not duplicate
definitions). Validation checks these plus the historical extraction inventory;
the historical inventory itself remains unchanged.

## Deployment recognition

Reload a newly built/deployed catalogue **on the same editing origin**. Browser
receipts and personal defaults do not synchronize across domains or machines.
For local authoring, rebuild into a fresh directory and serve it at the same
host/port. No settings or project files should be cleared.

- Old definition/dependencies: **Awaiting deployment**, personal version retained.
- Exact candidate and every dependency match: **WireNexus Library version active**.
- The exact personal revision/content captured at export is still present:
  remove only that redundant override, including a proven renamed new identity.
- Personal content changed meanwhile: preserve it and show **further personal
  changes remain**.
- Different library content: retain it and offer **Compare with WireNexus Library**.

Only a local receipt can authorize cleanup. A second user's matching override,
an unsaved candidate differing from a saved personal version, and unreceipted
paired-device overrides are never removed. Cleanup rechecks the revision inside
the IndexedDB transaction, so concurrent edits survive. Multiple receipts are
retained; the UI displays the latest exported receipt for the selected device.
Project snapshots/references and artwork storage are never removed by cleanup.

## Acceptance

`test/factoryPromotion.test.mjs` exercises immutable review, per-definition
conflicts, deterministic packages, E2 recognition, later edits/other users,
atomic storage, a custom paired device/node/artwork, portable asset re-embedding,
and a real SIGKILL/interrupted importer recovery in temporary repositories.
`scripts/factory-promotion-smoke.mjs` builds a temporary enabled app, exercises
real review/export controls, imports into that temporary catalogue, verifies
same-origin recognition and newer edits, and opens a downloaded Engine HTML
export with networking disabled. Public authoring remains hidden.
