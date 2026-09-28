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
node scripts/factory-catalogue-smoke.mjs
node scripts/canvas-clipboard-smoke.mjs
node scripts/device-pair-picker-smoke.mjs
```

The Defaults browser script exercises actual buttons, real IndexedDB migration
and transaction aborts, two tabs, factory updates, old project files, project
save/reopen, and network-disabled Engine HTML. Screenshots are written to
`/tmp/wirenexus-personal-defaults` by default. No test definitions or private
projects are added to the factory catalogue.
