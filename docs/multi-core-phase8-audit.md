# Multi-Core Phase 8: Final Regression Audit

Date: 2026-10-20. Build: **54.38.112 - Multi-Core Stability**. Scope: regression
audit and minimal stability repairs only. No feature, schema migration, Legacy
implementation change, authentication change, release tag or deployment.

## Baseline and Ownership (Handoff 1-4)

1. Starting local HEAD: `622558c89b0811a9f6d5a2db6d905918ceea1303`.
2. Starting fetched remote HEAD: same SHA, `origin/engine-prototype`; second fetch
   before staging also matched. Untouched Phase 7 and pre-Phase-7
   `d4906c03e44c980a01ba7b60fe16cba5cc79e321` trees were tested separately.
3. Starting index empty. Protected Device JSON Import work: three shell additions
   (49 lines), `src/personalDefinitions.js` (40 lines), untracked source/test/
   fixture/browser/docs files. Other artwork, Masters, backups and PDF probes also
   protected. All 101 initial file hashes match. Only two build-fingerprint shell
   hunks are staged; staged shell equals HEAD plus those exact replacements.
4. **VERIFIED PASS, architecture audit:** reviewed Phases 2-7 docs/code. Model owns
   stable ends/ports/circuits, explicit mapping and counters. Connectivity derives
   passive occupancy independently of geometry. Structural gate validates before
   atomic commits. Projection owns schematic ends/sections, not physical cables.
   Detached drafts use shared placement helpers and library revision checks.
   Looms own patch leads; gateways own trunk geometry. Outputs reuse shared report
   facts; PDF reports follow drawing annotations. No replacement framework needed.

## Findings and Repairs (5-10)

Initial risks were recorded before production edits: Save/Close safety, output
reconciliation, preview ownership/resources, old Loom smoke and TextureCache warning.

| Finding / reproduction | Expected vs actual | Classification and resolution |
| --- | --- | --- |
| `productionBridge.js`: preview Loom label colour after geometry rebuild | Preview must be transient. Scene and canonical root shared normalized Loom records; preview mutated saved data, making commit a no-op and losing history. | MEDIUM, PRE-EXISTING on pre-Phase-7. Detach preview array and changed record. Failing regression first, then Chrome commit/cancel/undo/reload checks. |
| `multiCoreEditor.js`: inspect reserved and spare channels | Reserved showed Available; authored Spare showed Reserved. | MEDIUM, present in Phase 7 source. Correct status precedence only, no data/connectivity semantics change. Failing two-case test first, then UI reference acceptance. |
| Managed Loom smoke expects missing label defaults | Current creation explicitly stores white/black. Old fixture expected absent fields. | PRE-EXISTING test defect on both baselines. Test modern defaults plus a historical missing-fields fixture. Added canonical-root assertion exposed the separate production defect above. |
| Preview validator seeds TextureCache entry without `record` | Asset-ready should retire ownership and notify renderer. Malformed fixture caused swallowed `refCount` exception. | PRE-EXISTING test defect on both baselines. Use `createEntry`, assert refCount, GPU retirement and callback. Production TextureCache unchanged. |
| LED smoke compares explicit undefined with absent JSON property | Undo/reload preserve all defined data, but `manualRouteStyle: undefined` is not serialized. | PRE-EXISTING test defect. Compare JSON-shaped values in standalone/rack history cases; retain count/colour/endpoint/geometry assertions. Corrected full smoke passes unchanged Phase 7 too. No LED production change. |
| Apparent repeated-upload leak | Initial test retained +4,394 DOM nodes/+171 listeners per cycle. | Instrumentation issue: heap snapshot traced root to Playwright's retargeted file-upload ElementHandle. Lifecycle test uses Chrome file-input protocol and releases its DOM domain. No production workaround. |

6. **No known BLOCKING/HIGH Multi-Core defect remains in exercised paths.**
7. Production changes: the two small fixes, build/cache fingerprints and generated
   output-viewer bundle. Renderer algorithm and original-PNG/texture budgets unchanged.
8. Added 17 named Node regressions (two preview, two status, thirteen invalid data),
   shared invalid fixtures and browser reference/lifecycle/historical/invalid harnesses.
   Extended performance sampling and existing smoke assertions.
9. **Loom smoke VERIFIED PASS**, both test and production repaired, not excluded.
   Enhanced canonical-root check fails against the untouched pre-Phase-7 server.
10. **TextureCache warning is a test-fixture defect**, not demonstrated production
    leakage. Validator and repeated artwork lifecycle now finish without that warning.

## Integration Matrix (11-25)

| Item | Result and evidence boundary |
| --- | --- |
| 11. Model/identity | VERIFIED PASS: identities, counters, explicit correspondence, embedded snapshots, unknown metadata, opaque future schema, round-trip and exact history. |
| 12. Passive connectivity | VERIFIED PASS: typed resolution, both directions, partial/duplicate occupancy, media mismatch, cycles, no implicit matrix traversal or synthetic cables. |
| 13. Canvas | VERIFIED PASS: actual placement/cancel, A/B/assembly/section movement, route add/move/remove/reset, both styles, hit tests, mixed marquee, Fit, history/reopen. Preview ownership assertions reject ghost/canonical mutation. |
| 14. Editor parity | VERIFIED PASS for exercised paths: six tabs, seven styles, end isolation, shared snap/clamp helpers, marquee/group movement, numeric position, duplicate/delete, front/rear, overlap feedback, zoom/Fit, Escape drag cancel and atomic Save. Device/Faceplate/card suites pass. NOT TESTED: every gesture at every zoom or physical touch-device cancellation. |
| 15. Personal library | VERIFIED PASS: create/edit/duplicate/instantiate, original definition isolation, portable artwork/snapshot, real two-tab conflict, Defaults reload, Cancel. Factory data unchanged. |
| 16. Loom/Jump | VERIFIED PASS: real typed patch leads only in Loom; never trunk as member. Waiting/pair/unpair, section/gateway movement, hover, role colours, deletion guards, history/reopen, ordinary Jump/Loom/Portal regressions. |
| 17. Signal Chain | VERIFIED PASS: same circuit in both directions; edited 100 m trunk; diagnostic/cycle coverage. |
| 18. Cable Schedule | VERIFIED PASS: two physical patch leads; no count for graph edges, trunk sections, gateway links or fanout tails. IDs reconcile. |
| 19. Assembly/manifest | VERIFIED PASS: one assembly, fourteen circuits, one occupied, one reserved, twelve spare/unused, zero disabled/unresolved in reference. Explicit authored spare also exercised. |
| 20. CSV/XLSX | VERIFIED PASS: actual downloads parsed; three principal sheet row counts, filters/frozen headers/non-formula cells. Existing report tests cover text IDs, quoting, UTF-8, formula-like values, order and diagnostics. NOT TESTED in desktop Excel UI. |
| 21. PDF | VERIFIED PASS: toolbar export, 23 production cases plus pypdf transform/vector/text/image/row inspection. Seven-page reference; reports after drawing. Two reciprocal GoTo/XYZ annotations match canvas. Ten offline Chrome clicks, five viewports, retained 300% zoom and visible targets. A4/A3/margins/scale/cross-page structural checks pass. NOT TESTED in Acrobat/Preview or print hardware. |
| 22. Viewers | VERIFIED PASS: exact report snapshot and geometry in offline HTML with network blocked and simulated hosted preparation; no editor authority. Existing report/Signal Chain/download checks pass. NOT TESTED with live authenticated Publish service. |
| 23. Save/historical | VERIFIED PASS: edited reference mappings/layout/100 m survive reopen. Detached Habtoor/Reuters copies load/report/save/reopen/PDF without page errors; originals unchanged. Other historical shapes use committed device/card/matrix/rack/LED/Loom/Jump/Portal fixtures. |
| 24. Invalid inputs | VERIFIED PASS: thirteen model and actual browser cases: missing aggregate/end/port, duplicate circuit/end, incompatible media, unknown metadata, future schema, bad route point, absent Jump, duplicate owner, unresolved cable, missing artwork. Twelve save/reopen retaining original Multi-Core data. Missing artwork safely blocks Save with recoverable HTTP 404 message. Unrelated devices remain; Escape available. Invalid mapping separately tests failed Save then Cancel, Close and Escape, with no canonical/history change. |
| 25. Delete/recreate | VERIFIED PASS in model/mutation/history and canvas tests: connected deletion blocked, disconnected deletion scoped, high-water/identity allocation and gateway protections retain physical leads. NOT TESTED as one uninterrupted UI sequence: disconnect both leads, delete, undo, redo, replacement with personal defaults. |

Reference report/export actions compare full canonical snapshot/history before and
after: no cable numbering, lengths, occupancy, Loom or Jump mutation.

Private historical copies (contents not committed):

| Project | Devices | Stored connections | Physical schedule rows | LED surfaces | Jump pairs | Load ms, one sample |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Habtoor | 80 | 229 | 210 | 2 | 19 | 597 |
| Reuters | 64 | 109 | 86 | 0 | 23 | 1,131 |

Counts reconcile ordinary Jump legs. Neither private file contains Looms or
Multi-Cores; dedicated fixtures cover those. Save persists previously implicit LED
landing indexes, so the test compares effective endpoints rather than rewritten
file bytes. Reload waits for a new completed project-load metric, not stale ready.

## Resource Measurements (26)

**VERIFIED PASS within measured window:** Chrome 155.0.8059.85, macOS 26.5,
Apple M2 Max, Node 24.4.1. Twelve editor cycles, four 4096 x 2048 uploads each
(transparent PNG, JPEG, WebP, safe SVG), front/rear switching and connector movement.
Original encoded bytes/dimensions retained; image DOM identity remains stable
during movement; no full renderer rebuild during drag.

After GC at cycles 3/6/9/12: DOM nodes **15,611 at every sample**; listeners
**721 at every sample**; active previews/observers/object URLs **0**; asset-ready
subscribers **1** (main canvas). Heap **17.87/17.89/17.98/18.03 MB** in isolated run.
Candidate repeat also passes trend guards. Earlier instrumentation leak/retainer
evidence is retained. NOT TESTED: total browser/GPU-driver memory or multi-hour soak.

## Performance (27)

Milliseconds, median / worst. Browser timings include automation/event/render waits;
drag includes eight pointer steps. Three samples per count, one assembly.

| Circuits | Load | Editor open | Connector drag | Dispose | Report open |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 75/102 | 96/144 | 169/181 | 31/35 | 39/65 |
| 16 | 73/74 | 80/81 | 177/177 | 32/34 | 40/41 |
| 32 | 74/75 | 90/108 | 185/185 | 27/28 | 39/39 |
| 64 | 81/84 | 103/112 | 188/189 | 32/32 | 40/40 |
| 256 | 166/168 | 239/244 | 292/303 | 54/60 | 57/70 |

Node CPU-only reports, five samples after one warm-up:

| Circuits | Snapshot median | Schedule median | XLSX median | PDF median |
| ---: | ---: | ---: | ---: | ---: |
| 8 | 1.23 | 0.56 | 6.17 | 14.71 |
| 16 | 1.32 | 0.80 | 5.86 | 23.08 |
| 32 | 1.94 | 1.38 | 6.39 | 41.48 |
| 64 | 3.28 | 2.52 | 8.66 | 77.33 |
| 256 | 12.80 | 8.55 | 25.16 | 296.49 |

256-circuit PDF worst: 301.49 ms. All worst timings retained in performance.json.
Geometry CPU-only, 256 circuits, 30 samples after five warm-ups:

| Operation | Median / worst ms |
| --- | ---: |
| Association model | 43.745 / 49.166 |
| Full regeneration, not pointer motion | 28.576 / 29.402 |
| End A preview | 0.011 / 0.038 |
| End B preview | 0.009 / 0.018 |
| Gateway preview | 0.003 / 0.010 |
| Section preview | 0.011 / 0.021 |
| Route point preview | 0.007 / 0.017 |
| Signal lookup | 0.040 / 0.074 |

NOT TESTED as repeated browser latency benchmarks: insertion and save. Their
functional workflows pass. Also not profiled: sustained many-assembly/many-Loom/
populated-library workloads. CPU model timings are not browser frame timings.
No per-pointer project/report/library/output rebuild was introduced.

## Acceptance and Evidence (28-32)

28. Reference starts with ordinary device fixtures and Hybrid 14 definition,
    **zero instances and zero patch cables**. Real picker/canvas actions place it,
    draw both SDI leads, create Loom and pair gateways. Editor exercises all styles,
    leaves B Fanout/A Rack Panel, moves connector, edits 75 m to 100 m/notes,
    saves/undoes/redoes/reopens. Reports, both trace directions, CSV/XLSX/PDF,
    offline HTML and hosted preparation reconcile. Devices are fixture definitions,
    not manually constructed from blank in this run.
29. Local evidence root: `/tmp/wirenexus-phase8/`, not committed. Key directories:
    `reference`, `historical`, `invalid`, `lifecycle`, `performance`, `final-browser`,
    `staged-acceptance`. Screenshots inspected: reference Fanout/channel manifest,
    PDF drawing/register/manifest/diagnostics/navigation, Multi-Core snap guides,
    Device Editor reference, Faceplate marquee, card Shared Bus, large artwork
    and historical LED canvas. Exact
    transient/committed geometry is additionally asserted by interaction tests.
30. Node baseline `test/*.test.mjs`: **1,575 pass**. Matching full `node --test`:
    **1,577 baseline, 1,594 isolated candidate, 1,614 working tree** including the
    twenty protected import tests. Zero failures/skips. Full discovery adds two
    helper modules; seventeen new named regressions added.
31. **16/16 static validators pass**. All three bundles current/reproducible,
    twenty changed JS/MJS syntax checks pass, working/staged diff checks pass.
32. Browser baseline 28/29 pass (LED comparison defect). Broad final batch initially
    30/31 pass, with remaining rack LED comparison failing identically. Corrected
    complete LED smoke passes candidate AND unchanged Phase 7. Final isolated
    six-script acceptance **6/6 pass** covers editor, combined reference, managed
    Loom, LED, lifecycle and thirteen invalid files. Historical and ten PDF clicks pass
    separately. Failed runs remain in logs; no failure silently excluded.

Reproduce with real Chrome and `AVDESIGNER_BASE_URL`/`AVDESIGNER_SCREENSHOT_DIR`:

```sh
node --test
node scripts/managed-loom-smoke.mjs
node scripts/multi-core-jump-smoke.mjs
node scripts/multi-core-lifecycle-smoke.mjs
node scripts/multi-core-invalid-smoke.mjs
node scripts/multi-core-historical-smoke.mjs /path/to/project.avd
node scripts/multi-core-jump-performance.mjs
node scripts/multi-core-reports-performance.mjs
node scripts/multi-core-jump-pdf-smoke.mjs /path/to/reference-output
npm run check:output-viewer
npm run check:cable-schedule
npm run check:pdf
git diff --check
git diff --cached --check
```

Per-script command/exit/duration: each evidence directory's `results.json`.
`PHASE8_HEAP_SNAPSHOT=1` adds lifecycle heap diagnostics. PDF structural inspection
uses existing `inspect-multi-core-jump-pdf.py`/`inspect-pdf-production.py` with pypdf.

## Handoff (33-40)

33. **KNOWN LIMITATIONS / NOT TESTED** listed above: other viewers, Excel UI, live
    authenticated Publish, exhaustive gestures, uninterrupted delete/recreate,
    GPU/process memory, longer dense workload and separate insertion/save timings.
    Unauthored physical pinout/polarity stays explicitly unverified in diagnostics.
34. Production files: `multiCoreEditor.js`, `productionBridge.js`, renderer
    fingerprint, output-viewer bundle and shell build fields. Test/support: shared
    invalid fixture, two Node suites, four new browser helper/harness files, Jump
    smoke/performance, reports performance, Loom/LED/preview fixtures and four
    fingerprint validators. This audit is the sole documentation change.
35. Final commit SHA is supplied in the delivery message after successful commit;
    `git log -1 --format=%H -- docs/multi-core-phase8-audit.md` identifies it.
36. Remote SHA is checked using `git ls-remote origin refs/heads/engine-prototype`
    after normal push and supplied with the delivery message.
37. Device JSON Import remains local/uncommitted; original shell additions and
    protected file hashes checked before staging and again before commit.
38. Other artwork/Masters/backups/probes untouched. Private originals' hashes
    unchanged; all private/generated test artifacts outside repository.
39. **Readiness:** scoped Phase 8 candidate is acceptable on the exercised Chrome
    platform with no known blocking/high Multi-Core defect. This is not an
    exhaustive platform or release certification; no deployment/tag requested.
40. Recommended next checks: human review of reference/project in usual browser
    profile, native PDF/Excel review and a longer real-show soak. No new feature
    or architecture work included.
