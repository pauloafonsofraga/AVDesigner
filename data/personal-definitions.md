# Personal Definitions (Phase 2)

## Ownership

The committed `factory-catalogue.json` remains immutable. The two visible lists
have separate lookup contexts:

- Device Library uses factory definitions plus complete personal overrides and
  personal custom devices (`libraryTemplateById` / `libraryDeviceTemplates`).
- Project Devices and canvas/rack instances use the open project's definitions
  and instance snapshots (`templateById` / `templateForInstance`).

The existing `deviceLibrary` project payload is still portable. Loading it cannot
replace the personal library. Same-ID definitions in older projects remain local
to that project. New placements capture the effective library definition; later
personal saves or factory updates do not alter those captures. Project copies
carry `factoryTemplateId` when their factory counterpart is known. Names never
establish ancestry. Independent library copies have their own ID.

## Durable Storage

`src/personalDefinitions.js` owns the version-2 personal registry in IndexedDB
database `wirenexus-personal-library`. Its `registry` and `artwork` stores are
updated in one read/write transaction. The registry records complete authored
definitions, required nodes/pair dependencies, factory ID/base content revision,
and a unique personal revision. Artwork is stored as original byte arrays keyed
by SHA-256, not temporary blob URLs, expiring clipboard records, or localStorage
image strings. Repeated artwork shares one entry. Decoding assets reconstructs
portable data URLs without resampling the original images.

Pair dependencies are validated and captured. A required partner without a saved
personal entry is persisted in the same transaction. Existing independently saved
partners are not overwritten. No unrelated editor drafts are saved or discarded.

Writes compare the revision captured by the editor against the latest stored
record. Another tab's newer edit causes an explicit conflict, not last-writer-wins
data loss. Unrelated IDs are merged inside the transaction. BroadcastChannel and
window focus refresh the library but never replace open drafts. Failed writes
leave the previous definition and artwork intact. Read/migration failures use the
existing startup recovery panel; no partially loaded personal library is treated
as ready.

Reload installs the validated definition, session baseline and expected revision
together. An abandoned reload (typing, switching devices, validation or storage
failure) retains the old revision, so a stale draft still conflicts on Save. A
factory reset can finish its explicit storage removal even when new draft edits
prevent loading factory; that retained draft cannot acquire the removal's token.

Each Device Editor draft also owns a detached node/pair dependency context. A
project or instance starts with project dependencies. Reload Saved Default installs
the personal context with its definition, baseline and revision; Use Factory
Default installs factory nodes, not project or personal node overrides. Failed,
cancelled or superseded reads install none of that state. Closing invalidates
pending operations. Discard restores the matching dependency baseline. Explicit
node edits replace a context so pending reads cannot hide newer edits.

Preview, card colours, validation and personal saves consume the draft context,
not a mode-based global lookup. Applying a draft to the project resolves collisions
without side effects first, then installs node additions with the device edit.
The existing DeviceEditorApplyCommand snapshots include the node library, making
both additions and remapped references part of undo/redo. Reused dependencies are
present in the before snapshot and remain available on undo. No project nodes,
devices, cables or history change on reload, personal save, discard or close.
Device JSON export resolves all exported drafts into one collision-safe namespace;
it does not borrow only the currently selected draft's nodes. Dependency capture
includes references that exist only in installed-card overrides or saved defaults.

Node dependencies are resolved per saved device. `nodes(deviceId)` returns that
scope; unscoped `nodes()` rejects conflicting same-ID definitions instead of
silently choosing the last one. `libraryContext()` builds a detached namespace for
library previews, palette, duplication, defaults and JSON export. Intentional
node edits are explicit overrides; the open project's `cableTypes` is never a
personal dependency source. Identical saved image bytes and factory asset paths
share the catalogue's content identity, avoiding needless protocol-ID changes.

New canvas/rack placements resolve that library namespace into the project using
the same collision allocator as clipboard paste. Conflicting nodes receive stable
derived IDs, and connector/card/default references follow them. Existing project
node definitions and cables are not replaced. Original artwork and extra node
metadata survive project save/reopen. No renderer or factory schema changes are
needed.

Storage is **saved in this browser**, on the current origin. It is not account
synchronization or a backup service. Clearing site data removes the personal
library. Project and library JSON exports retain embedded portable artwork.

## Migration

The previous `av-designer:user-settings:v1` configuration-only registry is read
once and converted atomically. Stored connector/card/settings arrays replace the
corresponding factory values, without array deep-merging. Fields the old format
never saved, including names and artwork, initially come from the current factory;
the UI diagnostic states this limitation. The original localStorage value is
retained as a recovery copy. A successful migration marker prevents it from
resurrecting a default the user subsequently clears. Failure leaves the marker
unset and allows a safe retry. Malformed entries or missing factory ancestors
stop migration with a diagnostic instead of silently losing defaults.

After migration, a personal definition is a complete snapshot. Factory updates do
not merge new connectors, cards, identity fields or artwork into it.

## Defaults Actions

- **Save as My Default** saves a known factory counterpart for future placements.
- **Save to My Library** saves a personal custom device with its stable identity.
- **Save a Copy to My Library** gives an unlinked project definition a new identity.
- **Reload Saved Default** reads the saved personal definition, or factory if no
  personal default exists. It does not write storage.
- **Use Factory Default** explicitly removes that personal override and loads the
  current factory definition. Existing project instances remain unchanged.
- **Discard Unsaved Changes** restores the current draft's captured session
  baseline without changing editor mode or selecting another device.

Reload, factory reset and discard confirm before discarding draft changes. A
successful personal save keeps the editor open and advances only that draft's
baseline. Edits made during an async save remain unsaved. The footer's project save
is independent of the personal actions; no checkbox changes its meaning. General
JSON export remains a secondary portable export, not a default-save operation.

Factory promotion, receipts, promotion exports and repository import are not
implemented in this phase.

## Verification

```sh
node --test test/personalDefinitions.test.mjs test/localUserSettings.test.mjs
node scripts/global-device-defaults-smoke.mjs
node scripts/personal-definition-isolation-smoke.mjs
node scripts/editor-default-dependencies-smoke.mjs
node scripts/factory-catalogue-smoke.mjs
node scripts/canvas-clipboard-smoke.mjs
node scripts/device-pair-picker-smoke.mjs
```

The Defaults browser script exercises actual buttons, real IndexedDB migration
and transaction aborts, two tabs, factory updates, old project files, project
save/reopen, and network-disabled Engine HTML. Screenshots are written to
`/tmp/wirenexus-personal-defaults` by default. No test definitions or private
projects are added to the factory catalogue.

The isolation smoke uses two actual Chromium tabs and a native IndexedDB write
lock to deterministically hold a reload's read while typing through the editor.
It verifies the subsequent stale Save fails, and tests conflicting-node duplicate,
preview, placement, refresh, browser reload and project download/reopen. This is
automated Chromium coverage, not a claim of manual Safari or Firefox testing.

The editor-dependency smoke covers instance and Project Device editing through
the actual Reload, Save as My Default, Discard, Close, Apply, Undo and Redo buttons.
It checks the Engine and card previews, unchanged neighbouring devices/cables,
dependency reuse, and actual project download/browser reload/reopen. Fixtures and
editor opening use production functions; screenshots are written to
`/tmp/wirenexus-editor-dependencies`. Handler-level tests separately exercise read
failures, validation, cancelled confirmation, switching devices and pending edits.
