# Factory Library Additions: 2026-10-20

Baseline: `a35eed802c80be8deb2bfd7accadcb6574b0c834` on `engine-prototype`.
Build: **54.38.113 - Factory Library Additions**.

## Sources and Selection

Compared both user exports against the committed factory catalogue, using authored
definition fingerprints and decoded image-byte identities rather than data-URL
strings or browser provenance. Input checksums, export timestamps, device IDs,
connector/card/slot counts and original image hashes are recorded in
`test/fixtures/factory-library-2026-10-20.json`.

- `wirenexus-device-library (3).json`: 112 devices, 76 nodes; 15 new devices.
- `wirenexus-device-library (4).json`: 101 devices, 75 nodes; 4 new IDs, including
  two different definitions with the same V-Node name.
- All 97 existing devices and all existing node definitions match the factory.
  There are no conflicting shared IDs between the two exports.

Added 18 distinct devices:

| Brand | Models |
| --- | --- |
| PixelHue | Q8 |
| Disguise | VX 4+, VX 3, VX 2+, GX 3+, GX 3, RX III, EX 3+, EX 2C, EX 2 |
| Green Hippo | Hippotizer Boreal+ MK2 (HDMI 2.0), Hippotizer Boreal+ MK2 (DP 1.2), Hyco MX |
| Roland | V-160HD, V-80HD |
| Modulo Pi | Modulo Player Pro Ruggedized (4x4K), Modulo Kinetic Designer Ruggedized, Modulo Kinetic V-Node Ruggedized (4x4K) |

For V-Node, the user confirmed the edited definition
`custom-device-modulo-player-pro-ruggedized-4x4k-copy`, with its faceplate, eight
populated card slots and power loop-through. Excluded the unillustrated original
`modulo-pi-kinetic-vnode-ruggedized-4x4k`; it has a different fixed-port/card design
and would create a second entry with the same model name. Source exports remain
untouched. No definitions were combined or reconstructed from either variant.

Added the required `new-node-5` **ADAT-S/PDIF** node without changing its ID,
metadata, tags or artwork. Existing SFP variants and node rules are unchanged.

## Import and Parity

Authoritative location: `data/factory-catalogue.json`.
Used the existing reviewed, atomic factory-promotion importer with package ID:

`45a49a90763ef279ac42e01cbd5ef22d81cffbb7a6b718396257218dd938c8b4`

The promotion receipt records 18 device additions, one node addition and unchanged
shared dependencies. All pre-existing device records, order, node definitions and
asset manifest entries compare exactly equal before and after import.

Every added authored definition matches its source fingerprint after artwork
externalization, including dimensions, connector coordinates, relationship IDs,
cards, slot overrides, defaults, labels and faceplate transforms. Incidental
browser provenance/favorites are excluded by the existing promotion normalizer.

Thirty new PNG assets (17,380,906 bytes total) use the existing content-addressed
`assets/factory/<sha256>.png` scheme. Identical images reuse assets. Full artwork
and curated thumbnails remain separate, with exact original bytes and resolution;
no image is recompressed or regenerated. Actual format is verified from bytes.

## Measurements

Fresh Chrome context, same 1800 x 1100 viewport and local server:

| Metric | Before | After |
| --- | ---: | ---: |
| Factory devices | 97 | 115 |
| Palette node records | 59 | 60 |
| Catalogue JSON bytes | 4,337,897 | 5,561,326 |
| Initial HTML bytes | 1,602,357 | 1,602,382 |
| Initial resource requests | 127 | 127 |
| Initial resource bytes | 7,900,999 | 9,124,443 |

There is one catalogue request and no eager full-faceplate requests. New full
artwork loads only when needed, not during ordinary startup.

## Verification

- `test/factoryLibraryOctober20.test.mjs` pins all 18 original authored
  fingerprints and checks every referenced image against the source bytes and
  manifest. It also checks the addition-only promotion and new node dependency.
- `scripts/factory-library-import-smoke.mjs` covers the new entries in Chrome:
  library search, thumbnails, Device Editor, pointer insertion, offscreen HTML
  assets, offline viewer rendering and portable save/reopen.
- `scripts/factory-catalogue-smoke.mjs` additionally covers pairing, existing
  P20/Pixera editing, Publish/HTML parity, custom artwork, startup recovery and
  missing required asset failures.
- Unrelated Device JSON Import work, personal settings, project files and user
  artwork are outside this change.

Results: all **1,596 Node tests** passed in an isolated checkout of the exact
staged production tree (1,616 including the separate local import tests). All
**16 validators** passed; output-viewer, PDF and XLSX generated bundles are
current. Both Chrome acceptance scripts passed. The new-device script was also
rerun against the isolated staged tree, with no console/page errors. Inspected
Device Editor and offline-viewer screenshots confirm rendered faceplates and
cards. PDF-specific visual output was not separately rerun for this data-only
addition; the existing PDF output code is unchanged.
