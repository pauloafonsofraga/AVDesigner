# Engine Device Authoring V2

Build: `Iteration 53.1 — Device Editor Engine Preview — iteration53-1-device-editor-engine-preview`

## Scope

Iteration 52 moved normal device authoring toward the Engine model without replacing the production output pipeline. Iteration 53.1 moves the Engine-mode Device Editor visual preview onto the shared Engine renderer. The DOM modal still owns forms, tabs, inputs, dropdowns, buttons, and authoring overlays. The Engine-facing draft model owns connector identity, connector topology, validation, preview normalization, and runtime geometry.

This is intentionally not a visual redesign. The goal is that new and newly edited devices can be authored as V2 definitions, used on the Engine canvas, saved, and loaded without depending on Legacy-only connector pairing hacks.

## Legacy vs Engine Audit

| Feature | Legacy implementation | Current Engine runtime support | Current Engine authoring support | Action |
| --- | --- | --- | --- | --- |
| Device metadata | Device Editor writes name, brand, category, dimensions, power, flags, and specs directly onto template objects. | Engine adapter reads metadata and instance overrides. | Existing DOM fields remain; new drafts are stamped with schema V2. | Retained, normalized before apply. |
| Master creation | Create New Device edits a reusable master definition. | Engine can instantiate master definitions and custom instances. | Create New Device creates a V2 master draft; apply saves a master, not a project instance. | Migrated. |
| Master duplication | Duplicate in Device Editor creates another reusable definition. | Engine distinguishes source template ID from canvas instance ID. | Existing duplicate flow remains a master-library workflow. | Retained. |
| Project device identity | Earlier flows could blur template identity and instance identity. | Engine scene preserves `sourceId`, `templateId`, instance ID, and overrides. | V2 authoring keeps master edits separate from placed project instance edits. | Retained with stricter identity rules. |
| Node Builder | Global catalogue of connector/cable types, colors, thumbnails, and compatibility metadata. | Engine compatibility consumes canonical/effective connector types. | Node Builder remains the global connector type catalogue; Device Editor consumes it. | Kept separate. |
| Per-device connector placement | Legacy nodes are placed directly on device/card preview with direction-derived side. | Engine runtime maps connectors to world points and hit-test entries. | Connectors tab now edits physical type, signal behaviour, display side, anchors, modules, and matrix flag per selected connector. | Migrated to V2 draft. |
| Physical connector type | `type` mixed physical connector, cable behavior, and visual assumptions. | Engine has `effectiveConnectorTypeForEngine()` for compatibility. | V2 stores `physicalType` / `connectorType` separately from direction/display behaviour. | Redesigned. |
| Signal behaviour | Mostly inferred from input/output side or special hard-coded cable rules. | Engine compatibility supports bidirectional and explicit special cases. | Device Editor exposes `Signal Behaviour`: standard, input, output, bidirectional. | Migrated. |
| Visual side | Legacy direction usually implied left/right. Network-like ports auto-created a fake opposite side. | Engine can render multiple anchors for one logical connector. | Device Editor exposes `Display Side`: left, right, both. | Redesigned. |
| Network/IP paired ports | Legacy automatically created paired input/output copies and faded the unused side. | Engine can treat one connector as multiple visual anchors with one logical occupancy. | V2 uses one connector with two anchors when display side is both. | Migrated away from fake duplicated connectors. |
| Multi-anchor connector | Not a first-class data model; simulated with paired connectors. | Scene graph, renderer, labels, info boxes, hit testing, and endpoint serialization accept `anchorId`. | Authoring defaults both-side bidirectional connectors to left/right anchors. | Added. |
| Endpoint anchor persistence | Older wires only stored device + connector. | Engine endpoints support optional `anchorId` and deterministic fallback. | New V2 endpoints can remember which visual anchor was used. | Added. |
| Mirrored visual relation | Dashed relation line between fake paired nodes. | Engine renders dashed multi-anchor relation and fades unused anchor when the logical connector is occupied elsewhere. | Relationship panel can create mirrored relationships and/or set connector display to both. | Added. |
| Exclusive shared bus | Previously handled ad hoc in device-specific notes or manual user discipline. | Engine topology computes packed display anchors, shared-bus rail/field placement, and active exclusive members from live external wires. | Connectors tab edits `exclusive` groups; the preview uses Engine-rendered shared-bus geometry while the DOM inspector owns controls. | Migrated preview. |
| Through / loop relation | Usually drawn manually or implied by labels. | Engine renders the internal through arrow and keeps both connectors externally wireable. | Connectors tab edits `through` relations; the preview uses the Engine arrow while the DOM inspector owns controls. | Migrated preview. |
| Relationship validation | Legacy checks were scattered around specific features. | Engine module validates connector IDs, duplicate IDs, group membership, missing references, and through self-links. | Apply path validates topology before commit. | Added. |
| Runtime relationship state | Some visual availability was stored or implied by pair flags. | Engine derives occupancy from live wires. | Authoring saves only topology, not derived faded/active state. | Redesigned. |
| Connector hover priority | Legacy SVG hit targets handled most hover/selection. | Engine hit-test returns connector/anchor payloads before device fallback. | Authoring preview uses connector selection first, then device preview. | Retained. |
| SFP/QSFP modules | Legacy dropdowns on connector records. | Engine compatibility supports cages, installed modules, active connector type, and fiber modes. | Selected connector settings reuse the module dropdown and V2 normalization. | Migrated. |
| Fiber mode | Legacy connector field affected fiber colors. | Engine compatibility and renderer use fiber mode/family colors. | Existing fiber controls remain tied to effective connector type. | Retained. |
| Matrix flag | Legacy checkbox per connector/card connector. | Engine routing reads `includeInMatrix` and matrix touched state. | Selected connector settings show matrix checkbox only for matrix devices. | Retained. |
| Cards and slots | Legacy generated card connectors and per-slot overrides. | Engine runtime renders generated connectors, card bands, and card captions. | Card connector normalization carries V2 connector/topology fields in slot overrides; Engine-mode Device Editor preview uses Engine visuals and keeps slot/drop/selection controls in the overlay. | Migrated preview. |
| Connector relationships inside cards | Legacy had no coherent general topology model for cards. | Engine can normalize generated card connectors with stable IDs. | Slot overrides now preserve V2 fields, allowing relationship data to survive where generated IDs are stable. | Foundation added; needs browser fixture hardening. |
| Faceplates | Legacy import/scale/position behavior. | Engine uses faceplate data for canvas visuals. | Existing faceplate controls remain; Engine-mode Device Editor preview uses Engine-rendered shell/image/scale/offset with shared faceplate geometry for overlay handles. | Migrated preview. |
| Power distro plugs | Legacy special generated faceplate/plug logic. | Engine renders generated PD plug visuals and Powerlock color behavior. | Power metadata fields are reserved in V2 connector schema; Engine-mode preview renders actual PD visuals while the existing plug authoring UI remains overlay-owned. | Migrated preview. |
| Adapter/breakout | Legacy special compact object with internal wiring. | Engine runtime supports compact adapter visuals and internal mapping. | Existing adapter toggle remains; Engine-mode preview renders the adapter shell/connectors/internal paths through Engine. | Migrated preview. |
| Racks | Separate rack builder, exposed rack ports, internal wiring. | Engine supports rack canvas objects and exposed ports. | Not part of Device Editor V2 migration. | Deliberately not changed. |
| Reports/export/viewer | Legacy-oriented output pipeline. | Engine commits still write compatible project data. | V2 topology is preserved in project/template snapshots but visual output parity is not migrated here. | Deliberately deferred. |

## Node Builder Decision

Node Builder remains a separate global connector-type catalogue/editor. It owns reusable connector/cable type facts: label, color, thumbnail, broad compatibility, and default metadata for HDMI, SDI, EtherCON, fiber, USB, power, and similar types.

Device Editor owns per-device connector authoring: which connector type is used, where it is placed, which side(s) it appears on, signal behaviour, connector fields, installed SFP/QSFP module, matrix eligibility, card/slot ownership, and connector topology relationships.

This avoids forcing the user to jump into Node Builder simply to place or configure a connector on a device, while still keeping one global catalogue for connector types.

## V2 Schema Examples

Normal connector:

```json
{
  "id": "hdmi-in-1",
  "schemaVersion": 2,
  "label": "HDMI 1",
  "type": "hdmi",
  "physicalType": "hdmi",
  "connectorType": "hdmi",
  "signalDirection": "input",
  "displaySide": "left",
  "primaryAnchorId": "left",
  "anchors": [{ "id": "left", "side": "left", "x": 0, "y": 120 }],
  "infoFields": [],
  "moduleCapability": null,
  "fiberCapability": null,
  "powerMetadata": null
}
```

Mirrored multi-anchor connector:

```json
{
  "id": "lan-1",
  "schemaVersion": 2,
  "label": "LAN 1",
  "physicalType": "ethercon",
  "signalDirection": "bidirectional",
  "displaySide": "both",
  "primaryAnchorId": "left",
  "anchors": [
    { "id": "left", "side": "left", "x": 0, "y": 180 },
    { "id": "right", "side": "right", "x": 340, "y": 180 }
  ]
}
```

Exclusive group:

```json
{
  "id": "input-1",
  "type": "exclusive",
  "label": "Input 1",
  "members": ["input-1-hdmi", "input-1-dp"],
  "maxActive": 1
}
```

Through relation:

```json
{
  "id": "sdi-loop-1",
  "type": "through",
  "label": "THRU",
  "members": ["sdi-in-1", "sdi-thru-1"],
  "sourceConnectorId": "sdi-in-1",
  "targetConnectorId": "sdi-thru-1"
}
```

Wire endpoint with a visual anchor:

```json
{
  "deviceId": "router-1",
  "connectorId": "lan-1",
  "anchorId": "left"
}
```

## Engine Authoring Architecture

DOM responsibilities:

- Modal shell, tabs, inputs, dropdowns, buttons, lists, and debug panels.
- User text entry and simple form state.
- Calling draft normalization/validation before apply.
- Authoring-only overlay controls: empty slot targets, connector selection halos, marquee rectangles, faceplate resize handles, card/slot outlines, Power Distro plug handles, and drop targets.

Engine draft responsibilities:

- V2 schema stamping.
- Stable logical connector IDs.
- Anchor normalization.
- Topology normalization and validation.
- Preserving card/slot connector override fields.

Shared preview/runtime responsibilities:

- In Engine mode, the Device Editor preview uses one persistent `EnginePreviewSurface` per editor session.
- Draft devices are cloned through `createPreviewDeviceFromDraft(...)` and `normalizeAvDesignerDevice(...)`, preserving connector/card/relationship IDs for authoring selection state.
- Device body, title, faceplate, installed cards, generated connectors, connector labels, info fields, Both-side dashed relations, exclusive shared-bus visuals, through arrows, Power Distro visuals, and adapter internals are rendered by `WebglGraphRenderer` and the Engine label layer.
- Connector anchors use the same coordinate model as the Engine canvas.
- Relationship visuals are drawn from normalized topology: dashed multi-anchor line, exclusive bus rail, and through arrow.
- Availability/fading is derived from current external wiring and not saved.
- Legacy mode keeps the existing SVG preview path.

Apply path:

1. Normalize draft to V2.
2. Validate device defaults and connector topology.
3. Commit the edited master or project instance through the existing Engine bridge path.
4. Preserve output/report/viewer compatibility by keeping V2 fields in snapshots rather than moving those pipelines in this iteration.

## Diagnostics

Use `debugDeviceAuthoring=1` for browser checks. The Device Editor debug panel should confirm:

- draft schema version
- connector count
- anchor count
- connector relationship count
- topology errors/warnings
- selected connector
- relationship render source
- preview source (`EnginePreviewSurface` or `legacy/svg`)
- active preview surface count
- full scene replacement count
- incremental device replacement count
- rendered preview frame count
- texture build/rebuild counts
- asset subscriber count
- authoring overlay draw count

## Known Remaining Differences

- Relationship hit-testing in the main canvas is intentionally informational for now; internal relationship visuals are not normal project wires.
- Full PDF/viewer visual migration for V2 topology is deferred.
- Card relationship authoring is structurally supported, but fixture hardening for complex card-generated connector relationships remains a follow-up.
- Power Distro authoring still uses the existing special workflow; V2 reserves power metadata without rewriting that UI.
- Rack Builder, Node Builder/crop previews, and Title Block/minor previews are not migrated by 53.1.
