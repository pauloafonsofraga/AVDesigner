# AJA Distribution Amplifier Additions

Source: `wirenexus-device-library (6).json`, exported `2026-11-19T12:06:35.382Z`.
Source SHA-256: `cea3eb2787960d491a25128d6a39d13e3f94d1361554726809132eec833d2e99`.
Baseline: `c5a625506a9a2c454fa4441cc7babfc4f3116f2d` (connector redesign reverted).

## Added Devices

| Brand | Name | Preserved source ID | Ports |
| --- | --- | --- | ---: |
| AJA | 12GDA | `custom-device-mwngz8p4` | 8 |
| AJA | 3GDA | `personal-78d26af9-feb3-486a-8069-3f679262c1bc` | 8 |

Both are under **Video / Splitters**, with one SDI input, six SDI outputs and a
barrel-power connector. The input/output names, rates, dimensions, artwork
transforms, connector identities, anchors and positions are preserved exactly.
The source's `A/C IN` power caption and the 3GDA output captions remain as authored;
this import does not reinterpret hardware or rewrite user labels.

The existing reviewed atomic factory importer adds only these two definitions.
Their existing SDI and Barrel Jack dependencies match current factory definitions,
including byte-identical thumbnails. No connector is added or changed.
Four content-addressed PNGs preserve the original two faceplates and thumbnails.

The prior user-requested factory attribution is retained for the additions:
`WireNexus (unverified)`, with no invented account identity or creation date.
Browser-only `favorite` and inactive `enableInternalRouting: false` export noise
are excluded through the established promotion contract. No enabled capability
is discarded and no application schema or behavior changes.

Promotion receipt: `682e60c13c93d64e035d8470143eda447b99aaf04a882dbbe877937a9061e4a2`.
The review fixture records source fingerprints, exact connector snapshots,
geometry, asset hashes and checksums of all 156 pre-existing devices.

## Verification

- Full isolated-source suite: **2,546 passed, zero failures or skips**.
- Factory catalogue/provenance checks: **158 devices, 66 nodes, 79 node types,
  337 byte-checked assets**. All 333 original assets remain unchanged.
- Four new focused tests verify additions-only scope, exact source geometry and
  artwork, unchanged connector definitions and portable `.wnx` round trips.
- Chrome: both library entries and author labels, real drag insertion, Device
  Editor artwork decoding, offline HTML with full artwork, and `.avd` save/reopen
  all pass without browser errors.
- Viewer, Cable Schedule and PDF bundles remain unchanged and reproducible.
- Historical test expectations are retained: the new receipt and exact hashes
  are verified before reconstructing the earlier catalogue snapshots.

No existing device, personal library, project instance, connector appearance,
compatibility rule, source artwork, backup, Masters file or unrelated working
change is modified. No deployment or infrastructure changes.
