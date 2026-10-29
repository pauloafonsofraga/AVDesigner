# WireNexus connector geometry audit — 29 SVG studies

Source: `Nodes/PowerPlugs/` in `engine-prototype`.
Output: `design/connector-audit/svg/` on this branch.

## What was actually changed

All 29 source SVG files were fetched from the repository and copied to this review-only folder. Their original `viewBox`, shape paths, circles, transforms, contact coordinates and mechanical silhouettes were retained. A small common SVG gradient definition and subtle contact-fill treatment were added to study a more consistent visual finish. **No active app assets were replaced.** These are editable vector drawings, not AI-generated raster traces.

## Technical verification status

| Family | Files | SVG structure checked | Manufacturer/model verification |
|---|---:|---|---|
| IEC 60309 blue 16A/32A 1ph (male/female) | 4 | Three visible contact shapes per asset (2P+E), source geometry retained | Standard family and color match; actual clock/key position not certified |
| IEC 60309 red 16A/32A/63A/125A 3ph (male/female) | 8 | Five contact shapes per asset (3P+N+E), source geometry retained | Standard family and color match; actual clock/key position not certified |
| IEC 60309 yellow 16A/32A 110V 1ph (male/female) | 4 | Three visible contact shapes per asset, source geometry retained | Standard family and color match; actual clock/key position not certified |
| Socapex male/female | 2 | 19 contact locations (38 contact circles + four body rings in source), unchanged | Pin arrangement and insert/keying need comparison with a specific 19-pin manufacturer drawing |
| powerCON Blue/White | 2 | Original geometry preserved | Exact panel variants and keying still require part numbers |
| powerCON TRUE1 male/female | 2 | Original geometry preserved | Exact generation and panel series not identified; user's photo is a combined Seetronic inlet/outlet panel, not two interchangeable single Neutrik sockets |
| Harting male/female | 2 | Original rectangular aspect and 72 source circle elements retained | Exact Han insert family, contact numbering and housing variant unresolved |
| Powerlock source/drain | 2 | Original five-position group and colors preserved | Phase order, source/drain contact safety and mating specifications not independently verified |
| Schuko | 1 | Original socket outline preserved | Type F feature family identified; exact commercial model unknown |
| 13A UK | 1 | Original Type G holes and positions preserved | UK Type G feature family identified; exact commercial model unknown |
| NEMA | 1 | Original outline preserved | **Unknown precise NEMA configuration**; not acceptable for a model-specific wiring library until subtype is specified |

**Important:** Matching a contact count or electrical family does not certify dimensional accuracy or electrical interchangeability. For any geometry-critical requirement, confirm the precise model's manufacturer's drawing. Do not derive mating compatibility from these thumbnail images.

## Reference starting points

- Neutrik powerCON TRUE1 TOP product guide: https://www.neutrik.com/media/10093/download/Neutrik%20Product%20Guide%20-%2006%20powerCON%20and%20Circular%20Connectors%20PG%20EN%20202210-V25.pdf?v=10
- Neutrik NAC3PX-TOP combination panel: https://www.neutrik.com/en/product/nac3px-top
- Neutrik TRUE1 mating scenarios: https://www.neutrik.com/en/product/powercon-true1-power-cord.pdf

## Scope limit: full WireNexus library

Only the 29 dedicated SVG files identified in `Nodes/PowerPlugs/` were included. Other app plug thumbnails (such as HDMI, BNC, RJ45 or XLR) may be drawn dynamically, in data records, or loaded from other assets; they were **not** enumerated through the repository's indexed search, so this does **not** prove the whole app connector catalogue is covered.

## Release decision

**Review only: NOT technically certified for production.** Precise model identification is still missing for TRUE1, Harting, NEMA, Powerlock and other variants; the connector library needs a model-by-model reference pass before a universal “accurate” claim can be made.
