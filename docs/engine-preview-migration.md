# Engine Preview Migration

Build: `iteration53-4-preview-parity-cleanup`

Iteration 53.4 is the final preview-migration audit. Persistent Engine-mode production-appearance editor previews now route through the shared Engine renderer stack: `EnginePreviewSurface`, `SceneGraph`, `WebglGraphRenderer`, `TextureCache`, `projectAdapter`, `deviceVisualBuilder`, `connectorDisplayLayout`, `faceplateGeometry`, `rackPreview`, `nodePreview`, and `titleBlockPreview`.

Legacy mode (`?legacy=1`) keeps the old SVG/DOM preview renderers. SVG/DOM also remains correct for authoring overlays, crop tools, transient canvas previews, and output/report/viewer paths. The migration target is production artwork inside persistent Engine-mode editor previews, not every visual DOM element in the app.

## Final Ownership Matrix

| Surface | Engine-mode production visual | Engine-mode authoring overlay | Legacy-mode visual | Current duplicate/dead code |
| ------- | ----------------------------- | ----------------------------- | ------------------ | --------------------------- |
| Device Editor device body | `EnginePreviewSurface` renders a draft normalized by `createPreviewDeviceFromDraft(...)` and `normalizeAvDesignerDevice(...)`. | `#deviceEditorPreview` is mounted inside `.engine-preview-authoring-overlay` for body hit target, selection, resize, marquee, and drag handles. | `renderDeviceEditorPreview(...)` SVG branch when `?legacy=1`. | No Engine-mode duplicate: Engine branch returns before `editorEnginePreviewLegacyVisualDraws += 1`. |
| Device Editor connectors | `SceneGraph` connector layout and `WebglGraphRenderer` live connector/label layers. | SVG connector hit circles, remove button, misc swatch, selected-node halo, empty slot targets. | Legacy SVG connector drawing in `renderDeviceEditorPreview(...)`. | No production duplicate; overlays derive from `EnginePreviewSurface.connectorEntries(...)` where available. |
| Faceplate | `deviceVisualBuilder.drawFaceplate(...)` and `faceplateGeometry.js` inside the Engine texture. | Face image resize handles, Power Distro faceplate resize handles, power plug marquee. | Legacy SVG image/default/Power Distro faceplate branch. | Separate `renderEditorFaceplatePreview(...)` is disabled in Engine mode by `canShowEditorFaceplatePreview(...)`. |
| Cards | `deviceVisualBuilder.drawCardAreas(...)` plus Engine live connector labels/fields. | Slot hit rectangles, remove controls, drop targets, selected slot affordance. | Legacy SVG card/slot preview branches. | No Engine-mode duplicate for card production body; Card Editor single-card authoring preview remains Legacy UI. |
| Slots | Engine device texture reflects slot/card band geometry through normalized visual cards. | Empty slot/drop targets and slot resize/reorder controls. | Legacy SVG slot/card branch. | No Engine-mode duplicate for the full device preview. |
| Power Distro | `powerDistroModel.js` and `deviceVisualBuilder.drawPowerDistroFaceplate(...)` render plug assets in the Engine texture. | Plug drag targets, faceplate resize handles, plug marquee and guides. | Legacy SVG `drawPowerDistroFaceplate(...)` for `?legacy=1`, thumbnails, and output clones. | No Engine-mode hidden production faceplate; overlay only remains. |
| Adapter / Breakout | `adapterMapping.js` and `deviceVisualBuilder.drawAdapterVisual(...)` render shell and internal gradient branches. | Connector hit/selection overlay. | Legacy SVG adapter branch and output/export clone helpers. | No Engine-mode duplicate; editor overlay does not redraw the adapter body/internal paths. |
| Rack Builder | `EnginePreviewSurface` renders `createRackPreviewScene(...)` normalized through `normalizeAvDesignerProject(...)`. | SVG device hit rectangles, connector exposure rings, route handles, drop ghost, snap guides, marquee. | Legacy SVG Rack Builder branch. | No Engine-mode duplicate: `renderRackBuilderPreview(...)` returns before `renderRackBuilderInternalWires(...)` and `drawRackPreviewDevice(...)`; `drawRackPreviewDevice(...)` retains a diagnostic tripwire. |
| Rack internal wires | Engine rack-internal wires normalized as `internalRackWire` and forced orthogonal in `SceneGraph`. | Selected route segment/corner handles and temporary rack wire preview. | `renderRackBuilderInternalWires(...)` in Legacy mode. | No committed Engine-mode SVG wire duplicate; `renderRackBuilderPreviewWire(...)` is transient authoring only. |
| Node Builder crop | Not an Engine production visual. | DOM crop canvas and controls author catalogue thumbnail pixels. | Same DOM crop UI. | Intentionally excluded from preview migration. |
| Node Builder Canvas Appearance | `src/engine/nodePreview.js` builds one synthetic Engine device and renders it with `EnginePreviewSurface`. | None beyond the preview host itself. | No persistent production fallback in Engine mode. | No duplicate production renderer. |
| Title Block | `src/engine/titleBlockPreview.js` normalizes a draft with `normalizeEngineCanvasObject("title-block", ...)` and renders with `EnginePreviewSurface`. | DOM form/file controls; SVG host remains fallback/overlay target. | `drawTitleBlock(...)` SVG branch when `?legacy=1`. | No Engine-mode duplicate: Engine branch clears the SVG and returns before `titleBlockEnginePreviewLegacyVisualDraws += 1`. |
| Transient canvas previews | Not persistent production previews. | `#previewWire`, `#previewMultiWires`, `#previewCommentLine`, `#previewAreaRect`, `#previewTitleBlockRect`. | Same transient interaction surfaces. | Intentionally untouched. |
| Output/report/viewer paths | Out of scope for Iteration 53.4. | Output-specific controls remain production DOM. | Existing output/SVG clone renderers remain. | Intentionally untouched; no output migration in 53.4. |

## Old Preview Helper Classification

| Category | Meaning | Current helpers |
| --- | --- | --- |
| A | Still required by Legacy mode | Legacy branches in `renderDeviceEditorPreview(...)`, `renderRackBuilderPreview(...)`, `renderTitleBlockPreview(...)`, `renderCardEditorPreview(...)`, `drawRackPreviewDevice(...)`, `renderRackBuilderInternalWires(...)`, `drawEditorConnectorRelationships(...)`, `drawEditorSharedRelationshipFields(...)`, `drawAdapterInternalWires(...)`, and `drawPowerDistroFaceplate(...)`. |
| B | Still required as Engine authoring overlay | `drawEditorEngineFaceplateOverlay(...)`, `drawEditorEnginePowerPlugOverlay(...)`, `drawEditorEngineCardSlotOverlay(...)`, `drawEditorEngineConnectorOverlay(...)`, `drawRackBuilderEngineDeviceOverlay(...)`, `drawRackBuilderEngineConnectorOverlay(...)`, `drawRackBuilderEngineInternalWireHandles(...)`, `renderRackBuilderPreviewWire(...)`, marquee/snap/resize helpers, and Node crop controls. |
| C | Shared helper still required by both | `connectorDisplayLayout.js`, `deviceDefinitionV2.js`, `faceplateGeometry.js`, `adapterMapping.js`, `powerDistroModel.js`, `projectAdapter.js`, `sceneGraph.js`, `deviceVisualBuilder.js`, `renderer.js`, and `textureCache.js`. |
| D | Dead/unreachable after Engine preview migration | No safe deletion candidates were found in 53.4. Former duplicate paths are either Legacy-only, authoring overlays, shared helpers, transient previews, or output/report/viewer code. |

## Final Architecture

```text
                         SHARED ENGINE RENDERER
                                  |
              +-------------------+--------------------+
              |                   |                    |
              v                   v                    v
         Main Canvas        Device Editor        Rack Builder
                                  |
                     +------------+------------+
                     v                         v
              Node Appearance            Title Block

DOM/SVG overlays = authoring controls only
Legacy SVG previews = ?legacy=1 compatibility only
Output/report/viewer = separate output pipeline
```

## Diagnostics And Guardrails

`enginePreviewDiagnostics(surface)` now exposes a final ownership audit with the supported persistent Engine preview owners:

- `device-editor`
- `rack-builder`
- `node-builder`
- `title-block`

For those surfaces, Engine-mode production visuals should report `EnginePreviewSurface`. Legacy production draw counters should remain `0` in Engine mode for Device Editor, Faceplate, Connectors, Cards, Slots, Power Distro, Adapter/Breakout, Rack Builder committed visuals, Node Builder Canvas Appearance, and Title Block.

`scripts/preview-ownership-validation.mjs` verifies:

- all current preview build IDs equal `iteration53-4-preview-parity-cleanup`;
- Engine dynamic imports carry the 53.4 module cache key while preserving the visible build ID;
- the final ownership map includes all four persistent Engine preview owners;
- Node crop, transient canvas previews, output/report/viewer paths, and Legacy mode are explicitly excluded;
- Engine branches in `index.html` return before Legacy production drawing;
- Device Editor faceplate side-preview is disabled in Engine mode;
- Node Builder Canvas Appearance has no retained Engine-mode legacy production draw counter.

## Parity Coverage

`engine-preview-harness.html` and `src/engine/enginePreviewFixtures.js` cover:

- normal PNG faceplate device;
- V2 connector displayed on both sides;
- shared-bus connectors with 2, 3, and 4 member packing;
- Through/Loop relationship arrow geometry;
- modular chassis with installed-card connectors;
- Power Distribution generated faceplate/plugs;
- Adapter / Breakout compact shell and internal wiring.

`scripts/rack-preview-validation.mjs` verifies Rack Builder preview vs placed-rack translation, exposed rack ports, internal rack wires, and forced orthogonal routing. `scripts/node-preview-validation.mjs` verifies representative connector types, SFP/QSFP effective modules, fiber mode, and PowerLock segmented colors. `scripts/title-block-preview-validation.mjs` verifies Title Block preview normalization and visual cache-key invalidation, including logo fields.

## Performance Baseline

- Camera-only pan/zoom/Fit/resize use `EnginePreviewSurface.setCamera(...)`, `fitToContent(...)`, and `resize(...)`; they do not call `setSceneData(...)`, do not create new GL contexts, and do not rebuild textures solely due to camera changes.
- Device Editor connector drag refreshes the current preview device without refreshing the texture while the node is moving.
- Rack child drag updates only dirty preview children and affected internal rack wires when the structural signature is unchanged.
- Node type switching keeps one `node-builder` surface and replaces one synthetic preview device.
- Title Block typing keeps one `title-block` surface and replaces the title-block object texture only when field/logo data changes.

## Intentionally Non-Engine Preview Surfaces

The following remain intentionally outside persistent Engine production preview ownership:

- Node Builder thumbnail crop canvas.
- Main-canvas transient placement previews: `#previewWire`, `#previewMultiWires`, `#previewCommentLine`, `#previewAreaRect`, `#previewTitleBlockRect`.
- Output/report/viewer renderers and SVG clone paths.
- Legacy `?legacy=1` editor previews.

## Final Status

PREVIEW MIGRATION COMPLETE for persistent Engine-mode production-appearance editor previews: Device Editor, Rack Builder, Node Builder Canvas Appearance, and Title Block Editor.
