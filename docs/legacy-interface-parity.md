# Legacy Interface And Visual Fidelity Parity Audit

Source of truth for this audit:

- Legacy reference: `8301fbf23c82f3e3f2496cb90234019c7bf47958`
- Current branch audited: `engine-prototype`
- Current build label: `Iteration 40.2`
- Scope: interface and visual fidelity only. Functional wire parity is tracked in
  [`docs/legacy-functional-parity.md`](legacy-functional-parity.md).

Iteration 40.2 is the exact cached-device visual parity pass after Iteration
40.1. It keeps the modular chassis texture work, sharpens cached textures,
removes the stale square WebGL body layer behind rounded device textures,
restores Legacy dark shell/faceplate colors, moves selected textured devices as
textures during drag, and restores adapter/breakout dashed bodies plus internal
fan-out wiring in the cached texture path.

Iteration 39 was deliberately an audit pass. It did not migrate reports,
exports, the standalone viewer, or the remaining Legacy editors. The goal is to
identify which visual and interface systems are already owned by the Engine,
which systems are still delegated to Legacy UI, and which systems need dedicated
migration iterations.

## Status Summary

| Status | Count | Meaning |
| --- | ---: | --- |
| complete | 2 | Engine behavior is close enough to Legacy for this audit phase. |
| partial | 17 | Engine has some data/render support, but not full Legacy fidelity. |
| delegated | 7 | Production/Legacy UI still owns the workflow while Engine syncs data. |
| missing | 2 | Engine does not yet render or control the Legacy surface. |
| blocked | 0 | No item is blocked; several are intentionally deferred. |

## Engine Ownership Classes

| Class | Meaning | Examples |
| --- | --- | --- |
| A | Production UI remains source of truth; Engine only consumes data. | Device Editor, Rack Builder, Node Builder, Matrix modal. |
| B | Production UI owns editing; Engine needs cache invalidation and scene sync. | Faceplate resize, card slot edits, project custom devices. |
| C | Engine command path must own mutation for fast canvas editing. | Device move, wire create/delete/rewire, route-point edits. |
| D | Engine renderer must match Legacy visual output. | Faceplates, cards, connector fields, PD plug SVGs, adapter internals. |
| E | Full UI restore or new Engine UI required. | Inspector parity, context menus, toolbar/panel polish. |

## Interface Parity Matrix

| Feature/UI area | Legacy behaviour | Current Engine behaviour | Status | Legacy function/code location | Engine function/code location | Data fields | Renderer impact | Inspector/UI impact | Undo/redo impact | Save/load impact | Report/export impact | Risk level | Recommended iteration | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Normal device body | SVG device body with dark shell, faceplate area, labels, connector rails, selected glow, and detailed child elements. | Cached bitmap texture drawn by Engine with real faceplate image loading, modular card bands, caption bars, connector field boxes, connector markers, and labels. | partial | `drawDeviceBody` at `8301fbf:index.html:43703` | `buildDeviceVisual`, `drawDeviceVisual`, `drawDeviceHeader`, `drawFaceplate`, `drawCardAreas` in `src/engine/deviceVisualBuilder.js`; `drawDeviceLabel` in `src/engine/renderer.js` | `deviceInstances`, template `width`, `height`, `brand`, `name`, `model`, `category`, faceplate metadata, card metadata | High: texture fidelity and cache invalidation define main canvas look. | Device selection and hover are Engine-owned; edit workflow is still Legacy modal. | Position moves are command based; visual-only body changes need texture invalidation. | Existing data is compatible. | Viewer/PDF still use existing output paths. | medium | 40 | Iteration 40.2 improves E2-style visual fidelity through cached textures, not live SVG restoration. |
| Device name, brand, model, and category text | Device name appears inside body, category/model appear in library and inspector, long labels are clipped. | Engine renders compact labels and low-zoom clipping; inspector partially reads category/section. | partial | `drawDeviceBody`, `renderDeviceInspector` at `8301fbf:index.html:43703`, `49786` | `drawDeviceLabel`; `contextMenuObjectTarget`; inspector bridge in `src/engine/productionBridge.js` | `name`, `brand`, `model`, `category`, `section` | Medium: label placement must match Legacy at low zoom and selection. | Inspector still uses production panel. | Name edits should be one template/instance mutation when re-enabled in inspector. | Compatible. | Reports read production fields. | low | 40 | Keep labels inside bounds; do not bring back huge DOM labels. |
| Faceplate image rendering | Custom PNG faceplates draw at editable size/position; deleted faceplate removes the space; generated PD faceplates use SVG plug assets. | Engine metadata carries faceplate state and Iteration 40.2 draws real faceplate images into cached textures with Legacy-style placement and async affected-texture invalidation. | partial | `faceplateHeightForTemplate`, `renderDeviceEditorPreview`, `drawDeviceBody` at `8301fbf:index.html:33926`, `40081`, `43703` | `normalizeVisualMetadata` in `src/engine/sceneGraph.js`; `drawFaceplate`, `legacyFaceImagePlacement`, image cache helpers in `src/engine/deviceVisualBuilder.js`; asset invalidation in `src/engine/textureCache.js` | `faceImage`, `faceImageNaturalWidth`, `faceImageNaturalHeight`, `faceImageScale`, `faceImageScaleX`, `faceImageScaleY`, `faceImageOffsetX`, `faceImageOffsetY`, `faceplateDeleted` | High: real image loading into texture atlas/canvas is required. | Faceplate editor remains Legacy. | Visual edits need texture invalidation only for changed device/template. | Existing fields preserved. | PDF/viewer may still diverge until output path shares helpers. | high | 40 | PD generated faceplates remain a later special pass; standard PNG faceplates now load in Engine textures. |
| Project Custom Devices panel | Modified devices appear in a dedicated list, can be clicked/dragged, searched, and edited. | Data sync and drag/drop work through Engine create-device command; panel UI remains production. | delegated | `renderProjectCustomDevices` at `8301fbf:index.html:42037` | Library drag/drop bridge and command path in `index.html` and `src/engine/productionBridge.js` | custom template records, IDs, category, favorite state | Low unless thumbnails need Engine-generated preview. | Production panel still owns search/list UI. | Drop creates one undoable command. | Custom devices remain in project data. | Reports count placed devices, not library entries. | medium | 42 | Needs audit with real custom devices after faceplate fidelity improves. |
| Default Device Library and tree | Tree by section/category, search, favorites, library item context menu, duplicate, edit in Device Editor. | Production list remains visible; Engine accepts real pointer/drop path and creates devices. | partial | `renderDeviceLibrary`, `showLibraryDeviceContextMenu` at `8301fbf:index.html:41929`, `48259` | Library drag/drop debug helpers in `index.html`; Engine command bridge in `src/engine/productionBridge.js` | built-in templates, favorites, category tree, pair metadata | Low. | Production tree still owns ordering and context menu. | Device drop/undo/redo are Engine commands. | Compatible. | No direct output impact. | medium | 40 | Context menu command refresh should be audited before broader UI polish. |
| Device Editor modal | Multi-tab Legacy modal edits device, faceplate, connectors, cards, slots, defaults, tech specs. | Modal remains production/Legacy UI; Engine reloads/syncs after apply. | delegated | `renderDeviceEditorPreview`, editor handlers near `8301fbf:index.html:40081` | Engine refresh/load paths in `src/engine/productionBridge.js` and project normalization in `src/engine/projectAdapter.js` | templates, connectors, cards, slots, faceplate metadata, tech specs | High only after Apply, because visual cache must invalidate changed templates/instances. | Legacy modal remains complete source of truth. | Apply is not yet an Engine granular command. | Existing save format unchanged. | Reports consume updated production data. | high | 41 | Keep editor delegated for now; improve cache refresh contract first. |
| Create, duplicate, and delete device template workflow | Buttons in Device tab plus library context menu create/duplicate/delete templates. | Still production-owned; Engine consumes resulting templates after apply/refresh. | delegated | Device tab handlers in `index.html`; `showLibraryDeviceContextMenu` at `8301fbf:index.html:48259` | `ProductionEngineBridge.refreshSceneFromProduction` and library create command path | template IDs, copied connectors/cards/visuals | Medium when duplicated template shares image/card metadata. | Legacy UI owns confirmation and forms. | Template-level undo remains production-side. | Compatible if IDs remain stable. | No direct output impact. | medium | 41 | Must ensure duplicated device texture cache key is unique enough. |
| Modular card slot generated connectors | Card slots generate real connector instances with per-slot overrides and lane math. | Engine normalizes cards and generated connectors for scene graph, but visual card fields are simplified. | partial | `cardSlotLaneCount`, `generatedCardConnectors`, `effectiveTemplateConnectors` at `8301fbf:index.html:33912`, `34025`, `34054` | `normalizeVisualCards`, `generatedCardConnectors`, `effectiveConnectorsForTemplate` in `src/engine/projectAdapter.js` | `cardSlots`, `cardTypes`, `connectorOverrides`, `generatedFromCard`, `cardSlotId`, `sourceConnectorId` | High: card visuals and generated connector positions must stay aligned. | Slots/cards editor remains Legacy. | Wire endpoints to generated connectors must remain stable through edits. | Existing fields preserved. | Reports read effective connectors/wires. | high | 41 | This should be first major UI parity pass after context menus. |
| Installed card visual captions | Card blocks have colored caption bars, slot/card names, custom backgrounds, and generated node fields. | Engine draws dashed card bands, installed-card caption bars using card text/background colors, and compact Name/Resolution/Custom connector fields in the cached texture. | partial | `renderDeviceEditorPreview`, `drawDeviceBody`, card slot helpers | `drawCardAreas`, `drawCardCaption`, `drawCardConnectorFields` in `src/engine/deviceVisualBuilder.js`; card metadata from `projectAdapter.js` and `sceneGraph.js` | card visual color, caption color/background, slot ID, installed card type, per-slot connector overrides | High for E2-style devices. | Card editing remains Legacy. | Texture invalidation only when card visual/slot changes. | Compatible. | Viewer/PDF may not match Engine yet. | high | 40 | Iteration 40.2 restores recognizable E2-style installed cards without making the device a live SVG tree again. |
| Connector markers | Round colored connector nodes on sides, selected/hover states, direction rules, SFP active module display. | Engine connector overlay restores hover/selection and compatibility feedback; marker visuals are close but not full Legacy info-field fidelity. | partial | `drawDeviceBody`, `effectiveTemplateConnectors`, `connectorInfoFields` | `drawConnectorMarkers` in `deviceVisualBuilder.js`; connector overlay in `src/engine/renderer.js`; compatibility in `src/engine/connectorCompatibility.js` | connector `id`, `type`, `direction`, `x`, `y`, `installedModuleType`, `fiberMode` | High for hit-testing and visual trust. | Connector inspector is delegated/partial. | Wire create/rewire commands rely on connector IDs. | Compatible. | Reports use wire endpoints. | medium | 43 | Keep compatibility helper shared; visual improvements must not alter IDs. |
| Connector info boxes and editable node fields | Name/resolution/custom boxes draw near connectors, shrink/magnify, can be edited in Device Editor. | Engine shows limited/simplified labels; production editor still owns field editing. | partial | `connectorInfoFields`, `renderConnectorInspector` at `8301fbf:index.html:41639`, `50170` | Metadata normalization in `sceneGraph.js`; overlay/labels in `renderer.js` | `nameText`, `resolutionFrameRate`, `customText`, field captions | High when zoomed in on card-heavy devices. | Inspector can show connector details; inline edit not Engine-owned. | Field edits should invalidate only affected device texture. | Compatible. | Exports need same field visibility later. | high | 44 | Do after cards and faceplates because it depends on final connector placement. |
| Adapter/breakout visual | Transparent/dashed compact device with name outside, no node fields, internal wiring, multi-connection breakout rules. | Engine draws the compact dashed transparent cached body, keeps the label outside as a live overlay, and preserves adapter interaction. | partial | `isAdapterTemplate`, `drawDeviceBody` at Legacy commit; adapter code in production `index.html` | `drawAdapterVisual` and `drawAdapterInternalWires` in `src/engine/deviceVisualBuilder.js`; adapter label overlay in `src/engine/renderer.js`; adapter normalization in `projectAdapter.js` | `isAdapterBreakout`, compact dimensions, connectors, internal wires | Medium: simple but visually distinctive. | Device Editor toggle remains production UI. | Multi-connection and internal route changes need command audit. | Compatible. | PDF/export adapter styling still needs output-path parity later. | medium | 45 | Engine no longer reuses the full device body for adapters. |
| Adapter internal gradient wiring | Internal cable fades from input color to output color and supports breakout fan-out. | Engine derives input/output pairs from adapter connectors and draws internal Bezier fan-out wires with input-to-output gradients inside the cached texture. | partial | Legacy adapter drawing in `drawDeviceBody` and production helper blocks | `adapterInternalWirePairs`, `adapterInternalWirePath`, and `drawAdapterInternalWires` in `src/engine/deviceVisualBuilder.js` | connector direction/side, connector colors | Medium. | No current Engine editing UI. | Needs undo only if user can edit internal mapping. | Save format remains unchanged. | Reports count adapter device and external cables. | medium | 45 | Output/viewer/PDF adapter rendering remains a separate parity pass. |
| Power Distro generated faceplate | PD faceplate uses plug SVGs, drag/marquee movement, collision warning, powerlock special layout. | Production device editor and output paths own most PD layout; Engine visual texture is simplified. | missing | `powerPlugImageForConnector`, `powerPlugLayout`, `drawPowerDistroFaceplate` at `8301fbf:index.html:39237`, `39364`, `39734` | PD metadata passes through `projectAdapter.js`; no full Engine plug renderer | `isPowerDistro`, `powerPlug`, `powerDistroFaceHeight`, `powerDistroFaceY`, plug asset IDs | Very high for PD devices. | PD editor remains Legacy. | Plug movement/template edits remain production-side. | Fields preserved if not touched. | PDF/viewer PD visuals remain separate risk. | high | 46 | Needs SVG/image asset loading into textures and transparent PDF strategy later. |
| Powerlock multicolor nodes and wires | Powerlock uses multiple phase colors, not one green fallback. | Engine connector/cable helpers support multicolor in main canvas; editor/outputs need audit. | partial | Power connector color helpers in Legacy `index.html`; `drawDeviceBody` | `src/engine/connectorCompatibility.js`, renderer wire/color helpers, `deviceVisualBuilder.js` markers | connector type, multicolor swatch metadata | Medium. | Inspector/report swatches should stay consistent. | No special undo. | Compatible. | Report/export color swatches need later output pass. | medium | 43 | Do together with connector-marker fidelity. |
| LED surfaces and image surfaces | LED grids/images can render PNGs, pixels, labels, right-click actions like Use image size. | Engine renders surfaces as simplified visuals; output/editor parity is partial. | partial | LED surface render/context helpers including `showLedSurfaceContextMenu` at `8301fbf:index.html:48241` | `drawSurfaceVisual` in `deviceVisualBuilder.js`; scene objects in `sceneGraph.js` | led surface bounds, image payload, pixels, labels | Medium-high for large projects. | Inspector remains production. | Resize/move commands are Engine if on canvas. | Compatible. | Reports count LED screens and pixels; PDF/viewer separate. | medium | 47 | Real image fidelity matters for client drawings. |
| Jump nodes | Special portal node, radial colors, source/destination boxes, selection, rewire limitations. | Engine visual and movement mostly restored; user noted jump nodes still not fully implemented. | partial | Jump node drawing and context helpers in Legacy `index.html` | `drawJumpVisual`, jump owner resolution in `sceneGraph.js`, bridge rewire paths | jump IDs, endpoint ownership, paired jump IDs, connector IDs | Medium. | Inspector still production/partial. | Move/selection commands work; some portal rewiring remains deferred. | Compatible. | Viewer jump behavior must remain aligned. | medium | 44 | Do not expand before endpoint and ownership edge cases are closed. |
| Rack Builder | Separate modal with device source pane, rack list, internal wiring, exposed rack ports, preview pan/zoom. | Production Rack Builder remains source of truth; Engine can place/move rack instances and read rack data. | delegated | `renderRackBuilder`, `renderRackBuilderPreview`, `renderRackBuilderInternalWires` at `8301fbf:index.html:36181`, `37303`, `37138` | Rack objects normalized by `sceneGraph.js`; device visuals by `deviceVisualBuilder.js` | rack definitions, internal wires, exposed ports, child device transforms | High if moving Rack Builder to Engine. | Entire builder remains Legacy. | Rack internal commands not broadly Engine-owned. | Existing data preserved. | Reports/export read rack/project data. | high | 48 | Keep delegated until core device/card visual parity is stable. |
| Rack instances on canvas | Rack group is selected/moved as one, optional internal wiring display, right-click edit in Rack Builder. | Engine supports object selection/move; context actions are delegated. | partial | `showRackContextMenu`, rack draw helpers | `ProductionEngineBridge.handleContextMenu`; scene graph rack nodes | rack instance ID, child IDs, show internal wiring | Medium. | Inspector/context menu need parity. | Move is Engine command. | Compatible. | Viewer should preserve internal display flag. | medium | 48 | Audit after Rack Builder UI pass. |
| Matrix routing UI | Matrix modal/crosspoint editor, selectable matrix connectors, report sections. | Production modal remains source; Engine only preserves data. | delegated | `renderMatrixRoutingModalBody`, matrix report helpers at `8301fbf:index.html:49570` and current report code | No dedicated Engine matrix editor yet | matrix routes, matrix-enabled connector flags | Low for canvas renderer. | Full modal remains Legacy. | Route changes are production-side. | Compatible. | PDF/report matrix output remains production. | medium | 49 | Keep out of Engine renderer until Inspector parity is stable. |
| Device inspector | Shows type, section/category, brand, name, power/spec actions, connected nodes, buttons. | Production inspector still used, with Engine selection sync. | delegated | `renderDeviceInspector` at `8301fbf:index.html:49786` | Selection sync and inspector refresh in `src/engine/productionBridge.js` | selected IDs, device fields, connection list | Low renderer impact. | High UI impact: detail parity matters to workflow. | Field edits can become Engine commands later. | Compatible. | Reports unaffected. | high | 44 | Do in phases: readonly display first, then edit commands. |
| Wire inspector | Cable type, length, notes, fiber mode, hide label, play animation, multi-wire edit. | Production inspector reads Engine selection; wire commands are Engine-owned. | partial | `renderWireInspector`, `renderMultiWireInspector` at `8301fbf:index.html:50234`, `50300` | Engine selection/command sync in `productionBridge.js`; wire renderer in `renderer.js` | wire metadata, route points, hide label, fiber mode | Medium. | Inspector is production UI but must call Engine commands where needed. | Wire create/delete/rewire/route commands are one-step Engine commands. | Compatible. | Reports use production wire data. | medium | 44 | Ensure edits do not trigger full render. |
| Connector inspector | Shows connector/device/plug/name/direction/connected gear and jump/select actions. | Production inspector shows selection; Engine connector overlay handles selection. | partial | `renderConnectorInspector` at `8301fbf:index.html:50170` | Connector selection in `renderer.js` and `productionBridge.js` | connector fields, connected wire ID | Low renderer impact. | Medium UI impact. | Jump/select wire actions should sync Engine selection. | Compatible. | No direct output impact. | low | 44 | Good candidate for small early Inspector parity. |
| Canvas context menus | Device/rack/wire/corner/LED/library menus with edit, duplicate, lock, delete, corner actions, select same type. | Wire and rewire context actions restored; many object menus are delegated to production. | partial | `showDeviceContextMenu`, `showRackContextMenu`, `showWireContextMenu`, `showWireCornerContextMenu`, `showLibraryDeviceContextMenu` | `ProductionEngineBridge.handleContextMenu`, command sync paths | selected object IDs, wire IDs, route points, lock/favorite flags | Low render impact, high workflow impact. | Menus must call Engine commands or safe Legacy actions. | Must be one command per action. | Compatible if IDs stable. | Reports unaffected. | high | 40 | Recommended first: context menus expose many missing workflow actions with low visual risk. |
| Toolbar and top panels | Zoom, fit, snap/grid toggles, route mode, report/export, editor buttons, library split panes. | Production toolbar remains; Engine mode updates labels/HUD and command buttons. | partial | Main toolbar/panel code in `index.html` | Engine mode bootstrap and build label in `index.html`; HUD in `productionBridge.js` | app mode flags, project summary, snap/grid/wire mode | Low. | Medium: button state visual parity remains inconsistent. | Toolbar commands should route through Engine if canvas-mutating. | Compatible. | Report/export remain production. | medium | 50 | Do after core canvas actions; avoid cosmetic churn now. |
| Snap helpers and guides | Object alignment, spacing guides, orthogonal wire segment snap guides. | Engine restored orthogonal wire snap and object interactions; broader helper visuals need audit. | partial | `setSnapGuides`, `renderSnapGuides`, wire/object snap helpers | Engine routing and drag helpers in `src/engine/orthogonalRouting.js`, renderer guide paths | snap flags, guide coordinates | Medium. | UI toggles remain production. | No persistent undo unless snap changes final coords. | Compatible. | No report impact. | medium | 50 | Keep performance-sensitive; do not scan whole project per frame. |
| Favorites markers | Legacy star changed to orange circle in library. | Production library owns marker; Engine does not render library rows. | complete | Device library render functions | No Engine renderer ownership | favorite flags | None. | Production UI only. | Production-side template metadata. | Compatible. | None. | low | done | Keep delegated. |
| Report button and report modal | Report available in viewer and editor, reads project summary, devices, cables, pixels, matrices. | Production report remains. Engine data writes through to same model. | complete | report generation functions in current `index.html` | No Engine migration; validation checks production snapshot | project devices/wires/LED/matrix data | None. | Production modal remains. | Not an undo path. | Compatible. | Source of report output. | low | done | Only revisit after output renderer migration. |
| Standalone viewer/PDF visual output | Exported HTML/PDF use production/output code paths, not Engine canvas. | Engine edits should preserve data; viewer/PDF visual migration is paused. | delegated | export/report helpers in current `index.html` and `viewer.html` | Engine compatibility validations only | project snapshot JSON | High when migration resumes. | No editor UI. | Engine commands must not corrupt output data. | Compatible by design. | Direct output impact. | high | 51 | Do after visual parity of canvas objects stabilizes. |

## Phase Findings

### Phase 1 - Device Visual Fidelity

Engine device movement and selection are now fast enough to keep. The remaining
gap is not interaction speed; it is visual detail. The current texture builder
is intentionally simplified and should be expanded in place. Do not restore the
old full SVG DOM renderer for normal pan/zoom/drag.

Main Engine targets:

- Load real faceplate images into cached textures.
- Match Legacy name/category clipping and selected/hover outlines.
- Keep texture invalidation tied to visual changes only, not position or
  selection-only changes.

### Phase 2 - Faceplates And Project Custom Devices

Faceplates are the highest visual-risk item because user-created devices depend
on them. Project custom devices already drag/drop through Engine, but their
visual trust depends on accurate faceplate rendering.

Recommended order:

1. Faceplate image loading into Engine device textures.
2. Faceplate delete/resize/scale metadata invalidation.
3. Project Custom Devices thumbnail/placed-device consistency.

### Phase 3 - Modular Cards And Chassis

Cards are data-normalized in Engine, but the visual result is not yet Legacy
faithful enough for E2-style machines. The card pass should verify these fields
against Legacy:

- installed card type
- slot/card caption
- caption text/background color
- generated connector IDs
- per-slot connector overrides
- card lane height and node Y positions

### Phase 4 - Connectors And Node Visuals

Connector compatibility is strong after Iterations 36-38. The remaining work is
visual and inspector fidelity: connector fields, zoom simplification,
Powerlock/fiber colors, SFP/QSFP active module labels, and field hover/magnify
rules.

### Phase 5 - Editable Fields

Node fields should not become a new canvas DOM layer unless required. Prefer
Engine texture rendering plus inspector or editor-mediated edits. Field changes
must invalidate only the affected device texture.

### Phase 6 - Inspector Parity

Inspector parity should be restored in small readonly-to-editable steps. First
verify all display rows for device, connector, wire, rack, LED surface, area,
comment, title block, and jump node. Only then promote field edits into Engine
commands.

### Phase 7 - Power Distro And Power Visuals

PD faceplates need a dedicated pass because they combine SVG/image assets,
manual layout, collision warnings, Powerlock rules, and report/export concerns.
They should not be folded into generic faceplate work beyond the image-loading
infrastructure.

### Phase 8 - Adapters And Breakouts

Adapters are visually compact and should stay that way. Internal gradient wiring
and breakout multi-connections should be rendered as a small dedicated visual
system, not as full normal-device wires.

### Phase 9 - Context Menus And Actions

This is the safest next functional-interface pass. Most menus can remain
production-styled while their mutating actions call Engine commands. Restore
menus before building bigger custom panels so users can reach existing actions
in Engine mode.

### Phase 10 - Toolbar And Panels

Toolbar/panel polish should wait until core object visuals are stable. The
current production toolbar is acceptable as a control shell while the Engine
owns canvas editing.

## Engine Ownership Roadmap

| Recommended iteration | Focus | Reason |
| --- | --- | --- |
| 40 | Context menus and command routing audit | Many actions are reachable here with low renderer risk. |
| 41 | Modular cards/chassis visual parity | Card-heavy devices are central to the E2 workflow. |
| 42 | Faceplate image fidelity and Project Custom Devices | Real projects need accurate faceplates and custom device visuals. |
| 43 | Connector/node field visuals, SFP labels, Powerlock/fiber colors | Compatibility is restored; visuals need to catch up. |
| 44 | Inspector readonly parity, then editable command routing | Inspector trust is critical for field work. |
| 45 | Adapter/breakout internal visual wiring | Compact devices need their own simple visual rules. |
| 46 | Power Distro generated faceplates and plug SVG layout | Highest special-device visual complexity. |
| 47 | LED surfaces, image surfaces, and title block fidelity | Client-facing layout objects need closer visual output. |
| 48 | Rack Builder and rack instance parity | Larger workflow, best after device/card visuals stabilize. |
| 49 | Matrix routing UI parity | Important but less tied to canvas renderer speed. |
| 50 | Toolbar/panel polish and final UI pass | Do after high-risk model/render parity. |
| 51 | Viewer/PDF/report visual migration | Output should follow after editor visuals are reliable. |

## Diagnostic Notes

- Engine should continue to store project data in the existing production
  format. This keeps normal save/load, viewer, PDF, and report paths safe while
  the Engine renderer matures.
- Position-only changes must never invalidate device textures.
- Visual metadata changes should invalidate only affected templates/instances.
- Any Legacy menu delegated into Engine mode must either be read-only or call an
  Engine command for canvas-mutating work.
- Output parity should not be mixed into canvas interface parity. It needs a
  separate migration pass because PDF/viewer constraints are different from
  live WebGL/canvas rendering.
