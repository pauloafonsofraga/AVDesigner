# Engine Preview Migration

Build: `iteration53-3-remaining-editor-engine-previews`

Iterations 53.1 and 53.2 migrate Engine-mode Device Editor and Rack Builder previews onto the shared Engine preview foundation introduced in 53.0. Iteration 53.3 audits the remaining persistent editor previews and migrates the remaining production-appearance previews. In Engine mode, production preview visuals use `EnginePreviewSurface`, `SceneGraph`, `WebglGraphRenderer`, `TextureCache`, and the normal device/canvas-object visual pipeline. SVG/DOM layers remain reserved for authoring affordances such as hit targets, selections, temporary drag/wire previews, empty slots, resize handles, guides, crop controls, and marquees.

Legacy mode (`?legacy=1`) continues to use the existing SVG/DOM editor previews.

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

| Preview | Purpose | Current renderer | Production visual? | Engine migration needed? | 53.3 action |
| --- | --- | --- | --- | --- | --- |
| Device Editor main/device appearance | Production appearance | `EnginePreviewSurface` in Engine mode; SVG in Legacy mode | Yes | No | Protect with regression smoke. |
| Device Editor connectors/fields/relationships | Production appearance plus authoring overlay | Engine connector geometry and labels; SVG hit targets/handles | Yes | No | Protect connector hit testing and Both-side anchors. |
| Device Editor faceplate preview | Production appearance plus crop/resize authoring overlay | Engine device texture and faceplate geometry | Yes | No | Protect async faceplate invalidation. |
| Device Editor card/slot/defaults previews | Production appearance plus authoring overlay | Engine device/card texture; SVG empty slots/drop targets | Yes | No | Protect card and slot interaction overlays. |
| Power Distribution editor preview | Production appearance plus authoring overlay | Engine generated power-distro texture and plug assets | Yes | No | Protect generated plug visuals. |
| Adapter / Breakout editor preview | Production appearance | Engine adapter visual builder and `adapterMapping` | Yes | No | Protect special adapter rendering. |
| Rack Builder preview | Production appearance plus authoring overlay | `EnginePreviewSurface` via `src/engine/rackPreview.js`; SVG overlay | Yes | No | Protect child/internal-wire/exposed-port parity. |
| Rack internal wires | Production appearance plus route authoring overlay | Engine rack-internal wires; SVG route handles | Yes | No | Protect orthogonal internal routing. |
| Node Builder thumbnail crop | Authoring-only | DOM/CSS crop panel and `#nodeThumbnailCanvas` | No | No | Keep as crop/asset authoring UI. |
| Node Builder catalogue rows/cards | Catalogue thumbnail/list UI | DOM `.node-library-item`, `.node-chip`, thumbnail `<img>` | No | No | Keep as searchable/reorderable catalogue UI. |
| Node Builder connector swatch/color chip | Catalogue metadata display | DOM gradient from `cableTypeSwatchValue(...)` | No | No | Keep as compact metadata UI. |
| Node Builder uploaded connector artwork thumbnail | Catalogue asset preview | `#nodeThumbnailCanvas` and list `<img>` | No | No | Keep separate from Engine connector rendering. |
| Node Builder canvas appearance sample | Production appearance | `EnginePreviewSurface` via `src/engine/nodePreview.js` | Yes | No | Migrated in 53.3 with compact synthetic Engine device preview and one real connector. |
| Title Block editor preview | Production appearance | `EnginePreviewSurface` via `src/engine/titleBlockPreview.js`; SVG in Legacy mode | Yes | No | Migrated in 53.3 using `normalizeEngineCanvasObject("title-block", ...)`. |
| Title Block logo/file input thumbnail behavior | Form/media authoring | DOM file input; title-block draft fields | No by itself | No | Preserve as form state feeding the Engine preview. |
| Canvas wire placement preview | Transient interaction | `#previewWire`, `#previewMultiWires` SVG paths | No | No | Leave untouched. |
| Canvas comment placement preview | Transient interaction | `#previewCommentLine` SVG leader | No | No | Leave untouched. |
| Canvas area placement preview | Transient interaction | `#previewAreaRect` SVG rectangle | No | No | Leave untouched. |
| Canvas title-block placement preview | Transient interaction | `#previewTitleBlockRect` SVG rectangle | No | No | Leave untouched. |
| Report/export/viewer previews and clones | Output/report | Output snapshot/SVG clone paths | No for editor preview scope | No | Leave untouched. |

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
- Device Editor and Rack Builder preview sources.
- Active preview owner rows (`device-editor`, `rack-builder`, `node-builder`, `title-block`).
- Device Editor and Rack Builder legacy actual-device visual draw counts.
- Device Editor and Rack Builder authoring overlay draw counts.
- Shared-bus layout stats.
- Adapter and Power Distribution diagnostics.

In Engine mode, Device Editor, Rack Builder, Node Builder Canvas Appearance, and Title Block preview sources should read `EnginePreviewSurface`. The legacy actual-device visual draw count should remain `0` for Device, Connectors, Faceplate, Cards, Slots, Defaults, Power Distro, Adapter/Breakout, Rack Builder committed visuals, Node Builder Canvas Appearance, and Title Block committed visuals.

## Rack Builder Preview Adapter

`src/engine/rackPreview.js` converts the selected rack draft into a temporary Engine scene:

- Each rack definition child keeps a stable `sourceRackDeviceId` and receives a deterministic preview child ID from the rack ID and child ID. Array order is not part of identity.
- The temporary placed rack uses `canvasInstance: true`, `hidden: true`, `showInternalWiring: true`, and `sourceDeviceMap` so the same rack frame, connector visibility, and internal wire normalization path is used by preview and placed canvas racks.
- Internal rack connections become Engine rack-internal wires and are forced orthogonal. Pan, zoom, and Fit update only the preview camera.
- Device drags update only affected preview children and connected rack-internal wires. Selection, hover, drop ghost, snap guide, marquee, and temporary wire drawing update only the SVG authoring overlay.
- Inside Rack Builder, internal-only connectors are visible and authorable. After placement, only connectors marked as exposed rack ports are selectable externally; internal-only connectors remain reference-only when internal wiring is shown.

## Node Builder Preview Adapter

`src/engine/nodePreview.js` converts the selected connector catalogue draft into a temporary Engine scene:

- The Node Builder remains the global connector catalogue/editor. It owns connector labels, colors, segmented colors, thumbnails, direction metadata, video flag metadata, and catalogue ordering.
- The thumbnail crop panel remains a DOM/canvas authoring tool. It decides which pixels of uploaded artwork become the catalogue thumbnail; it is not an alternate production connector renderer.
- The Canvas Appearance panel creates one synthetic neutral device with one representative connector attached to a real device edge. That synthetic device is isolated to the preview scene and never mutates the project canvas, Project Devices, wires, or the master device list.
- The synthetic device is normalized through `normalizeAvDesignerDevice(...)` and rendered by `EnginePreviewSurface`, so connector color, segmented Powerlock rendering, SFP/QSFP effective types, fiber-mode color, radius, stroke, labels, and info fields use the production Engine path.
- The modal creates one preview surface per open session. Selecting another connector type or editing its color/name/metadata replaces the preview device inside the same surface; closing, cancelling, or applying disposes the surface.

## Title Block Preview Adapter

`src/engine/titleBlockPreview.js` converts the editor draft into a temporary Engine title-block object:

- The draft is normalized through `normalizeEngineCanvasObject("title-block", ...)`.
- The visual layers are rendered by `EnginePreviewSurface` through the same title-block path used by the canvas.
- Form controls and file inputs remain DOM. The old `#titleBlockPreview` SVG is retained as an authoring overlay/fallback and as the Legacy-mode preview target.
- The transient placement rectangle `#previewTitleBlockRect` remains untouched because it is an interaction preview, not a persistent editor production visual.

## Migration Guardrails

- Do not construct `ProductionEngineBridge` inside any editor preview.
- Do not duplicate legacy drawing logic into new preview surfaces.
- Normalize draft devices through `normalizeAvDesignerDevice(...)` so master drafts and Project Custom drafts follow the same rules as placed canvas devices.
- Keep authoring-only UI in the overlay layer.
- Always dispose preview surfaces when an editor modal/page is destroyed or remounted.

## Remaining Preview Work

After 53.3, the remaining preview work is 53.4 cleanup/parity audit:

- Remove or isolate dead Legacy preview drawing code that is no longer reachable in Engine mode.
- Re-audit cross-editor parity after enough hands-on use.
- Keep output/report/viewer rendering out of this migration unless a separate output-pipeline task requests it.
