# Project Layers and Venue References

Engine-only. The Layers panel sits below the Inspector. Drag its horizontal divider
to resize the two panes. The splitter height is a local browser preference.

- Add layers with the plus icon; edit their names inline.
- The list is front-to-back, with the top row drawn last. Drag rows or use the
  arrow controls to reorder them. Drag cancellation leaves the project unchanged.
- The eye controls visibility; the lock prevents canvas editing. Neither changes
  connector identities, wiring, Jump pairs, Loom membership or Multi-Core topology.
- Select canvas objects, then use Selection layer to assign them. New objects use
  the active editable layer. Rack children and Multi-Core projections follow their
  owning object. Existing unassigned objects belong to Default.
- Deleting a non-default layer asks for confirmation and moves its objects to
  Default rather than deleting them or their connections. Default can be renamed,
  hidden, locked and reordered, but not deleted.
- Import venue layouts with the image icon. PNG bytes are retained. PDFs use the
  pinned, locally bundled PDF.js renderer and an explicit page chooser. A chosen
  page is embedded as PNG; PDF rendering is capped at 4096 pixels per side and
  16 million pixels. The source PDF is not embedded.
- Reference images reuse Engine image objects and movement/resize handling. The
  Inspector provides position, uniform scale, width/height, rotation and opacity.
  Zero opacity is supported. Backdrop images sit behind wiring within their layer.

Layers use optional project `layers` records, optional `activeLayerId`, and an
optional `layerId` on canvas records. Old projects need no migration and retain
their existing ordering until layers are used. Layer order, membership and image
properties save with the project. Changing only the active layer does not make a
project dirty. Layer operations participate in Engine undo/redo without changing
the viewport. A failed or canceled import creates no project object or history entry.

The complete topology remains in SceneGraph and the canonical output contract.
Rendering and hit testing apply layer visibility separately. Engine, offline HTML
and vector PDF share that presentation; hidden objects do not enlarge fit/export
bounds. Read-only viewers may inspect locked objects. Legacy is unchanged.

Validation: `node --test test/projectLayers.test.mjs` and, with a local server,
`AVDESIGNER_BASE_URL=http://127.0.0.1:8790 node scripts/project-layers-smoke.mjs`.
Regenerate the pinned PDF import assets with `npm run build:reference-pdf`.
