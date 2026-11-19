# AJA Additions, Factory Authorship and Misc Audit

Source: `wirenexus-device-library (5).json`, exported 2026-11-19 09:38:38 UTC.
Source SHA-256: `f83aa11c3469086305f1e17c4ed65e9f650cba86b16af980c5841de30c15cf85`.
Starting commit: `784ca874e6f69d70392fc28e077dec298fad91b6`.

## New Devices

| Manufacturer | Device | Connectors |
| --- | --- | ---: |
| AJA | 12G-SDI to/from SDI Muxer/DeMuxer | 10 |
| AJA | FS-Mini Frame Synchronizer | 8 |
| AJA | GEN10 HD/SD Sync Generator | 8 |

The existing reviewed, atomic factory importer adds only these three definitions,
including their original artwork and Mini-USB-A/Barrel Jack dependencies.
Six content-addressed image assets are added. Existing factory node definitions,
artwork, device ordering and all existing device configuration are unchanged.
The two generic lab definitions have only editor-normalization differences in the
export and are not updated by this additions-only request.

Addition receipt: `43a9aa9b742c4a74c53733d4013ac90368ea6960dc16210a7e9f71f8c9747dd7`.

## Author

As explicitly requested, all 156 current factory definitions carry the public
author claim `WireNexus` through the existing attribution structure:

```json
{"version":1,"creatorId":"","displayName":"WireNexus","createdAt":null}
```

No account identity, creation date, signature or verified status is invented.
The current Inspector therefore displays `WireNexus (unverified)` and
`Unknown date`. Existing signing and new-user attribution behavior is unchanged.
User-created future definitions retain their own authors. Historical project
snapshots, personal libraries and the source export are not rewritten.

Authorship-only receipt: `18d5452fc8ea3d23cbd9da1d3de614960f95b8f92e265a644a847fff58efc87a`.
Per-device fingerprints and baseline checksums prove that attribution is the
only change to the 153 pre-existing factory definitions.

## Devices Using Misc

The audit checks `type`, `physicalType`, `connectorType` and `compatibilityType`
in device connectors and all modular card definitions. It finds 21 devices and
65 definition-level entries. These are not physical cable counts; standalone and
card records can describe related interfaces.

| Device | Misc connector labels |
| --- | --- |
| Barco E2 Gen2 | S3D IN 1-4; LOOP x2 |
| Barco E2 Gen1 | S3D In 1-4; LOOP x2 |
| Barco S3 | S3D In 1-4; LOOP x2 |
| Blustream ACM200 | RS-232; IR CTRL |
| BluStream IP50HD-RX | IR In; RS-232; LOOP; AUDIO OUT L/R |
| BluStream IP50HD-TX | IR In; RS-232; LOOP x2; AUDIN IN L/R |
| Blackmagic ATEM Contellation 4 M/E 4K | REMOTE IN |
| Yamaha DM7 | GPIO |
| Novastar VX2S | CVBS - 1; CVBS - 2 |
| Novastar VX4S | CVBS - 1; CVBS - 2 |
| Panasonic PT-RQ50K | Remote 2 In |
| Panasonic PT-RQ25K | Remote 2 In |
| Christie Griffyn 4K50-RGB | GPIO; PHOENIX |
| Christie Sapphire 4K40-RGBH | GPIO; PHOENIX |
| Brompton Tessera SQ200 | GPIO |
| Roland V-160HD | TALLY/GPIO |
| Roland V-80HD | TALLY/GPIO |
| Christie Spyder X80 | PCIe IN/OUT on device and installed LINK card |
| Analog Way Ascender 48 4K-PL | TALLY/GPIO; LIVECORE LINK 1-3 |
| Analog Way Pulse² | S/PDIF x4; PHOENIX 4 POLE x6 |
| Ross Carbonite Ultra 60 | Tally; GPIO; LTC |

These labels are reported as stored, not certified physical connector identities.
No Misc connector, electrical compatibility or existing wiring is modified.
Exact connector IDs and card ownership are recorded in
`test/fixtures/factory-aja-attribution-2026-11-19.json`.

## Verification and Scope

Focused tests cover source fingerprints, byte-exact artwork, stable IDs/order,
author-claim persistence in `.wnx`, unchanged new-user attribution, and the Misc
inventory. Historical import assertions retain their original source evidence;
only the precisely validated author claims and three later additions are removed
when reconstructing their historical fixtures.

Chrome checks the three Device Editor entries and author/date labels, real
library insertion, offline HTML artwork and local project save/reopen.
The complete automated suite passes 2,542 tests with no failures or skips;
factory validation byte-checks all 333 artwork assets. Generated output bundles
remain unchanged and current.
No authentication policy, signing configuration, database, deployment or
infrastructure changes are included. Unrelated local work is excluded.
