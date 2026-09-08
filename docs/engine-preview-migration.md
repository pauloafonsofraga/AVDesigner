# Engine Preview Migration

Build: `iteration53-1-device-editor-engine-preview`

Iteration 53.1 migrates the Engine-mode Device Editor preview onto the shared Engine preview foundation introduced in 53.0. In Engine mode, the center preview uses `EnginePreviewSurface`, `SceneGraph`, `WebglGraphRenderer`, `TextureCache`, and the normal device visual pipeline. The Device Editor SVG/DOM layer is now reserved for authoring affordances such as hit targets, selections, empty slots, resize handles, guides, and marquees.

Legacy mode (`?legacy=1`) continues to use the existing SVG Device Editor preview.

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
| Device Editor main preview | `#deviceEditorPreview` inside `.engine-preview-authoring-overlay` | `renderDeviceEditorPreview()` now coordinates a persistent `EnginePreviewSurface` in Engine mode | Migrated. Device body, title, faceplate, connector labels, fields, relationships, power distro visuals, adapter internals, and cards come from Engine. The SVG layer draws authoring controls only. |
| Device Editor connector preview | `#deviceEditorPreview` | Engine connector geometry from `connectorDisplayLayout` and `EnginePreviewSurface.connectorEntries()`; authoring hit/selection overlay remains SVG | Migrated. Click, Shift-click, marquee, connector drag, empty slots, and node drop target the Engine-rendered connector anchors. Both-side anchors map to one logical connector. |
| Device Editor faceplate preview | `#deviceEditorPreview` | Engine device texture plus shared faceplate geometry helpers from `faceplateGeometry.js` / `deviceVisualBuilder.js` | Migrated. Actual shell/image/scale/offset are Engine-rendered; resize and movement handles are authoring overlay. The older `#deviceEditorFaceplatePreview` path is not used for Engine visual output. |
| Device Editor card preview | `#deviceEditorPreview` | Engine device/card texture and generated connector rendering | Migrated. Authoring overlays remain for selection and slot/card controls. |
| Device Editor slots preview | `#deviceEditorPreview` | Engine installed-card visual with overlay slot boundaries and drop targets | Migrated. Empty authoring slots remain overlay-only and are not production device visuals. |
| Device Editor defaults tab preview | `#deviceEditorPreview` | Same persistent Device Editor `EnginePreviewSurface` | Migrated. Defaults semantics remain separate from visual rendering. |
| Power Distribution editor preview | `#deviceEditorPreview` | Engine generated power distro faceplate and plug visuals | Migrated. Plug selection, guides, marquee, and drag handles remain overlay-only. |
| Adapter / Breakout editor preview | `#deviceEditorPreview` | Engine adapter rendering from `adapterMapping` and the normal visual builder | Migrated. Dashed shell, compact adapter body, and internal fan-in/fan-out paths come from Engine. |
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

The shared foundation reports diagnostics through `enginePreviewDiagnostics(surface)`, the debug harness, and the Engine-mode Device Editor debug panel. The report includes:

- Active preview surface count.
- Created/disposed preview counts.
- GL context create/dispose counts.
- Asset-ready subscriber count.
- Camera, viewport, DPR.
- Texture stats.
- Full scene replacement count.
- Incremental device replacement count.
- Rendered preview frame count.
- Device Editor preview source.
- Device Editor legacy actual-device visual draw count.
- Device Editor authoring overlay draw count.
- Shared-bus layout stats.
- Adapter and Power Distribution diagnostics.

In Engine mode, the Device Editor preview source should read `EnginePreviewSurface` and the legacy actual-device visual draw count should remain `0` for Device, Connectors, Faceplate, Cards, Slots, Defaults, Power Distro, and Adapter/Breakout previews.

## Migration Guardrails

- Do not construct `ProductionEngineBridge` inside any editor preview.
- Do not duplicate legacy drawing logic into new preview surfaces.
- Normalize draft devices through `normalizeAvDesignerDevice(...)` so master drafts and Project Custom drafts follow the same rules as placed canvas devices.
- Keep authoring-only UI in the overlay layer.
- Always dispose preview surfaces when an editor modal/page is destroyed or remounted.

## Remaining Preview Migrations

The remaining shared-preview migrations are deliberately outside 53.1:

- Rack Builder preview and rack-internal wire authoring.
- Node Builder/crop previews and small connector catalogue previews.
- Title Block and other minor object previews.
- Export/report/viewer rendering paths.
