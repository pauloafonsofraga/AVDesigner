# Factory Library Additions: 2026-10-22

Baseline: `7322119e85d29459683fdb9efb163b5d6da945b1` on `engine-prototype`.
Build: **54.38.130 - Factory Library Additions**.

Compared `wirenexus-device-library.json` (128 devices, 76 nodes) with the committed factory catalogue (123 devices). Five IDs are new, with no duplicate brand/model names:

| Brand | Model | Connectors | Cards | Slots |
| --- | --- | --- | --- | --- |
| Roland | V-1-4K | 18 | 0 | 0 |
| Barco | E3 | 10 | 7 | 7 |
| PixelHue | P80 | 49 | 4 | 1 |
| Kommander | T1 | 20 | 1 | 0 |
| Theatrixx | 8-Bay Reversible Frame | 2 | 34 | 8 |

All 21 required shared node definitions already match factory. The reviewed atomic promotion importer adds only these devices; all 123 existing device records and their ordering, shared nodes, curated thumbnail mappings and existing asset-manifest entries compare exactly equal before and after. Existing-device edits in the export are not promoted by this additions-only import.

Promotion receipt: `adc284f0263e2b97c49534ddee066306ea97831102921a69e18020aac7994fdd`.
Factory count is now 128. Authored IDs, dimensions, connector positions, shared buses, modules, card definitions and installed slots retain their normalized source fingerprints. Existing promotion rules remove personal/browser provenance.

Ten content-addressed PNG assets under `assets/factory/` total 2,634,999 bytes. Original full artwork and curated thumbnails retain their exact bytes and resolutions. Catalogue JSON grows from 6,263,331 to 6,804,195 bytes. Factory loading and portable-export behavior use the existing paths.

`test/fixtures/factory-library-2026-10-22.json` records the source checksum, promotion receipt, authored fingerprints, counts and artwork hashes. `test/factoryLibraryOctober22.test.mjs` verifies source parity, addition-only promotion and unique device identities.

Source export, unfinished Device JSON Import, protected faceplates, Masters and backups are excluded from the changes. No deployment or release tag is created.

## Verification

- All 1,860 Node tests, all 16 static validators, and the output-viewer, PDF and XLSX bundle checks passed against an isolated staged tree with unfinished Device JSON Import excluded.
- Installed Chrome acceptance passed for all five devices: search, bounded thumbnails, full artwork and authored connector/card/slot counts in Device Editor. Native drags inserted the first and last additions.
- All five faceplates, including offscreen artwork, are embedded in HTML; the viewer decoded them with network access blocked. Save/reopen retained the device definitions, card layouts and embedded device/node artwork. No browser errors occurred.
- Inspected Device Editor and offline-viewer screenshots. Source fingerprints and image byte hashes match. All 123 prior factory records and shared definitions remain unchanged.
- SHA-256 checks passed for all 101 protected paths and the original source export; the existing 49-line index import patch remains unstaged. Evidence is in `/tmp/wirenexus-factory-oct22-*.log` and the `factory-library-import-*` directory printed by the Chrome script.
- PDF-specific visual export was not rerun for this catalogue-only addition.
