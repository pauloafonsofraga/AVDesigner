# Miscellaneous Connector Replacement

## Scope and Compatibility

Development on `engine-prototype`, starting at `0a0623467851149c9177b02ace805eabd8278d24`. No deployment or remote configuration changes.

38 definition-level connectors in 16 existing devices are retyped. No devices are recreated. Device/connector/card/slot identities, ordering, positions, anchors, dimensions, artwork, names, relationships and directions remain unchanged. Default Misc grey (`#37474F`) is cleared only on retyped ports so their new physical type supplies its colour; any genuinely different custom colour is retained. Existing type colours are unchanged.

The review fixture `test/fixtures/misc-connector-replacements.json` contains every exact update, original definitions, reviewed hashes and promotion receipts. Historical import tests first verify those hashes, then reconstruct the original definitions; their original fixtures and assertions remain intact. The curation script is dry-run by default and refuses to reapply an already-applied update.

## New Physical Families

| ID | Name | Colour |
|---|---|---|
| `db9` | DB9 / DE-9 D-sub | `#987AA0` |
| `db15` | DB15 / DA-15, two-row (not HD15/VGA) | `#987AA0` |
| `db25` | DB25 D-sub | `#987AA0` |
| `rj12` | Six-position modular connector | `#B17C5B` |
| `trs-3.5mm` | 3.5 mm TRS | `#5D9B82` |
| `pluggable-terminal` | Configurable pluggable terminal block | `#A58C56` |
| `circular-din` | Configurable circular DIN | `#B87588` |
| `external-pcie-link` | Proprietary external PCIe link | `#787FB0` |
| `livecore-link` | Analog Way LiveCore Link | `#A4775E` |

BNC and RCA are reused. Existing TRS/TS is unchanged; it is not relabelled as a 3.5 mm connector. Circular DIN is available for authoring but is **not assigned to the uncertain Barco S3D ports**. Pin count, pin arrangement and diameter must be declared to verify its physical subtype. RJ12 declares six positions, not an invented populated-contact count. Neither proprietary connector claims a standard connector shell, PCIe generation/lane count or cross-vendor mating.

## Exact Factory Changes

All listed entries previously used `misc`. Unless a card is stated, IDs refer to the device's root connectors. User-authored captions remain unchanged, including historical spelling.

| Device / factory ID | Connector IDs | New type and declarations |
|---|---|---|
| Blustream ACM200 / `custom-device-mqj3nj49` | `input-slot-1` | DB9, RS-232, 9 pins |
| Same | `input-slot-2` | 3.5 mm TRS, infrared control |
| Blustream IP50HD-RX / `custom-device-mqj43gzs` | `input-slot-1` | 3.5 mm TRS, IR input |
| Same | `input-slot-3` | Pluggable terminal, 3 poles, RS-232 |
| Same | `output-slot-6` | Pluggable terminal, 3 poles, analogue stereo |
| Blustream IP50HD-TX / `custom-device-custom-device-copy` | `input-slot-1` | 3.5 mm TRS, IR input |
| Same | `input-slot-3` | Pluggable terminal, 3 poles, RS-232 |
| Same | `input-slot-5` | Pluggable terminal, 3 poles, analogue stereo |
| ATEM Constellation 4 M/E 4K / `custom-device-mqkjqqqd` | `input-slot-44-2` | RJ12, 6 positions, RS-422 |
| Yamaha DM7 / `custom-device-mqw9yhs8` | `input-slot-37` | DB15, 15 pins, GPIO |
| NovaStar VX4S / `custom-device-mqz28eyz` | `input-slot-9`, `input-slot-10` | Existing BNC, CVBS |
| Panasonic PT-RQ50K / `custom-device-mtidnv7i` | `input-slot-3` | DB9, 9 pins, parallel control (not RS-232) |
| Panasonic PT-RQ25K / `panasonic-pt-rq25k` | `input-slot-3` | DB9, 9 pins, parallel control |
| Christie Griffyn / `christie-griffyn-4k50-rgb` | `input-slot-15` | DB9, 9 pins, GPIO |
| Christie Sapphire / `christie-sapphire-4k40-rgbh` | `input-slot-15` | DB9, 9 pins, GPIO |
| Roland V-160HD / `custom-device-mvgekxns` | `input-slot-3` | DB25, 25 pins, tally/GPIO |
| Roland V-80HD / `custom-device-v-160hd-copy` | `input-slot-3` | DB25, 25 pins, tally/GPIO |
| Christie Spyder X80 / `custom-device-mvhqsv2w` | `input-slot-20`, `output-slot-2` | Proprietary external PCIe, Christie X80 interface |
| Same, LINK card `card-3` | `input-2`, `output-2` | Same physical family and vendor interface; local card IDs retained |
| Analog Way Ascender 48 / `custom-device-mvi2qkk6` | `input-slot-46` | Pluggable terminal, 10 poles, MCO, tally/GPIO |
| Same | `input-slot-47`, `input-slot-48`, `input-slot-49` | Proprietary LiveCore Link, OPT-LINK interface |
| Analog Way Pulse2 / `custom-device-mwdl1enc` | `input-slot-15`, `input-slot-16`, `output-slot-3`, `output-slot-4` | Existing RCA, S/PDIF |
| Same | `output-slot-1`, `output-slot-2`, `input-slot-18`, `input-slot-19`, `input-slot-20`, `input-slot-24` | Pluggable terminal, **5 poles**, MCO, balanced stereo audio |
| Ross Carbonite Ultra 60 / `custom-device-mwkqpl2j` | `input-slot-14` | DB25, 25 pins, tally |
| Same | `input-slot-15` | DB25, 25 pins, GPIO |

**Pulse2 discrepancy:** saved captions say `PHOENIX 4 POLE`. The manufacturer's manual specifies six 5-pin audio terminals. The verified pole metadata is five; captions are preserved, not silently rewritten. Exact MCO part numbers and pitches are not guessed.

## Manufacturer Evidence

- [Blustream ACM200 specification, p2](https://www.blustream.com.au/Attachment/DownloadFile?downloadId=379): DB9 female RS-232 and stereo 3.5 mm IR. [IP50HD manual, pp4-5 and 27](https://www.blustream.com.au/Attachment/DownloadFile?downloadId=1132): stereo IR input, mono IR output and 3-pole serial/audio terminals. Terminal pitch/series remain unknown.
- [Blackmagic ATEM technical specifications](https://www.blackmagicdesign.com/products/atemconstellation/techspecs/W-APS-25): the 4 M/E 4K Remote interface is RJ12 carrying RS-422. This is not the RJ45 talkback connection.
- [Yamaha DM7 rear panel reference](https://manual.yamaha.com/pa/mixers/dm7/rm/en-US/9523967115.html): 15-contact D-sub GPI, five inputs/five outputs.
- [NovaStar VX4S specification](https://oss.novastar.tech/uploads/2019/06/LED-Video-Controller-VX4S-Specifications-V1.0.5.pdf): rear-panel BNC CVBS inputs. No claim is made for the differently named VX2S.
- [Panasonic RQ50K terminal specification](https://docs.connect.panasonic.com/projector/products/rq50k/spec/) and [RQ25K family specification](https://eu.connect.panasonic.com/sites/default/files/media/document/2024-04/PT_RQ25K_S_2P_ctlg_Eng.pdf): Remote 2 uses female 9-contact D-sub parallel control, separately from the serial ports.
- [Christie Griffyn setup guide, GPIO section](https://www.christiedigital.com/globalassets/resources/public/020-103314-24-Christie-LIT-GUID-SET-Griffyn-RGB.pdf) and [Sapphire guide, p80](https://www.christiedigital.com/globalassets/resources/public/020-103979-04-Christie-LIT-GUID-SET-Sapphire.pdf): 9-contact D-sub GPIO, with seven programmable pins plus supply and ground. Runtime pin assignments are not inferred.
- [Roland V-160HD connector specification](https://support.roland.com/hc/en-us/articles/13823341869083-V-160HD-Tally-GPIO-Connector-Specifications) and [V-80HD specifications](https://proav.roland.com/de/products/v-80hd/): 25-contact D-sub tally/GPIO. User-configurable mappings are not assigned a universal pinout.
- [Christie Spyder Studio guide, p32](https://www.christiedigital.com/globalassets/resources/public/020-102579-04-christie-lit-man-usr-spyder-studio.pdf): the X80 uses a PCIe assembly with host/target ends between master OUT and slave IN. This does not certify arbitrary external PCIe hardware.
- Analog Way's manufacturer-authored [Pulse2 manual, pp14 and 25-27, distributor mirror](https://www.dimmer.fr/wp-content/uploads/2024/07/user-manual-pulse2-3g-pulse2-h2.pdf): six 5-pole audio terminals, MCO male chassis sockets; the rear diagram confirms RCA S/PDIF. [Official product/manual index](https://www.analogway.com/products/pulse2). The official download host returned HTTP 403, so the manufacturer's mirrored manual was inspected directly.
- Analog Way's manufacturer-authored [Ascender quick start guide](https://www.manualsdir.com/manuals/327125/analog-way-ascender-48.html) specifies the MCO 10-pole connector. [LiveCore manual, pp31-32, 75 and 114, distributor mirror](https://transquebec.com/wp-content/uploads/livecore-unit-user-manual-uk.pdf) documents the ten tally/GPIO pins and three dedicated OPT-LINK cables. [Official documentation index](https://www.analogway.com/products/ascender-48).
- [Ross Ultra 60 hardware QuickStart](https://documentation.rossvideo.com/files/Manuals/Production%20Switchers/Carbonite%20Ultra%2060/Manuals/Carbonite-Ultra-60-Hardware-QS%284890DR-200%29.pdf): DB25 tally/GPIO; LTC is discussed below because hardware revisions differ.

## Unresolved: 27 Entries Remain Misc

- **Barco E2 Gen2** `barco-e2-gen2`, **E2 Gen1** `custom-device-e2-gen2-copy`, **S3** `custom-device-e2-gen1-copy`: each has `input-slot-1` through `input-slot-4` (S3D) and `output-slot-3`, `output-slot-4` (named LOOP). The saved through relationships link those LOOP nodes to S3D inputs. Each device already has a separate BNC genlock `output-slot-5` LOOP. [Barco specifications](https://www.barco.com/en/product/e2-gen-2) identify DIN S3D and BNC genlock but do not identify the exact S3D pin arrangement. Retyping the two S3D-associated LOOP nodes as BNC would risk documenting the wrong sockets. All 18 remain unchanged.
- **Blustream IP50HD-RX** `custom-device-mqj43gzs`: `output-slot-1`; **TX** `custom-device-custom-device-copy`: `output-slot-1`, `output-slot-6`. Manufacturer hardware has mono 3.5 mm IR output, audio terminal output and (TX only) HDMI loop-out. The TX HDMI loop is already correctly typed at `output-slot-3`. The generic LOOP captions and authored through mappings are not sufficient evidence to certify these three Misc IDs as a specific physical socket. No HDMI guess.
- **NovaStar VX2S** `custom-device-vx4s-copy`: `input-slot-9`, `input-slot-10`. No reliable model-specific manufacturer specification was located; a copied VX4S-derived ID is not hardware evidence.
- **Christie Griffyn/Sapphire**: `input-slot-18` on each. PHOENIX does not specify pole count or terminal series. [Sapphire's setup guide](https://www.christiedigital.com/globalassets/resources/public/020-103979-01-christie-lit-guid-set-sapphire.pdf) describes Hibernate as reserved for future use; its purpose does not identify this saved socket's mechanical subtype.
- **Brompton SQ200** `brompton-tessera-sq200`: `input-slot-3`. [Manufacturer sheet](https://www.bromptontech.com/wp-content/uploads/2026/01/Brompton-Tessera-SQ200_Jan2026.pdf) identifies a GPIO trigger port but not a reliable terminal series/pole specification.
- **Ross Ultra 60** `custom-device-mwkqpl2j`: `input-slot-16`. [Manufacturer manual](https://documentation.rossvideo.com/files/Manuals/Production%20Switchers/Carbonite%20Ultra%2060/Manuals/Carbonite-Ultra-60-Manual%284890DR-110%29.pdf) explicitly notes LTC port appearance depends on hardware version. Three contacts alone do not establish a pluggable terminal rather than another connector. Hardware-revision confirmation is needed.

## Metadata and Validation

Uses the existing connector `physicalConstraints` field with an optional versioned plain-JSON declaration, propagated through the established connector metadata paths:

```json
{"version":1,"poleCount":3,"signalFamily":"control","protocol":"rs-232"}
```

Optional properties include pin/contact/position counts, terminal pitch and series, DIN diameter and pin arrangement, protocol, signal family, documented `pinoutId`, and proprietary `vendorInterface`. Absent values remain unknown. A stable documented pinout identifier can be authored when verified; this pass does not invent universal wiring maps or cable adapters.

The existing compatibility summary and saved-link status pipeline now handle these opt-in declarations. Known conflicts reject symmetrically. Incomplete matching shapes remain Unverified, including missing pinouts, terminal pitch/series and DIN configuration. Tally/GPIO/parallel-control application names are not, by themselves, proof of an electrical conflict; differing applications remain Unverified. Historical untagged BNC/RCA/TRS and all other families keep their previous verdicts. No inference from colour.

Controls are collapsed inside existing Node Builder, Device/Card Editor and Canvas Inspector; no new window. Connected canvas ports require disconnection before changing declarations. Metadata edits use existing history/persistence. The same status reaches Viewer, Schedule, HTML and PDF report data; invalid documented links are retained but not treated as operational paths.

No saved-project migration or automatic replacement of previously placed project instances. Fresh factory instances use the new definitions. Existing `.avd` and `.wnx` definitions retain their own saved types and metadata. Older app versions cannot validate the new metadata; use the updated app for verified status.

## Verification

- Complete clean-source automated run: **2,551 passed, 0 failed, 0 skipped** (`node --test --test-concurrency=8 test/*.test.mjs`). Nine new focused tests cover definitions/colours, exact factory changes, compatibility, persistence, modular safety, output statuses and `.wnx`.
- Baseline comparison against `0a062346`: **56,169 identical ordinary/historical type-and-direction verdicts**, covering all 79 existing node types in both endpoint orders and input/output/bidirectional combinations.
- `scripts/misc-connectors-browser-smoke.mjs`: all nine palette entries; real mouse cable creation; rejected declared protocol conflict without mutation; Canvas Inspector metadata edits and Undo/Redo; cable Undo/Redo; `.avd` reopen; offline HTML; editable terminal pole count with invalid-value rejection and Discard; LINK Card Inspector metadata. No browser errors.
- `scripts/factory-library-import-smoke.mjs` with this review fixture: all 16 updated devices searchable (including the existing TX/RX pair row), full-resolution artwork decodes, real library drags, all 16 devices in offline HTML, exact card/connector save/reopen. Its paired-row selector now recognizes the existing paired-device UI rather than incorrectly requiring a separate RX row.
- Existing `scripts/sfp-audit-pass-a-browser-smoke.mjs`: malformed import recovery, legacy occupancy, optical identity rejection and real DAC replug/Undo/Redo/reopen passed.
- Existing `scripts/engine-pdf-browser-smoke.mjs`: real options dialog and download passed, including failure recovery; 35,657-byte PDF, no browser errors.
- Factory catalogue/provenance, Engine compatibility, rewiring, output pipeline, Viewer bundle, Cable Schedule bundle, PDF bundle and community-validator checks pass. Generated Viewer/report/community bundles are reproducible; PDF bundle itself is unchanged.
- Catalogue remains **156 devices, 333 original byte-checked assets**; nine physical families add nine node definitions. Protected originals, Masters, backups and unrelated work are excluded from the commit. No hosted accounts or services were used.

Limitations are deliberate: 27 uncertain records remain Misc; pinout maps, terminal pitches/part numbers and proprietary electrical specifications are not inferred. The new checks validate declarations, not the real-world correctness of an undocumented cable wiring scheme. No legacy project instance is silently upgraded.
