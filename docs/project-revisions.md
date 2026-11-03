# Manual Project Revisions

The Revisions toolbar action opens a draggable project-local history window. Create
captures the complete portable project using the existing `.avd` serializer. Names
default to `Project Name - Rev N` (the UI uses an em dash); numbers are monotonic
even after deletion. Each entry records its creation time and the authenticated
account's display name/email when available. Offline entries show Author unavailable.

Rename, delete and restore are independent of canvas Undo/Redo. Archive edits mark
the project unsaved. Save locally or to Cloud to retain them across reopening.
Cloud project versions include the same archive, using existing authorization,
quota, upload and conflict protection. No database migration is required.

## Restore Safety

Restore offers Preserve Current & Restore, Restore Without Snapshot, and Cancel.
Preserving captures the current complete state as another revision before loading
the requested snapshot. The safety revision remains if loading fails. Restoring
retains the archive and local file handle, does not mark the project saved, and
opens a local working copy: it detaches any cloud binding rather than overwriting
the remote head. Save to Cloud is an explicit subsequent action.

Live collaboration permits browsing/exporting revisions, but blocks creating,
renaming, deleting and restoring them. Use the existing server-authoritative
Checkpoint workflow or leave collaboration first. Revisions are not collaboration
commands and do not bypass server sequencing or topology validation.

## File Format and Artwork

`projectRevisions` is an optional v1 field. Older files remain unchanged until the
first revision is created. Each entry contains a JSON-string portable snapshot
without another revision archive. Immutable embedded artwork is replaced inside
those strings by SHA-256 references to one shared archive asset pool. Original
image bytes/transparency are retained; only unused archived assets are reclaimed
on deletion. Active project artwork keeps its existing ownership/schema.

Export expands a revision to an ordinary standalone `.avd`, without the archive.
Read-only HTML/published viewers omit revision history so previously removed
content is not disclosed. Project/account switches invalidate pending captures.
The archive has shape/reference validation on load and artwork integrity checks
before restore/export.

Complete project snapshots still consume space for non-artwork data. Existing
cloud file/storage quotas apply. Revisions are not external backups until saved,
and do not replace cloud version recovery. Attribution is descriptive, not an
authorization claim.

## Validation

- `node --test test/projectRevisions.test.mjs test/cloudProjects.test.mjs test/toolbarIcons.test.mjs`
- `node scripts/project-revisions-smoke.mjs` against a local server
- `node scripts/account-portal-smoke.mjs` (local SDK/database fixtures)

Coverage includes complete snapshots, artwork pooling/integrity, historical files,
numbering, rename/delete, preserve/cancel/explicit restore, dirty-state tracking,
Undo/Redo independence, cloud save/version recovery, project/account races,
collaboration gates and desktop/mobile Chrome rendering. Browser tests use only
synthetic projects and block external services.
