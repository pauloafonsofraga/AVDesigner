# Passive Stageboxes and Snakes

The Engine Device Editor's first **Device** tab has **Is a Stagebox / Snake**.
This is explicitly for passive assemblies. Manufacturer, name, category and
connector types never infer this flag; powered/intelligent products such as
Yamaha Rio remain ordinary devices unless deliberately reclassified by an author.
Manufacturer-built and warehouse-made devices use the same model; blank Brand
and custom connector definitions remain supported.

## Definition model

```json
{
  "id": "my-passive-snake",
  "isStageboxSnake": true,
  "powerWatts": 0,
  "stageboxSnake": {
    "version": 1,
    "ends": [
      { "id": "end-a", "name": "End A", "connectorIds": [] },
      { "id": "end-b", "name": "End B", "connectorIds": [] }
    ]
  }
}
```

End identities are local to the parent device, not additional devices or paired
templates. Names, connector associations and optional metadata belong independently
to each end. Sorting or renaming an end never changes its identity. Explicit
connector references must exist and belong to no more than one end. Unassigned
connectors are allowed; input/output direction does not infer physical end or
channel mapping. The existing connector array remains the authoritative geometry.

Enabling fixes power to zero and disables W/A editing. Normalization, personal
library persistence and power reporting also enforce zero, including old instance
power overrides. Disabling restores editable controls without inventing a previous
power value; authored ends remain available for re-enabling. Undo restores the
prior draft, including its previous power value, in the existing editor history.

**Audio > Stageboxes & Snakes** filters explicitly flagged passive definitions,
without rewriting their existing authored categories. The existing **Stageboxes**
category is retained. No factory catalogue entry is automatically reclassified.

## Compatibility and boundaries

The metadata is additive: no project/library format bump or migration. Existing
unflagged definitions normalize unchanged. Personal/default configurations,
portable `.wnx` packages and project save/reopen retain the flag and ends. Custom
node dependencies, artwork, card slots, device IDs and cable endpoints are not
rewritten. The community package validator is regenerated from the shared model.

Canvas geometry and rendering remain unchanged; the two ends do not create
additional canvas devices or physical cables. Channel mappings are configuration
metadata, not new Signal Chain traversal or Cable Schedule entries. The new
authoring controls are hidden outside Engine mode.

## Phase 2: Two-ended editor

The Connectors and Faceplate workflows expose an **End A / End B** selector.
Each end has its own label, width, height, connector positions/anchors, optional
artwork and artwork transforms. Existing connector editing, placement, resizing,
shared-bus controls and image uploads are reused through detached end drafts.
The parent's normal canvas dimensions, artwork and existing connector geometry
are not replaced by the selected end's preview.

End representations are `rectangle`, `circular` and `fanout`. Without uploaded
artwork, the editor, canvas and exports render a shared schematic: a balanced
grid, concentric rings or outward-facing colored cable tails. The nominal
schematic size is 570 x 150 before fitting the available space. At most 100
schematic dots are drawn per end; this never limits live connectors or cables.

New connectors belong to the selected end, with IDs reserved across the device.
Existing assignments are honored, with previously unassigned ports editable on
End A to match their canvas location. Ownership does not create channel mappings.
Stored mappings remain intact, and the editor protects mapped connectors from
removal. Representation changes do not affect connector IDs, types, anchor
geometry or compatibility.

Each end extends the existing version-1 record with `width`, `height`,
`representation`, `connectorLayout` (geometry keyed by canonical connector ID),
and `artwork` (the existing ordinary image/transform fields). Connector types
remain canonical and cannot be overridden by a layout record. Dimensions and
layout do not have to match between ends.

`stageboxSnake.channels` is an ordered array, for example:

```json
[
  { "id": "channel-1", "name": "Audio 1",
    "a": { "connectorId": "multipin", "contact": "1" },
    "b": { "connectorId": "xlr-1", "contact": "" } },
  { "id": "channel-2", "name": "Audio 2",
    "a": { "connectorId": "multipin", "contact": "2" },
    "b": { "connectorId": "xlr-2", "contact": "" } }
]
```

Contacts are authored pin/channel labels; no manufacturer pinout is invented.
Mappings are undirected across the two ends and can express asymmetric multipin
breakouts without requiring matching physical connector types. IDs are local to
the shared assembly. Missing/cross-end references are rejected atomically.
Reassigning/deleting a connector removes only its affected mappings, recoverable
through the existing editor Undo/Redo history. No-op assignments preserve mappings.

End-switching, camera movement and schematic previews do not dirty definitions.
Committed end edits are recorded as complete shared-device snapshots, so Undo can
return to the originating end while preserving the other end. Stale image-upload
targets are invalidated on end switches. Apply, personal saves, JSON export,
community submissions and `.wnx` export always use the shared definition, never
an end-only preview. Existing artwork asset handling deduplicates matching bytes.

## Validation

Focused regressions cover opt-in classification, stable independent ends,
malformed associations, zero-power enforcement, custom nodes, personal persistence,
`.wnx` collision import, Engine metadata round trips and unchanged geometry/topology.
The Chrome smoke test additionally clicks the real toggle, checks disabled W/A
controls, exercises draft Undo/Redo, applies/reopens a project and confirms its
existing cables remain identical. Run `node scripts/stagebox-snake-browser-smoke.mjs`
against a local server using the established Playwright environment variables.

The isolated staged tree passed 344 focused tests (stagebox model, personal/default
settings, portable packages, projector compatibility and Device Editor previews),
the Chrome workflow, and factory catalogue, viewer bundle, community validator
and Cloud Artwork validation. Existing factory data/artwork and unrelated local
Device JSON Import/infrastructure edits were excluded from the scoped change.

Phase 2 adds model tests for independent end geometry, artwork, contacts,
asymmetric mappings, identity collisions, representation/type separation,
no-op assignments, personal persistence and portable packages. The dedicated
`scripts/stagebox-ends-browser-smoke.mjs` covers real end controls, independent
uploads, stale upload guards, cross-end and channel Undo/Redo, whole-device
package export, Apply/reopen, unchanged canvas/cables and ordinary devices.

Phase 2's isolated staged tree passed 352 focused tests, the dedicated Chrome
workflow and factory catalogue, viewer-bundle, community and Cloud Artwork
validators. Only scoped end-editor/model/tests/documentation and the regenerated
community validator were committed; unrelated local work and protected assets
were preserved. No hosted migration, deployment or infrastructure change was made.

## Phase 4: Library insertion and legacy compatibility

Insert passive assemblies from **Device Library > Audio > Stageboxes & Snakes**.
The factory library includes a generic 4-Channel XLR Snake with a stagebox,
fanout, and four one-to-one channels. Library authors can configure other passive
devices in the Device Editor. Powered equipment such as Yamaha Rio still uses
the ordinary Stageboxes category.

A passive assembly is one saved device, even though its two ends can move
independently. The canvas trunk represents the internal assembly; it is not a
patch cable. Signal chains follow the authored channel mappings, and cable
reports show those channels on the connected physical cable rows without adding
an extra row or counting the drawing distance as cable length.

The toolbar has no dedicated Insert Snake action. Cable Loom and Multi-Core
remain separate tools. Historical Loom membership and Multi-Core circuit,
routing, and length data retain their existing formats and editors. Older
ordinary definitions named Snake remain ordinary devices unless explicitly
authored as a passive assembly. The loader does not infer a conversion from a
name or cable group: neither supplies enough information to infer the two
connector layouts and channel assignments without losing information.
