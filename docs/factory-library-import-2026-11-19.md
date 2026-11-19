# Factory Library Update, November 19

Source: `wirenexus-device-library.json`, exported 2026-11-19 07:53:54 UTC.
Starting commit: `53b994509c96ccb68c881ccecf8c6ea5a4c7b163`.
The original 197,549,649-byte export is not copied into Git.

## Additions

| Manufacturer | Device | Connectors | Card Types / Slots |
| --- | --- | ---: | ---: |
| Analog Way | Pulse² | 32 | 0 / 0 |
| Dell | Vostro 3510 i7 | 7 | 0 / 0 |
| Lenovo | Legion 5 13650HX | 8 | 0 / 0 |
| Asus | ROG Strix GL703M | 10 | 0 / 0 |
| MSI | Vector GP66 12UGS-452UK | 9 | 0 / 0 |
| Generic | Media Server | 11 | 0 / 0 |
| Dataton | WATCHPAX 64 | 11 | 4 / 4 |
| Twoloox | Pandoras Box Server L GEN 1 | 11 | 15 / 8 |
| Ross | Carbonite Ultra 60 | 26 | 1 / 2 |
| Decimator Design | MD-HX | 8 | 0 / 0 |
| Decimator Design | 12G-CROSS | 9 | 0 / 0 |
| Decimator Design | MD-CROSS V2 | 8 | 0 / 0 |
| Blackmagic Design | Micro Converter SDI - HDMI 3G | 4 | 0 / 0 |
| Blackmagic Design | Micro Converter SDI - HDMI 12G | 4 | 0 / 0 |
| Blackmagic Design | Micro Converter HDMI - SDI 3G | 4 | 0 / 0 |
| Blackmagic Design | Micro Converter HDMI - SDI 12G | 4 | 0 / 0 |
| Blackmagick Design (source spelling) | HDMI - SDI Bi-Directional 12G | 5 | 0 / 0 |

## Existing Definition Changes

- Generic Laptop: manufacturer changed from Misc. to Generic.
- Existing HDMI/SDI bi-directional converter: name and model changed to
  `HDMI - SDI Bi-Directional 3G`; connector definitions unchanged.
- Both ATEM Constellation definitions: manufacturer spelling changed from
  `Black Magic Design` to `Blackmagic Design`; existing model spelling retained.
- Modulo Kinetic V-Node Ruggedized (4x4K), Modulo Kinetic Designer Ruggedized,
  and Modulo Player Pro Ruggedized (4x4K): `TC-USB-R In (DELTA-HOST) Copy`
  renamed to `TC-USB-R In (DELTA-HOST)`; card/slot identities and layouts unchanged.
- Analog Way Ascender 48 4K-PL: moved from Media Servers / Players to Switchers.
- Barco EX: height 1040 -> 948. Connectors, their paired anchors and both card
  slots shift up 92 units. Card slots 208 -> 116. Artwork reservation now matches
  visible artwork height 33.07330827067669 instead of 126. IDs and card geometry
  are unchanged; no physical connections are authored in library definitions.
- Analog Way CorePlay Solo: height 674 -> 626, connectors/anchors up 48 units;
  the faceplate connector reservation is corrected to visible content bounds.
- 4-Channel XLR Snake: editor-normalized schema, physical connector aliases and
  explicit anchors; outer dimensions 220x272 -> 380x308. Both end definitions
  remain 220x272 and all four channel mappings, connector IDs and end identities
  remain unchanged.

Favorites, library provenance and disabled `enableInternalRouting: false`
serialization noise are not promoted. All exported node definitions already
match the factory dependencies, so none are replaced. Source descriptions,
including the identical inherited hardware wording in WATCHPAX/Pandoras Box,
are preserved, not independently certified or rewritten.

## Import and Protection

The existing reviewed factory-promotion API and atomic importer were used.
Receipt: `7891aaef736e9b4762e3cf6a8de01920a1aa68aff2596aa21ebfc75b976d2d07`.
Seventeen additions and eleven updates produce 153 factory devices. Original
ordering and IDs are preserved. Both generic transceiver/breakout lab devices
omitted from the export remain available. No name/ID duplicates were found.

Thirty-five content-addressed image assets (38,129,638 bytes) are added, reusing
existing hashes for unchanged artwork. Original faceplate/backplate/card bytes
are retained without recompression. All existing 292 asset manifest entries and
all shared nodes are unchanged. Existing saved projects and personal overrides
are not rewritten; updates apply to fresh factory-library usage.

`test/fixtures/factory-library-2026-11-19.json` records the source checksum,
reviewed fingerprints, counts, original definitions, replacement checksums and artwork hashes.
Historical tests verify the exact authorized replacements and reconstruct only
the eleven older definitions for their original assertions. Historical fixtures
are not changed. The snake package test now verifies all explicit physical-type
aliases, not only the old minimal record's `type` field.

## Verification

- Full automated suite: 2,533 passed, zero failures/skips. Factory/promotion and
  all generated-output validators pass; 327 artwork files are byte-checked.
- Chrome: all 28 affected entries searchable, original artwork decoded, bounded
  thumbnails checked, Device Editor connector/card/slot counts verified.
- Real library drags, all-entry HTML export, offline Viewer artwork decoding,
  and `.avd` save/reopen; the snake projects as two ends of one logical device.
- Protected local artwork, Masters, backups and unrelated work are excluded.

No application behavior, infrastructure, staging environment or production
deployment changes are included. Commit/push of the factory catalogue is separate
from deployment; reload after a later deployment to obtain the new defaults.
