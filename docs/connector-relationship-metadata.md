# Connector Relationship Metadata

Build 54.28.0 uses `connectorRelationshipMetadata.js` as the metadata authority for
Engine, the classic Device Editor/Legacy UI, and the embedded offline viewer.
The helper is pure and returns metadata-only patches and stable affected IDs.

| Field | Shared BUS | Through / Loop |
| --- | --- | --- |
| Name text | Shared by every member | Input editable; physical output is `LOOP` |
| Resolution and Custom text | Shared | Shared |
| All three captions | Shared | Shared |

On creation or load, BUS values come from `sourceConnectorId` (otherwise the first
member). Through shared values come from the input/source. The physical output
is detected by normalized signal/legacy direction, falling back to the declared
target for ambiguous pairs. Its `nameCustom` flag protects `LOOP` from numbering.
An explicit edit of any member becomes authoritative for the edited fields.
Removing a relationship leaves its last metadata intact and stops propagation.

Per-field connected components also include paired network connectors, without
recursive events. Physical IDs, types, status, modules, sides, anchors and
placement are never copied to another member. Installed cards use namespaced
relationships and write to per-slot or per-instance overrides, never the reusable
definition or other slots.

Editor metadata commits have a dedicated draft-local undo stack, coalesce typing
within one focused control, and render once per update. Canvas commits use their
existing Engine/Legacy undo systems and persist all affected overrides together.
Failed edits restore every member before rethrowing. Structural edits retain
their existing placement transactions; metadata edits do not invoke placement.

`fixtures/relationship-metadata.mjs` supplies BUS and Through cases. Unit tests
cover propagation, isolation, roles, rollback, undo, and embedded-runtime parity.
`scripts/relationship-metadata-smoke.mjs` drives Engine and Legacy inspector
controls, then verifies save/reload and offline metadata. It accepts the same
`AVDESIGNER_BASE_URL`, `AVDESIGNER_PLAYWRIGHT_PATH`, and `AVDESIGNER_CHROME_PATH`
environment variables as the other browser smoke scripts.
