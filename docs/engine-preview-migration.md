# Engine Preview Migration

Build: `iteration53-0-shared-engine-preview-foundation`

Iteration 53.0 introduces the reusable preview foundation only. Existing visible editor previews stay on their current SVG/DOM implementations until the follow-up migration iterations.

## Preview Foundation Contract

The shared preview surface lives in `src/engine/enginePreview.js`.

- Owns a private `SceneGraph`.
- Renders through `WebglGraphRenderer` with its own WebGL canvas and 2D label canvas.
- Uses `TextureCache`, `deviceVisualBuilder`, `deviceDefinitionV2`, `powerDistroModel`, `adapterMapping`, and `connectorDisplayLayout` through the same normalization/rendering path as the canvas.
- Accepts generic scene data: `{ devices, wires, racks, meta }`.
- Accepts draft devices and normalizes them via `normalizeAvDesignerDevice(...)`.
- Does not instantiate `ProductionEngineBridge`.
- Exposes full scene replacement, incremental `SceneGraph.replaceDevice(...)`, camera fit, coordinate transforms, connector/device hit testing, diagnostics, and `dispose()`.

## Preview Surface Inventory

| Surface | Current DOM | Current renderer/path | Migration notes |
| --- | --- | --- | --- |
| Device Editor main preview | `#deviceEditorPreview` | `renderDeviceEditorPreview()` rebuilds SVG nodes, faceplate, body, relationships, fields, marquee, and resize handles | 53.1 should mount `EnginePreviewSurface` behind the editor authoring overlay. Keep edit handles and inline fields in the overlay layer. |
| Device Editor connector preview | `#deviceEditorPreview` | `drawEditorConnectorRelationships()`, `drawEditorSharedRelationshipFields()`, connector SVG groups, editor hit handlers | Use Engine preview for device texture, connector labels, V2 both-side anchors, shared-bus packing, through arrows, and adapter internals. Keep connector drag/drop and field controls in the authoring overlay. |
| Device Editor faceplate preview | `#deviceEditorFaceplatePreview` in `#editorFaceplatePreviewWrap` | `renderEditorFaceplatePreview()` and power-plug guide/resize SVG helpers | Use Engine preview when the faceplate is just a visual surface; retain direct authoring handles for image/power-plug resize and crop controls. |
| Device Editor card preview | `#deviceEditorPreview` | `renderCardEditorPreview()` uses SVG card bands and connector rows | Normalize a synthetic modular device/card draft through the preview adapter. Keep card-slot editing controls in overlay DOM. |
| Device Editor slots preview | `#deviceEditorPreview` | `drawEditorCardSlotBands()`, generated card connector rendering | Engine preview can show installed-card visuals. Slot selection, resize, and drop state should remain overlay-owned. |
| Device Editor defaults tab preview | `#deviceEditorPreview` | Shares `renderDeviceEditorPreview()` | Use the same draft preview as the device/connectors tab, but preserve Defaults save semantics separately from Project Custom semantics. |
| Power Distribution editor preview | `#deviceEditorPreview` and `#deviceEditorFaceplatePreview` | `drawPowerDistroFaceplate()`, `drawEditorPowerPlugGuides()`, `drawEditorPowerPlugMarquee()` | Engine preview should render generated power-plug faceplates. Manual plug drag/resize handles remain overlay-owned. |
| Adapter / Breakout editor preview | `#deviceEditorPreview` | `isAdapterTemplate()`, `drawAdapterInternalWires()`, adapter body styling | Engine preview should render the dashed legacy adapter shell and internal fan-in/fan-out wiring from `adapterMapping`. |
| Rack Builder preview | `#rackBuilderPreview` | `renderRackBuilderPreview()`, `drawRackPreviewDevice()`, `renderRackBuilderInternalWires()`, rack pan/zoom and drag/drop handlers | 53.x follow-up should render rack contents through the shared Engine surface while keeping rack authoring selection, expose-port toggles, and drag handles in the overlay. |
| Rack internal wire preview | `#rackBuilderPreview` | `renderRackBuilderPreviewWire()` and internal connection SVG paths | Use Engine scene data with rack-internal wires forced orthogonal by `SceneGraph`/wire normalization. |
| Node Builder crop preview | `.node-crop-preview` | Inline DOM/CSS sample and crop controls | This is a node asset authoring surface, not a full device scene. It may stay DOM based unless connector glyph rendering is centralized later. |
| Title Block editor preview | `#titleBlockPreview` | `renderTitleBlockPreview()` with `drawTitleBlock(...)` | The title block is a canvas object and can be rendered through Engine preview once title-block authoring controls are moved into the overlay. |
| Canvas wire placement preview | `#previewWire`, `#previewMultiWires` | SVG paths driven by connection drag state | Not part of editor preview migration. It should remain production interaction overlay unless a later Engine overlay migration is requested. |
| Canvas comment placement preview | `#previewCommentLine` | SVG leader path while placing comments | Not part of 53.x editor previews. |
| Canvas area placement preview | `#previewAreaRect` | SVG rectangle while placing areas | Not part of 53.x editor previews. |
| Canvas title-block placement preview | `#previewTitleBlockRect` | SVG rectangle while placing title blocks | Not part of 53.x editor previews. |
| Export/report/viewer clones | Snapshot/export clone cleanup around `clone.querySelectorAll(...)` | Uses cloned production SVG/DOM output | Do not route through the preview harness. Output parity remains covered by the output pipeline. |

## Layer Model

Each shared preview surface creates:

- `.engine-preview-webgl`: WebGL device/wire/rack texture and geometry layer.
- `.engine-preview-labels`: 2D label/info-box layer owned by `WebglGraphRenderer`.
- `.engine-preview-authoring-overlay`: DOM overlay reserved for editor-specific controls, drag targets, resize handles, and text inputs.

The renderer owns visual parity. Editors own authoring affordances.

## Fixture Coverage

`engine-preview-harness.html` and `src/engine/enginePreviewFixtures.js` cover:

- Normal device with PNG faceplate.
- V2 connector displayed on both sides.
- Shared-bus connectors packed by `connectorDisplayLayout`.
- Through/loop connector relationship.
- Modular chassis with installed card connectors.
- Power Distribution generated faceplate/plugs.
- Adapter / Breakout internal wiring.

## Diagnostics

The shared foundation reports diagnostics through `enginePreviewDiagnostics(surface)` and the debug harness. The report includes:

- Active preview surface count.
- Created/disposed preview counts.
- GL context create/dispose counts.
- Asset-ready subscriber count.
- Camera, viewport, DPR.
- Texture stats.
- Shared-bus layout stats.
- Adapter and Power Distribution diagnostics.

## Migration Guardrails

- Do not construct `ProductionEngineBridge` inside any editor preview.
- Do not duplicate legacy drawing logic into new preview surfaces.
- Normalize draft devices through `normalizeAvDesignerDevice(...)` so master drafts and Project Custom drafts follow the same rules as placed canvas devices.
- Keep authoring-only UI in the overlay layer.
- Always dispose preview surfaces when an editor modal/page is destroyed or remounted.
