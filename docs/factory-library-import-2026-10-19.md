# Factory library import, 2026-10-19

Source: `wirenexus-device-library (1).json`, exported at
`2026-10-19T10:27:48.171Z` (97 devices, 74 node definitions).
Source SHA-256: `6ab9b2a44d934291d94d09f49741adf2684ecc082dab894851e44e69db842dee`.
Compared against `cad4cf5b7e51227ccdd30d371b800fd34b1bdc7b`.

## Reviewed differences

- Added Megapixel Helios (`custom-device-mvaqvarp`): 15 connectors,
  3 card types, 2 slots with the exported DisplayPort/HDMI defaults.
- Added Megapixel RS12 (`custom-device-mvevuyh2`): 12 both-side Ethernet
  connectors, OpticalCon and powerCON TRUE1.
- Updated P20 (`custom-device-mq84dpgn`): eight SFP+ cage matrix-inclusion
  flags in its retained card definitions changed from true to false.
  Its 54 device connectors and disabled swappable-card configuration remain.
- Updated ProSafe XS508M (`prosafe-xs508m`): eight RJ45 connector x coordinates
  changed from 0 to 380. Both-side placement, bidirectionality, anchor IDs and
  anchor coordinates remain exactly as exported.
- The other 93 factory devices and all 74 supplied nodes match after authored
  normalization and image-byte hashing. No deletions. The newer SFP28 Cage,
  absent from the supplied file, remains available.

## Import and artwork

Used the reviewed factory-promotion importer, with package ID
`457fbc5f4121b15336a72bb228ec7970413b957c139b3c79cf5c9a400b0288ca`.
Its receipt is in `data/factory-catalogue.json`, the authoritative catalogue.
Existing device IDs and ordering are preserved; the two new entries are appended.
Project files, personal defaults and account libraries are not rewritten.

Four content-addressed PNG assets were added under `assets/factory/`, retaining
the exact source bytes: Helios faceplate 1800x168 and thumbnail 240x22;
RS12 faceplate 1800x229 and thumbnail 240x31. Total new artwork: 1,082,974 bytes.
Existing artwork is reused; no image resizing or re-encoding was required.

`test/curatedFactoryDevices.test.mjs` verifies the four imported authored
fingerprints against the source export, reading actual image bytes, plus card,
port and thumbnail dimensions. `scripts/factory-catalogue-smoke.mjs` covers the
new devices in search/Device Editor, offscreen offline HTML artwork and portable
project save/reopen. Existing catalogue validation checks all promotion receipts,
original factory identity/order, node definitions and asset checksums.

Verification for build 54.38.101: 1,382 Node tests, all 16 validation scripts,
11 Chrome catalogue smoke checks, and current viewer/cable-schedule/PDF bundles.
Inspected Helios and RS12 editor screenshots and the offline Helios viewer.
