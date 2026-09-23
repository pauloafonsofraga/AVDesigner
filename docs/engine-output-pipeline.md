# Unified Engine Output Pipeline

Build 54.34.0 completes output renderer cleanup on engine-prototype.
The supported `?legacy=1` application canvas remains unchanged.

## Ownership

`buildCanonicalOutputSnapshot()` supplies report/project data and one immutable
Engine output scene. The project adapter and SceneGraph resolve geometry once.

| Output | Entry point | Drawing owner |
| --- | --- | --- |
| Offline HTML | exportHtml -> prepareEngineViewerOutput | Bundled EngineOutputViewer / WebGL |
| Publish | publishHostedProject -> prepareEngineViewerOutput | Identical bundle and scene inside authenticated iframe |
| PDF | exportPdfReport -> buildEnginePrintDrawing | Engine-to-SVG vector serializer |

Reports, private upload/password handling, saved projects and editing commands
retain their existing behavior. The output bundle excludes projectAdapter,
ProductionBridge and mutation history. It needs no runtime network or CDN.
Image assets are embedded; missing assets fail explicitly. No Legacy fallback.

The shared `outputSceneContract.js` owns version, shape descriptor and schema
fingerprint. Both backends validate it. This is a versioned compatibility marker,
not a security hash or exhaustive deep JSON-schema validator. Nested geometry
semantics are covered by parity tests. Scene signatures include that marker.
Diagnostics expose projectDataSource, sceneDataSource, drawingDependency,
sceneVersion, sceneSchemaFingerprint and sceneSignature. HTML/Publish also expose
the SHA-256 bundleHash in payload metadata and engineOutputReady. The app's
debugOutput panel shows scene/schema/bundle identities; PDF SVG metadata carries
its scene/schema identity. PDF does not consume the WebGL bundle.

## Removed

- Retired buildStandaloneHtml implementation, standalone styles, duplicated
  device/card/PD/matrix/LED/jump/wire routing and hop helpers.
- Unused SVG export bounds, print styles, clone repair, missing-wire reconstruction,
  power-plug embedding/conversion helpers and their asset-payload builder.
- Hosted SVG stylesheet injection/repair. The password page now inserts returned
  HTML unchanged. Historical self-contained files can still run, but previously
  malformed hosted SVG files relying on injected styles need republishing.
- Stringified shared-bus/relationship helper exports used only by the old viewer.
- Tests asserting copied helper source, replaced by actual canonical output
  model/geometry tests. Existing specialized browser checks now open Engine HTML.

The PDF clone entry point was already removed in Stage 4. No legacyOutput query
fallback was retained in Stage 3. The remaining canvas.cloneNode call belongs
only to the Legacy application's navigation snapshot, not any output.
Guardrails explicitly retain that exception and reject cloning in output paths.
Renderer and ProductionBridge fingerprints are unchanged in this cleanup.

## Guardrails and Tests

`scripts/output-pipeline-validation.mjs` rejects retired renderer/dependency
markers, output canvas cloning, duplicated wire/card geometry implementations,
editor code in the viewer bundle, and mismatched output entry-point ownership.
It parses the classic inline scripts too. Bundle validation builds twice and
compares byte-for-byte with the committed artifact.

`test/outputPipeline.test.mjs` exercises representative and 100/300 fixtures
through both HTML variants and vector SVG: schema/signature/counts/bounds,
connectors, routes, cards, buses, rack exposure and input immutability. Incompatible
schema versions fail loudly in both backends. Other output tests cover matrix
meshes, cable hops, LED ordering, PD artwork, jump links and exact SVG primitives.

## Acceptance Matrix

Desktop Chrome, local server, 2026-09-23. No production hosted project is created:
the real Publish function/private upload contract and password page run against
simulated storage/API responses, including wrong-password rejection.

| Consumer | Representative | Large projects |
| --- | --- | --- |
| Live Engine app | SceneGraph and wire/matrix GPU parity | 100 devices/300 wires; 400/1200 |
| Legacy application | Canvas intact; same canonical export signature | Both large fixtures render/export |
| Offline HTML | Real download, network disabled, interactions, dark/light | 100/300 and 400/1200 |
| Hosted viewer | Same implementation/schema/signature; password unlock | Both large payloads unlock/render |
| Vector PDF | Real Engine/Legacy export and full canonical fixture | 100/300, eleven-page report |

Representative coverage includes ordinary devices, repeated installed cards,
shared buses including card buses, breakout, PD, matrix, main/backup processors,
LED PNG with repeated signal indexes, jump link, exposed/internal rack wires,
Bezier/orthogonal routes, cable hops, area/comment/title block/image object.
The full canonical scene contains 17 objects, 59 connectors, 20 wires and 4 cards.
HTML and PDF keep identical signatures for identical snapshots.

Five actual PDFs passed structural inspection. Representative drawings contain
33,148 vector path operators; the large drawing contains 401,163. Report checks
cover all 100 device rows and 300 distinct cable rows exactly once. Pages are
rasterized with Poppler for visual inspection; there is no screenshot PDF backend.

Final checks: 724 Node tests passed, 0 failed/skipped; all 13 validation scripts
passed, including reproducible bundle and inline syntax. All 37 changed/new JS
modules/scripts parsed. Eleven browser suites passed: output scene, output
HTML/Publish, output PDF, read-only viewer, LED ordering, relationship metadata,
shared-bus rendering, bidirectional jumps, editor shared buses, editor integration,
and native node drops. The last includes 68 native drops and all 42 PD mappings
in both app modes. No required case was skipped. All thirteen inspected PDF
pages (two representative and eleven large) have intact content and pagination.
Git diff whitespace checks passed.

## Performance

Historical measurements are data in `fixtures/legacy-output-performance.json`,
recorded at 9ad6c74 before deleting the SVG renderer. They are not rerun by loading
retired code. Same 1600x1000 headless Chrome harness, 24 warm pan/zoom updates;
CPU update/draw submission, not GPU completion. Timing varies with host load.

| Fixture | Normalize ms | Initial render ms | Assets ready ms | Camera mean/P95 ms | Recorded SVG mean ms | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Representative | 9.3 | 99.8 | 199.7 | 2.25 / 2.8 | n/a | n/a |
| 100/300 | 28.8 | 170.1 | 222.3 | 11.59 / 16.5 | 81.78 | 7.1x |
| 400/1200 | 109.0 | 821.9 | 1053.5 | 42.38 / 50.1 | 350.70 | 8.3x |

Fit: 0.2-1.1ms. Seven GPU buffers; 20/100/400 device textures. Camera updates
rebuild no scenes or textures. HTML sizes: 1.37/3.56/13.86 MB.
Old SVG load/initial-render timings were not recorded, so only camera timings
have a historical comparison. No load-speedup claim is made.

The available private real project also passed read-only viewer acceptance:
142 objects, 1,302 connectors, 267 wires, 129 textures, zero image failures;
74.2ms normalization, 213.1ms initial render, 602.9ms assets ready, 26.7ms mean
camera submission. It was not uploaded or committed. Repository fixtures remain
sufficient to reproduce required checks without this optional local file.

## Limits

- Legacy shared fields sit 18 units inward versus Engine's 26; its trunk position
  consequently differs. Both remain centered in their own safe corridor. Outputs
  match Engine exactly, without redesigning the supported Legacy canvas.
- The existing shell undo restore omits imageObjects. Full canonical image-object
  coverage is tested separately; no saved-project schema change is included.
- WebGL2 is required. 400-device camera updates exceed a 60Hz frame budget.
- Browser checks use Chrome desktop/mobile emulation, not physical mobile devices,
  Safari/Firefox, production Vercel storage or physical printers.
- Large PDF drawings fit one page: labels are small but remain vector. Tiled
  printing and very large matrix-table redesign are outside this cleanup.

See `engine-output-scene.md`, `engine-html-outputs.md` and
`engine-pdf-output.md` for component details and reproduction commands.
