# Full 78 connector SVG review set

78 standalone, editable SVG files: exactly one per `type` in `connector-inventory.json` on `engine-prototype` at `7dfad0290ae62b2cd5bfc602de1fd860dc5f98a3`. This is a **review-only** library. No production artwork, catalogue, rendering code, or runtime references have been changed.

Open [contact-sheet.png](contact-sheet.png) to compare the full set. Each SVG uses a transparent 256 × 192 viewport with a readable family caption, front-facing geometry, restrained polymer/metal shading and gold contact material where appropriate. Paired gender studies share one file; wide Harting and PowerLock groups are stacked to preserve readable detail. All SVGs contain vector shapes, no raster images, external dependencies, scripts, or embedded fonts.

## Provenance and regeneration

The 29 studies requested as the visual baseline are on `design/connector-geometry-preserving-audit` at commit `31a93c09004a1146857db02d1389181fc1f2e7d5`; they were not present on the base `engine-prototype` branch. This set incorporates all 29 studies, retaining their paths, contact coordinates, transforms, outlines and native aspect ratios. Changes to those shapes are confined to material fill gradients, document placement and editor metadata cleanup. Their original files are not modified or copied into production.

Other families were rebuilt as frontal vector interpretations of the existing `Nodes/Thumbnails/` artwork, rather than tracing its perspective or embedding raster images. Their geometry is a review interpretation, not a dimensional manufacturer drawing. Abstract symbols are used where the catalogue does not establish a unique physical implementation. `index.json` records each file's actual basis, selected physical example and outstanding questions.

Run from the repository root:

```sh
python3 design/connector-audit/full-svg-set/generate.py
python3 design/connector-audit/full-svg-set/validate.py
```

The generator uses the Python standard library and reads the pinned study commit from Git. In a fresh clone that lacks this commit, fetch `design/connector-geometry-preserving-audit` first. The inventory is read from the repository, not from a separate local copy. `contact-sheet.png` is a visual review snapshot; generation of the SVGs does not require Pillow or CairoSVG.

## Requested corrections

- **Socapex:** both source genders retain exactly 19 contact locations each. Each location uses two concentric circles; those rims and centers are not 38 separate contacts. Validation checks both 19-location sets.
- **TRUE1:** a frontal combined inlet/outlet panel, including flange, mounting holes, latch bar, asymmetric keyed inserts and distinct protected/exposed contact forms. The source filenames invert the visible forms: `powerCON_True1_Female.svg` contains exposed blades and is used for the physical male inlet; `powerCON_True1_Male.svg` contains the protected concentric socket and is used for the physical female outlet. This naming conflict was reconciled against the [Neutrik product photo](https://www.neutrik.com/uploads/media/400x/04/12844-NAC3PX-TOP.jpg?v=1-0) and [NAC3PX-TOP reference drawing](https://www.neutrik.com/media/12881/download/st-nac3px-top.PDF?v=1). The [manufacturer page](https://www.neutrik.com/en/product/nac3px-top) establishes the combined panel family. The inventory thumbnail may represent a Seetronic equivalent; exact commercial model, panel proportions, aperture/latch shapes and keying remain unverified. This is not a certified NAC3PX drawing.
- **UK 13A:** original Type G socket-slot geometry retained, with dark recessed slots and no added exposed copper.
- **BNC:** concentric, true frontal socket with opposed bayonet lugs, recessed center and dielectric; no side barrel or perspective ellipse. SDI reuses this family. Component video and RGBHV use three and five separate BNCs with channel colors.

## Aliases, genders and colors

Every alias has its own SVG: CEE current variants share their established IEC family; Cat5e/Cat6/Cat6a/Ethernet use the same eight-position RJ45; USB/USB-A, RCA/phono, jack/TRS-TS, XLR/XLR-3, speakON/NL4 and SDI/BNC share the appropriate geometry. NL2/NL4/NL8 retain distinct 2/4/8 contact counts. XLR/DMX use 3/5 contacts as named. AES follows the male XLR source example, without treating signal direction as gender.

IEC 60309 uses blue 1ph, yellow 110V, red 3ph; powerCON retains blue/white and PowerLock retains its source phase-color group. YPbPr is green/blue/red; RGBHV is red/green/blue/white/gray. Fiber blue follows the source adapter finish; it does not prescribe all fiber modes or polish variants. No new runtime compatibility or gender policy is implied.

## Technical review queue

**All 78 entries are `review-needed`.** No entry has complete manufacturer/model verification; retaining source geometry is not model verification. The notes in `index.json` are the per-item review queue.

| Family/entries | Review still required |
| --- | --- |
| IEC/CEE, Schuko, UK, NEMA | Exact housing and clock/key; NEMA subtype is unspecified. |
| Socapex, Harting, PowerLock, powerCON | Model, insert arrangement/numbering and mating keying; PowerLock phase order and source/drain safety detail. |
| TRUE1 | Commercial panel identity, keyed aperture/latch dimensions and source gender-filename conflict described above. |
| CA-COM, DOMM | 9 and 19 visible source-thumbnail contact locations respectively; frontal arrangement regularized from perspective. Confirm precise insert layout, gender and key clocking. |
| XLR, MIDI, mini-DIN, speakON | Manufacturer insert layout, contact forms, keying and actual physical gender variant. |
| USB, HDMI, DP, Mini-DP, DVI, VGA, RJ45 | Aperture and tongue shape, pitch and generation. DVI depicts the source's DVI-I dual-link example; catalogue variant unspecified. |
| CXP | Source-derived shielded module opening; internal contact configuration unresolved and left recessed. |
| LC, SC, ST, MPO, opticalCON, FiberFox | Exact optical family, simplex/duplex or lens/fiber count, polish, keying and gender. OpticalCON/FiberFox use abstract closed inserts; MPO does not invent a fiber count. |
| RCA, TRS/TS, IEC, barrel jack | Exact commercial size/model and internal switching or polarity. Barrel jack remains a generic center-pin example. |
| BNC/SDI and grouped coax | Model dimensions, impedance/series and precise bayonet dimensions. |

Deliberately abstract, labeled configuration entries: `edison`, `led-signal`, `misc`, `new-node-2` (DAC), `new-node-3` (RS-232), `new-node-4` (Mini-SDI), `new-node-5` (ADAT-S/PDIF), `qsfp`, `rs-422`. Their names alone do not establish a model or physical port; blank/generic source thumbnails are not evidence for a pinout. Mini-SDI connector series and the optical/coax choice for ADAT-S/PDIF must be specified before replacing their abstract symbols.

Deliberately abstract empty cages: `qsfp-cage`, `sfp-cage`, `sfp-plus-cage`, `sfp28-cage`. They depict an opening, not an installed transceiver, fiber connector, invented pins or a mechanical cage drawing. Their shared geometry is intentional.

## Validation performed

Inventory/output bijection (78), required mapping fields and review statuses; standalone XML parsing; unique SVG IDs and resolved internal paint references; absence of raster/external resources and scripts; source mechanical-geometry retention; Socapex 19 positions per gender; explicitly constructed contact counts; and successful raster rendering of all 78 files. The complete rendered contact sheet was visually inspected, including the four requested correction families. No runtime tests are needed because this branch changes only this review directory.
