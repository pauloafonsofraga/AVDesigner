# Factory Library Additions: 2026-10-21

Baseline: `5d1b2caf05baeb8a14f387e660fb33528f79ab4d` on `engine-prototype`.
Build: **54.38.123 - Factory Library Additions**.

Compared `wirenexus-device-library (5).json` (123 devices, 76 exported nodes)
against the committed factory catalogue (115 devices). Added the eight new IDs;
none duplicates an existing brand/model. Existing entries are not updated by
this import, including any edits to already-known devices in the export.

| Brand | Models |
| --- | --- |
| Christie | Spyder X80 |
| Analog Way | Zenith 200, Zenith 100, Eikos 4K, Pulse 4K, QuickMatrix 4K, QuickVu 4K, Ascender 48 4K-PL |

Used the reviewed atomic factory-promotion importer. Receipt:
`bc62af4e0b84850407afc0cbb9cf65d6f81f579895cc18f4af0176c1e190560e`.
All fifteen required shared node definitions already match the factory; no new
nodes or compatibility changes are needed. Browser provenance is removed by the
existing promotion normalizer; original stable IDs remain intact.

The authoritative `data/factory-catalogue.json` now has 123 devices. All prior
device records, order, node definitions, thumbnail mappings and manifest entries
compare exactly equal before and after import. The source export is untouched.

Sixteen new content-addressed assets under `assets/factory/` total 9,073,908
bytes. Full artwork and curated thumbnails retain their exact original bytes,
format and resolution. Existing assets are reused. Catalogue JSON grows from
5,561,326 to 6,263,331 bytes. No runtime loading behavior changes.

`test/fixtures/factory-library-2026-10-21.json` records the source checksum,
authored fingerprints, connector/card/slot counts and decoded image hashes.
`test/factoryLibraryOctober21.test.mjs` verifies definition/artwork parity and
addition-only promotion. The existing Chrome acceptance script accepts
`AVDESIGNER_FACTORY_INVENTORY` to exercise this batch as well as the prior batch.

This change does not include the local Device JSON Import implementation, user
artwork, backups or Masters files. Prompt 2/8 and unrelated PDF changes are out
of scope.

## Verification Results

- All **1,807 Node tests** passed on an isolated checkout of the staged source,
  excluding the unrelated local Device JSON Import code and its tests.
- All **16 static validators** passed. Output-viewer, PDF and XLSX generated
  bundle checks passed.
- Chrome acceptance passed for all eight entries: library search, bounded
  thumbnail decoding, Device Editor artwork and authored connector/card counts,
  pointer insertion, offscreen assets in HTML, offline viewer and save/reopen.
  There were no browser console or page errors. Inspected Device Editor and
  offline-viewer screenshots confirm the original faceplates are rendered.
- Protected artwork, faceplates, backups, Masters and local import files remain
  byte-identical; the original 49-line index import patch remains unstaged.
- No PDF-specific visual smoke was rerun for this catalogue-only addition.
  The pre-existing PDF Jump-label null-connector failure documented in
  `card-swap-slot-preservation.md` remains outside this change.
