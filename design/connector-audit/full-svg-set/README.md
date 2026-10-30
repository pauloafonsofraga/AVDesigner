# WireNexus connector SVG review set — corrected thumbnail pass

Exactly **78 standalone SVGs**, one per connector type in the inventory. This pass edits the existing set from commit `2b85236`; it does not start a replacement library. Changes remain entirely inside this review folder. Production artwork, catalogue data, application rendering and runtime behavior are unchanged.

## Review at actual display sizes

The cable-schedule renderer fits artwork into a 32 × 32 box with an aspect-preserving scale (`src/engine/cableScheduleGraphics.js`). This set now uses square 256 × 256 transparent canvases. Every visible drawing is fitted with **one uniform scale** and at least 16 units of transparent padding. No connector is widened or made taller to fill the canvas. Source reflections are retained; reflections do not change proportions.

- [32 px contact sheet](contact-sheet.png): all 78 SVGs directly rasterized at **32 × 32 pixels**, pasted at 1:1.
- [64 px contact sheet](contact-sheet-64px.png): all 78 at **64 × 64 pixels**, pasted at 1:1.
- [128 px contact sheet](contact-sheet-128px.png): all 78 at **128 × 128 pixels**, pasted at 1:1.
- [32 px on light and dark backgrounds](contact-sheet-32px-backgrounds.png).
- [Original / previous 32 px / corrected 32, 64, 128 px comparisons](comparisons/page-01.png): six pages, 13 types per page. Continue with [2](comparisons/page-02.png), [3](comparisons/page-03.png), [4](comparisons/page-04.png), [5](comparisons/page-05.png), [6](comparisons/page-06.png). Every original WireNexus thumbnail and every corrected SVG was visually inspected.
- [Preserved alternative forms at 64 px](gender-variants-64px.png): inventoried male/female and source/drain alternatives.

View PNGs at **100% zoom** to judge the stated pixel sizes. A browser or document viewer may resize an entire contact sheet to fit its window; that does not change the stored pixel dimensions. Names and statuses are outside each rendered icon. Large gallery captions no longer shrink the hardware inside its SVG. Existing source artwork markings such as IEC current ratings are retained.

For types formerly showing two alternative connectors side by side, the default thumbnail now shows one primary form matching the original family: female IEC/Harting, male Socapex, blue-input powerCON, or PowerLock source. The alternative is preserved as a named `<symbol>` **inside the same SVG**, with its identity recorded in `index.json`. It is rendered separately on the alternative-form sheet. TRUE1 still shows both apertures because those belong to one real combined panel, not alternative genders of a single socket.

## What changed, and what was preserved

**26 connector types received targeted geometry corrections; 52 retain their existing geometry with improved framing/materials.** The metallic/polymer/gold visual language remains. BNC/SDI, RCA, XLR 3, MIDI, VGA, USB-A/C and established source-study outlines were not unnecessarily redrawn. All 29 original study sources remain recorded; 28 retain their primitive geometry, transforms and contact coordinates. NEMA's inaccurate square face was deliberately replaced with the rounded face seen in the original thumbnail.

| Family | Correction / verification boundary |
| --- | --- |
| CA-COM | Restored square mounting/circular shell proportions and source-observed nine contact locations; removed the invented radial array. The generic name is not evidence for the common eight-pin speaker insert. ITT's catalogue contains many arrangements. Exact source model, gender and keys remain unresolved. |
| DOMM | Replaced the invented 1+6+12 concentric arrays with approximate unprojection of the 19 locations observed in the original perspective image. The name did not identify a manufacturer. This is source evidence, **not** a verified pinout. |
| CXP | Corrected cage mouth and top/bottom EMI spring treatment; removed a false visible tongue. TE's 2149152-1 reference establishes 84 internal positions. Those recessed contacts are not fabricated at the front opening or confused with spring fingers. Exact catalogue SKU unassigned. |
| FiberFox | Replaced the invented shutter/wide plate with a D-flange, red collar, opposed alignment jaws and **four optical lenses**, using NO4M4DW-FX EBC15 4CH briDge photograph and front drawing. The reference is hermaphroditic, not a male/female electrical pin connector. Jaw detail remains illustrative. |
| TRUE1 | Corrected flange ratio to 61:35.4, unequal 23.6/28.4 collar diameters, 28 center spacing and four mounting positions using the NAC3PX-TOP drawing. Removed the invented top latch bar. Preserved source insert forms; exact blade/key profiles are still unverified. Source thumbnail has opposite left/right order and may be a different manufacturer. |
| Harting | Preserved the true 111:27 proportions of the reviewed male/female 64-contact studies. **Source conflict remains:** Harting.png depicts another unidentified insert. A real Han D64 family reference supports the retained example, but does not establish a match to the original thumbnail. |
| HDMI / DP / mini-DP | Corrected overly tall HDMI/DP apertures, corrected the taller rectangular mini-DP mouth, and removed the nonuniform mini-DP transform. Opposing rows have 10+9 or 10+10 contacts. MiniDisplayPort.png appears inconsistent with the chosen modern mini-DP receptacle and remains review-needed. |
| DVI / USB-B | Restored wide DVI proportions, analog blade cluster on the source's left and 24 digital positions on the right; retained DVI-I dual-link as an example. Corrected USB-B to a near-square shoulder profile and four contacts. |
| XLR 5 / DMX 5 | Corrected five-contact topology to the source/manufacturer U pattern; removed the false top-center contact. Three-pin variants retain their geometry. |
| mini-DIN 6 | Corrected upper/middle/lower contact pair spacing and upper-center rectangular key using E-tec's readable six-position front drawing. The generic entry does not select green mouse or purple keyboard signaling. |
| speakON | Removed invented XLR-like drilled holes. Restored protected annular twist-lock face and keyed bore using NL2MP/NL4MP/NL8MPR photographs. Internal **2/4/8** contact counts are recorded, but not shown as a guessed frontal pinout. NL8 uses a larger square four-hole flange. |
| etherCON / opticalCON / MPO / LC / SC | Corrected fictional wide flange proportions; retained known inserts/shutters. Added source-consistent optical alignment-sleeve detail to LC/SC. MPO does not invent a ferrule pin gender or fiber count. |
| IEC | C13.png visibly shows exposed blades: corrected the artwork to a **male C14 inlet**, checked against Schurter's inlet reference. Filename is not physical-gender evidence. |
| Jack / TRS-TS / NEMA | Restored jack hex mounting nut. Corrected NEMA's square perimeter to a rounded polarized single-face example; generic NEMA subtype remains unassigned. |
| PowerLock | Retained source/drain geometry and five color positions, but corrected false yellow/red metal-like centers to schematic insulating safety caps using ITT's description. Exact cap profile, part and phase keying remain unresolved. |
| IEC 60309 studies | Original contact coordinates, male/female forms and 3/5 contacts retained; restrained plastic colors and recess material rims improve their finish. Blue/yellow/red family coding is preserved. Clock/key variants remain unassigned. |

**Socapex still has 19 contact locations in each gender**, verified structurally. Each location has a rim and center circle, not two independent contacts. UK 13A retains recessed Type G slots without exposed copper. BNC remains a true concentric frontal view with two opposed bayonet lugs. YPbPr and RGBHV retain three/five BNCs and their channel colors. Aliases have separate files and shared underlying geometry where appropriate.

## Verification statuses and remaining review

`index.json` contains per-type `source_urls`, `checked_aspects`, `remaining_issues`, `review_action`, `thumbnail_status`, `thumbnail_assessment`, framing measurements and source-thumbnail path, in addition to the requested mapping fields. Structured interface counts distinguish source-observed positions, manufacturer-reference counts, optical channels and hidden contacts.

| Status | Count | Meaning |
| --- | ---: | --- |
| `model-reference-checked` | 1 | The selected FiberFox reference photo and drawing were inspected and identifiable features compared. This does not certify the inventory's unspecified part or dimensional manufacturing accuracy. |
| `family-reference-checked` | 43 | A relevant manufacturer family reference supports the stated count/form/material features. Exact inventory SKU, tolerances or key variant may remain open; see per-item issues. |
| `source-observed` | 15 | Original repository artwork compared and geometry preserved or corrected from visible evidence; no sufficient manufacturer model match established. |
| `review-needed` | 6 | Material source/model conflict or unresolved specialized identity: **CA-COM, DOMM, Harting, mini-DisplayPort, NEMA, PowerLock**. |
| `abstract-configuration` | 13 | Deliberately abstract entry/cage, with no invented physical insert or contacts. |

The abstract entries are `edison`, `led-signal`, `misc`, `new-node-2` (DAC), `new-node-3` (RS-232), `new-node-4` (Mini-SDI), `new-node-5` (ADAT-S/PDIF), `qsfp`, `rs-422`, and the four SFP/QSFP cage types. RS-422's use of the VGA thumbnail does not establish a DB connector pinout. Blank/generic configuration sources do not establish physical hardware.

**Thumbnail readability and technical verification are separate.** Family silhouettes and key broad features were assessed at 32 px; small contact details were compared at 64/128 px. Dense Harting/Socapex contacts and grouped PowerLock/RGBHV cannot be reliably counted at 32 px. No pin-count detail is enlarged by distorting the physical envelope. Shared configuration glyphs and empty cages are intentionally abstract, not uniquely recognizable hardware models. `thumbnail_status` records `family-readable`, `detail-limited`, `review-needed` or `abstract-only`; unresolved items are not production-approved merely because rendering checks pass.

Manufacturer URLs, product photographs and drawings are recorded **per connector** in `index.json`; unidentified entries still link to their exact original repository image. No blanket technical-certification claim is made.

## Reproduce and validate

```sh
# In a Python environment with CairoSVG and Pillow installed:
python design/connector-audit/full-svg-set/generate.py
python design/connector-audit/full-svg-set/render_review.py
python design/connector-audit/full-svg-set/validate.py
```

`generate.py` retains the previous set's source builders and applies targeted repairs from `review_corrections.py`; `framing.py` measures actual alpha bounds at 4× and applies only one uniform scale. `review-metadata.json` stores the researched evidence and review decisions. The pinned source studies come from `design/connector-geometry-preserving-audit` at `31a93c09004a1146857db02d1389181fc1f2e7d5` (fetch this branch if absent in a fresh clone). Before/after comparison rendering reads the previous review commit `2b85236`.

Validation checks inventory/output bijection; mapping fields, URLs and status semantics; standalone XML and accessible descriptions; unique IDs/resolved paint references; no embedded rasters, scripts or external dependencies; square canvases and uniform scale/reflections; retained source geometry; Socapex 19 positions per form; constructed contact counts; hidden-contact policy; four FiberFox optical channels; alias consistency; **234 direct size renders with transparent margins and no clipping**; and SHA-256 correspondence between current SVGs and saved visual-check records. All six comparison pages and both-background thumbnails were visually inspected. Regeneration is deterministic. Runtime tests are not applicable because only review files changed.
