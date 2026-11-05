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

This phase does not create a second canvas object, add end-specific editor tabs,
provide end-assignment UI, create internal passive routes, alter cable scheduling
or change signal traversal. Canvas geometry and rendering remain unchanged. The
new authoring control is hidden outside Engine mode.

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
