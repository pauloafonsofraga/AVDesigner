# Selectable Projector Lenses

Build 54.36.0 adds template `isProjector` and `projectorLenses: [{id, name}]`,
plus instance `selectedProjectorLensId`. Names are trimmed, not used as identity.
Missing template metadata defaults to false/empty; no saved-version migration.

`projectorModelCore.js` owns pure normalization, insertion and selection fallback.
Its small classic-script wrapper supports the existing synchronous editor;
`projectorModel.js` exposes the same implementation to Engine modules and the
offline bundle. It never modifies input templates or instances. Invalid/empty
selections resolve to the first nonempty lens; no choices resolve to an empty ID.
Disabling the projector retains its lens records and hides the subtitle/control.

The Device Editor keeps IDs during edits and inserts after the clicked row.
Hydration, creation and clipboard paste persist resolved instance selections.
The canvas dropdown uses `commitObjectInspectorFields`, including normal dirty
texture updates and one command per change. Undo/redo restores both the source
instance ID and resolved visual metadata. Template-level Apply refreshes affected
instances without regenerating their geometry.

`projectAdapter` and `SceneGraph` carry resolved projector metadata into the
canonical output scene. `deviceVisualBuilder` draws one smaller subtitle in the
existing header gap and keys textures by selected ID and resolved name. No
dimensions, anchors, faceplate or card coordinates change. Non-projector drawing
commands are unchanged. HTML/Publish and vector PDF reuse this builder; there is
no separate projector output renderer or clipboard asset entry.

## Verification

- `node --test test/projectorLenses.test.mjs`: pure IDs/fallback, insertion,
  scene/cache/geometry parity, unchanged non-projector artwork, HTML/Publish/PDF
  parity and compact JSON clipboard round trips.
- `node scripts/projector-lenses-smoke.mjs`: real editor controls, canvas Lens
  selection, undo/redo, instance Apply, Save As/reload, native cross-tab clipboard,
  downloaded offline HTML and generated PDF. Template-level authoring is opened
  through its application entry point; the test uses real input/Apply controls.
- Existing Device Editor, clipboard, Engine/Legacy identity and output smoke
  suites remain regression coverage for unchanged behavior.

The smoke script accepts the existing `AVDESIGNER_BASE_URL`,
`AVDESIGNER_PLAYWRIGHT_PATH`, `AVDESIGNER_CHROME_PATH`, and
`AVDESIGNER_SCREENSHOT_DIR` environment variables. Artifacts default to `/tmp`.
