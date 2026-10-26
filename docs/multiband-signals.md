# Multiband Signals

## Architecture

Powerlock previously divided a wire along its length. The shared renderer now
draws adjacent equal-width bands over the existing sampled route, using shared
corner boundaries and bounded miter joins. Circular nodes use clipped vertical
bands. Selection redraws the bands over the existing halo. Routing, hit testing,
connector identities and the one-node/one-wire model are unchanged.

`src/engine/multibandSignals.js` owns the ordered profiles and grouped-coax
metadata. `src/engine/multibandGeometry.js` owns reusable wire and circle meshes.
The GPU canvas, output viewer and SVG/PDF paths consume the same geometry.
Adapter thumbnails and schedule graphics use the same vertical-node convention.

## Signal Definitions

- Existing `powerlock`: unchanged identity, compatibility and five colours in
  their original order: #03E300, #2A7FFF, #A05A2C, #4A4A4A, #999999.
  No electrical or conductor semantics have been redefined.
- `component-video`: Y/Pb/Pr, green/blue/red; three separate 75-ohm coaxial
  circuits. BNC or RCA grouped termination, default BNC.
- `rgbhv`: R/G/B/H/V, red/green/blue/yellow/white; five separate 75-ohm coaxial
  circuits. BNC grouped termination.

The optional connector field `coaxConnectorFamily` preserves physical termination
without changing signal identity. Existing definitions need no migration. Strict
signal compatibility remains authoritative; a shared physical family does not
make Component Video, RGBHV, SDI, VGA or ordinary BNC signals interchangeable.

Device Editor, Card Editor and canvas inspector reuse existing atomic connector
editing. Scene normalization preserves the optional family. Scoped node aliases
resolve through existing compatibility metadata without rewriting saved IDs.
Cable schedules retain one logical row, explicitly identify grouped terminations
and list every required coax circuit in Notes and structured `physicalCircuits`.
No loom or multi-core is assigned automatically. Powerlock reports are unchanged.

## Files and Validation

Shared geometry/profile files are integrated through `renderer`,
`connectorCompatibility`, `projectAdapter`, `sceneGraph`, `projectMutations`,
`productionBridge`, `adapterThumbnail`, `outputViewerApp`, the four
`cableSchedule*` modules, `factoryCatalogueBootstrap` and Engine shell controls
in `index.html`. The factory catalogue adds only the two new node definitions
and their review receipt. Generated export bundles and build-fingerprint
validators are refreshed; existing devices and artwork are unchanged.

Focused regressions: `test/multibandSignals.test.mjs` (25 cases), existing
temporary-wire rendering and catalogue bootstrap tests. Examples are in
`fixtures/multiband-signals.mjs`. Run `node --test test/*.test.mjs` and all
`scripts/*validation.mjs` validators.

`node scripts/multiband-signals-smoke.mjs` exercises actual Chrome WebGL pixels
with selected/unselected bands, straight and multi-corner routes, device movement,
reconnection, undo/redo, Device/Card editing, save/reopen, offline HTML in both
themes, SVG image, production PDF and XLSX. It prints the temporary evidence
directory. Override `AVDESIGNER_BASE_URL` for an isolated validation server.

## Limitations

Each conductor band is half a normal cable's width. Component Video therefore
uses 1.5 times normal width; RGBHV and Powerlock use 2.5 times normal width.
Preview, selection/hover halos, print meshes and schedule graphics follow this
rule without changing ordinary cables or node sizes. At distant zoom levels
bands can become subpixel; zooming in reveals the complete ordered profile.
There is no implicit analog format conversion or automatic cable assembly.
