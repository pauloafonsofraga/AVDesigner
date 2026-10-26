# Adaptive Shared-Bus Captions

Shared-bus connector captions use measured horizontal space: unique full connector
types, standard abbreviations (for example Display Port becomes DP), then a type
count. Captions never wrap or change their vertical baseline. If even a type count
cannot fit, the caption is omitted rather than painted over fields or boundaries.

The resolver considers device/card boundaries, opposing buses, other captions,
connector targets and neighboring field outlines. It can use an available
horizontal gap, with the existing annotation leader retaining the association.
Full member details remain available on hover and in the canvas, Device/Card
Editor and Output Viewer Inspectors. Installed SFP module types remain visible in
those details.

This is transient rendering only. No node positions, card slots, relationships,
names, endpoint IDs, artwork or persistence schemas are modified. The Engine
renderer is shared by canvas, editor previews and SVG/PDF/HTML output; the Card
Editor SVG surface reuses the same adaptive-caption resolver.

Regression coverage: `test/sharedBusAdaptiveLabels.test.mjs`, existing connector
label/overlay suites, and `scripts/shared-bus-adaptive-labels-smoke.mjs` (Chrome,
six canvas zooms, three Card Editor zooms, native hover, Inspector, offline HTML
and production PDF download).
