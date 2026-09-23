# Engine Output Scene Contract

Stage 1 (54.30.0) attaches `engineScene` to `buildCanonicalOutputSnapshot()`.
It does not change drawing ownership, saved project data, or live rendering.

## Version 1

`buildEngineOutputScene(projectSnapshot)` clones plain project data, normalizes it
through `normalizeAvDesignerProject`, and builds a detached `SceneGraph`. It
returns deeply frozen JSON-compatible data with no runtime indexes or references.
An empty document stays empty instead of exporting the adapter's demo graph.

- `devices`: all normalized Engine objects, including jumps, LED surfaces, areas,
  comments, title blocks and images. `kind` discriminates them. `visual` includes
  card bands, image sources, Power Distro geometry and adapter metadata;
  `matrixRoutes`, connector relationships and full connector metadata are retained.
- `connectors`: owner/connector IDs, stable normalized index, primary world point,
  resolved display anchors and rack visibility/selectability. Local anchors remain
  in `devices[].connectors`; resolved world coordinates are explicit here.
- `wires`: normalized endpoint IDs, anchor IDs, port indexes, original route points,
  resolved endpoints, route points, sampled polylines and hop-adjusted polylines.
- `racks` and `rackExposure`: resolved children, exposure and internal wire ownership.
- `jumpLinks`: normalized relationships and Engine Bezier geometry.
- `ledSurfaces`: authoritative ordered wire IDs; geometry/images live in `devices`.
- `cards`: normalized local card geometry with owner device IDs.
- `sharedBuses`: members, world-space trunks/branches/stems and field junctions,
  derived with the same display-layout and rendering geometry helpers as Engine.
- `sceneBounds`: exact `SceneGraph.bounds()` result (body-only, including its empty
  default). `bounds`: union of Engine bodies, racks, connector anchors, routed wires,
  cable hops and jump curves; null when empty. No SVG measurement or camera state.
  These are geometric bounds, not font-measured text, stroke or glow extents.
- `diagnostics`: counts, adapter/rack information, rejected wire warnings and hop
  statistics, excluding nondeterministic timings.
- `signature`: versioned FNV-1a 64-bit fingerprint of sorted-key JSON. Array order
  remains significant. This is a parity fingerprint, not a security hash.

The scene itself has no timestamp. The containing output snapshot retains its
existing timestamp, mutable report/asset diagnostics and project-data copy. Asset
inlining on that copy cannot mutate the Engine scene; image references are captured
at scene creation, not fetched or embedded by the builder.

## Drawing Ownership

Metadata separates `projectDataSource: canonical-project-snapshot`,
`sceneDataSource: engine-project-adapter/scene-graph`, and `drawingDependency`.
Since Stage 3, HTML/Publish use `engine-webgl`; since Stage 4, PDF uses `engine-svg`.
Outer `snapshot.bounds` now uses Engine geometry for both paths. See
`engine-html-outputs.md` and `engine-pdf-output.md` for backend ownership.

The classic shell preloads the Engine module; output actions await readiness.
Direct synchronous callers of `buildCanonicalOutputSnapshot()` must first await
`ensureEngineOutputSceneModule()`. Report windows open before awaiting so browser
popup activation is preserved.

## Parity Coverage

`fixtures/output-parity.mjs` covers ordinary devices, repeated V2 cards and overrides,
two shared buses, breakout, Power Distro, matrix routes, main/backup LED processors
with repeated local indexes and PNG wall, jumps/link, exposed/internal rack ports,
Bezier/orthogonal wires with actual crossings/hops, area, comment, title and image.
Node tests compare against a separately normalized SceneGraph. The browser smoke
compares with the actual production bridge in Engine mode, checks Legacy mode, and
asserts unchanged saved data and the historical standalone HTML reference, plus
deterministic Engine print SVG. Actual PDF generation is covered separately by
`engine-output-pdf-smoke.mjs`; no physical printer is exercised.
The existing shell `restoreSnapshot()` omits `imageObjects`, so the restored
canvas has 16 objects. The smoke also supplies the complete canonical fixture
directly and compares all 17 objects (including the image) with Node output.
This stage deliberately does not modify that pre-existing save/restore limitation.

Run `node --test test/outputSceneSnapshot.test.mjs` and, with a local HTTP server,
`node scripts/output-scene-smoke.mjs`. The smoke accepts `AVDESIGNER_BASE_URL`,
`AVDESIGNER_PLAYWRIGHT_PATH`, `AVDESIGNER_CHROME_PATH`, and
`AVDESIGNER_SCREENSHOT_DIR` like the existing browser checks.
