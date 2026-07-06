# AV Designer Engine Mode Feature Parity Matrix

Engine mode is experimental and remains opt-in behind `index.html?engine=1`.
Normal `index.html` must continue to use the production SVG renderer until this
matrix is mostly covered and the export/viewer/report migration is planned.

Current visible build label: `Iteration 23`.
The app top bar must show one of these labels:

- `Iteration 23 — Production — 0b15728`
- `Iteration 23 — Engine Beta — 0b15728`
- `Iteration 23 — Engine Default Test — 0b15728`

The commit/build hash is a static label in this standalone HTML build, so use
the actual Git commit as the final source of truth when reviewing a pushed
change.

## How To Test

1. Open production mode: `index.html`.
2. Open production mode with cache busting: `index.html?v=iteration23`.
3. Open engine beta mode: `index.html?engine=1`.
4. Open engine beta mode with cache busting:
   `index.html?engine=1&v=iteration23`.
5. Open the controlled default experiment:
   `index.html?engineDefaultTest=1&v=iteration23`.
6. Open the debug loading guard: `index.html?engine=1&debugLoad=1`.
7. Open a timed loading guard: `index.html?engine=1&loadDelay=1500`.
8. Confirm the top bar build label matches the mode you intended to test.
9. Disable engine beta/default-test mode with the **Engine Beta** toolbar button,
   or remove `engine=1` / `engineDefaultTest=1` from the URL.
10. Load a real `.avd` or `.json` project.
11. Use **Validate Engine Scene** after loading and after edits.
12. Run the fixture validation:
   `node scripts/engine-real-project-validation.mjs --fixture`
13. Run the real-project validation:
   `node scripts/engine-real-project-validation.mjs "/path/to/project.avd"`

## Status Legend

- `covered`: tested and expected to match production-compatible behavior.
- `partial`: useful coverage exists, but not enough to make engine default.
- `not covered`: no reliable validation yet.
- `not intended yet`: deliberately outside the current engine-bridge scope.

## Feature Parity Matrix

| Feature | Production behavior | Engine behavior | Status | Test method | Risk level | Notes |
|---|---|---|---|---|---|---|
| project load | Loads `.avd`/JSON into production state and SVG canvas. | Normalizes production state into `SceneGraph` behind `?engine=1`. | covered | Manual load plus validation script. | medium | Real project currently validates with 141 objects and 267 wires. |
| project save/reload | Existing save reads production state. | Engine commands write through to production state. | covered | Validation script serializes/reloads after every command stage. | medium | Uses JSON serialization directly to avoid mutating debug stats. |
| production mode opening engine-edited files | Production renderer opens saved project data. | Engine edits mutate existing production format. | partial | Script round-trips project data; manual production visual check still needed. | medium | Export/viewer migration is not part of engine bridge yet. |
| device selection | Click selects one device and inspector updates. | Engine hit-test selects one object and syncs selection. | covered | Manual engine smoke. | low | Repeated-click offset bug fixed before this pass. |
| multi-device selection | Marquee/keyboard selection selects several objects. | Engine marquee selects multiple objects. | partial | Manual smoke and drag session checks. | medium | Advanced production selection gestures need broader manual coverage. |
| wire selection | Click wire selects it for inspector/delete. | Engine wire hit-test selects wire. | covered | Manual smoke and validation script delete cycle. | medium | Dense projects still need UX tuning, but data path is covered. |
| connector selection | Click connector selects connector / starts wire draw. | Engine connector hit-test selects connector and starts wire create. | partial | Manual smoke. | medium | Inspector parity is temporary in engine mode. |
| device move | Drag updates device and connected wires. | Drag session commits one position update. | covered | Validation script single move execute/undo/redo. | low | No texture rebuild should happen for position-only move. |
| multi-device move | Selected group moves together. | One drag session and one mutation for selected group. | covered | Validation script 20-device move execute/undo/redo. | medium | Visual/manual stress remains useful on very large projects. |
| route point move | Custom route points can move and save. | Route point command writes back to production connection. | covered | Validation script route point move execute/undo/redo. | medium | Custom corner geometry is preserved as data points. |
| custom route point preservation | Route points survive redraws, save/load, undo/redo. | Validator checks parity against production data after each command. | covered | Validation script route point and delete/restore cycles. | low | Route points should only change in route point command or deletion. |
| wire create | Connector-to-connector creates production connection. | Engine creates scene wire and production connection. | covered | Validation script create wire execute/undo/redo. | medium | Compatibility rules are still production-owned. |
| wire delete | Selected wire deletes from canvas and project. | Engine deletes selected scene wire and production connection. | covered | Validation script delete wire execute/undo/redo. | medium | Restored wire keeps original ID and metadata. |
| wire undo/redo | Undo/redo restores/deletes one wire step. | Command-shaped script validates undo/redo boundaries. | covered | Validation script create/delete cycles. | medium | Browser command stack smoke still useful. |
| device move undo/redo | One move is one undo step. | Engine command stores before/after positions. | covered | Validation script single move cycle. | low | Bridge command stack tested manually in previous pass. |
| multi-device undo/redo | One group move is one undo step. | Engine command stores batch before/after positions. | covered | Validation script 20-device move cycle. | medium | Script verifies no unrelated devices move. |
| route point undo/redo | Restores previous route points. | Engine command stores before/after route point arrays. | covered | Validation script route point cycle. | low | Script verifies unrelated wires unchanged. |
| selection sync to inspector | Production inspector reflects selected object. | Temporary engine inspector reflects engine selection. | partial | Manual engine smoke. | medium | Full production inspector parity is not the end-state yet. |
| engine temporary inspector | Not present in production. | Shows current engine selection details. | covered | Manual engine smoke. | low | Intended debug surface, not final UI. |
| production inspector compatibility | Inspector edits production data. | Engine mode should not corrupt production inspector data. | partial | Script validates production state; manual UI editing still separate. | medium | Production inspector is not migrated. |
| keyboard shortcuts | Delete, Escape, undo/redo work in production. | Delete/Backspace, Escape, Cmd/Ctrl-Z work in engine mode. | partial | Manual smoke. | medium | More platform/browser shortcut checks needed. |
| Delete/Backspace selected wire deletion | Deletes selected wire. | Deletes selected engine wire and writes through. | covered | Manual smoke and delete wire script. | low | Selection clears/updates through engine inspector. |
| Escape cancel behavior | Cancels tools/drag state. | Cancels active engine interactions. | partial | Manual repeated-click/drag checks. | medium | Automated browser interaction test is still useful. |
| pan/zoom behavior | Production SVG pan/zoom. | WebGL pan/zoom with engine renderer. | covered | Manual real project testing. | low | User confirmed speed is good enough. |
| WebGL visual path | Not production default. | Engine renderer draws scene in WebGL. | covered | Manual `?engine=1`; HUD shows engine active. | medium | Still not export/viewer path. |
| texture rebuild behavior | Production SVG has no texture cache. | Engine tracks texture counts and warnings. | partial | HUD metrics and manual drag checks. | medium | No continuous validation during drag. |
| cable hops | Production supports cable hops. | Engine visual path does not calculate hops yet. | not intended yet | Checklist only. | high | Existing viewer/export hop logic must remain production-owned for now. |
| rack/internal wires | Production supports rack/internal wires. | Engine adapter maps supported production connections. | partial | Scene validation catches missing endpoints. | high | Deep rack editor parity remains future work. |
| jump nodes | Production jump nodes and source/destination boxes. | Engine maps jump nodes as objects/connectors. | partial | Fixture includes jump node connection. | medium | Full jump-node UI parity is future work. |
| LED surfaces | Production LED grid object and signal ports. | Engine maps LED surfaces with virtual surface ports. | covered | Scene validation accepts virtual `surface-port-*` endpoints. | medium | Visual fidelity still production-only. |
| reports compatibility | Production reports read project state. | Engine write-through should keep report data readable. | partial | Script validates production data shape. | medium | Reports are not migrated to engine renderer. |
| viewer/export compatibility | Production export/viewer use existing renderer/data. | Engine does not change export/viewer. | not intended yet | Keep normal export tests separate. | high | Do not migrate until engine parity is stronger. |
| normal `index.html` without engine | Production app only. | No engine bridge mounted. | covered | Browser smoke. | low | Must remain true until explicit rollout. |
| `index.html?engine=1` | Production app plus engine bridge overlay. | Engine bridge mounts and uses production data. | covered | Browser smoke. | low | Still opt-in. |
| debug loading overlay | Not production behavior. | `debugLoad=1` / `loadDelay=` holds readiness. | covered | Browser smoke. | low | Diagnostic only. |
| manual scene validation | Not production behavior. | Button runs shared validator on demand. | covered | Browser smoke and script. | low | Does not run during drag. |
| performance HUD | Not production behavior. | Shows engine metrics and guardrail warnings. | covered | Browser smoke. | low | Diagnostic only. |
| real-project validation script | Not production behavior. | Script validates data operations without browser. | covered | Node script against real `.avd`. | low | Uses private local project path only when explicitly run. |
| synthetic fixture validation | Not production behavior. | Committed synthetic fixture covers command cycles. | covered | `--fixture` script run. | low | No private project data committed. |

## Guardrails

- Do not remove `?engine=1` isolation until production/export/viewer parity is proven.
- Do not run validation during drag.
- Do not rebuild device textures for position-only moves.
- Do not add report/export recalculation to pointermove or drag/drop paths.
- Keep custom route points, jump-node data, cable hops, and rack/internal wire data intact.
- Treat engine HUD warnings as diagnostics only, not blocking errors.
