# SFP Installation, SDI and DAC

Build: **54.38.115**. Branch: `engine-prototype`.

## Baseline and Scope

Starting local and fetched remote HEAD both:
`c2d7b0b06106e7b234acec9dd92f5d35f2ee4ff7`.
This preserves the newer unsaved-editor protection commit on top of the requested
`5ddac820c2475fae3a3eab25cc732571ae44d5f6` baseline.

No Legacy implementation, factory definitions, faceplates, artwork, Masters,
backups, deployment settings or release tags are changed. Unrelated Device JSON
Import work remains outside the commit.

## Findings

The Engine already understood SFP, SFP+, SFP28 and QSFP cages, historical module
objects/flat aliases, and `sfpsdi` / `sfpbnc` effective connectors. The editor and
production Inspector maintained separate, smaller option lists: Empty, LC
single-mode, LC multimode, RJ45 Ethernet and QSFP-only MPO.

Editor installation only changed `installedModuleType` and `fiberMode`. Older
active-type/name aliases could remain authoritative. Card-slot overrides omitted
module fields and could stringify structured metadata. Changing the physical
node type only cleared one field. This allowed displayed selection, effective
connectivity and persisted card data to disagree.

The canvas Inspector also deleted connected cables when changing a module.
It now refuses the change and asks the user to disconnect first.

## Shared Capability Contract

`src/engine/transceiverModules.js` supplies the Engine picker profiles, capability
validation, readable module details and DAC assembly helpers. The existing
compatibility functions remain the public connection boundary. No parallel
connector architecture or editable module catalogue is introduced.

Optional connector data:

```js
{
  type: "sfp-plus-cage",
  installedModuleType: "sfp-sdi-3g-rx",
  moduleCapabilities: {
    formFactor: "sfp",
    signalFamily: "sdi",
    mediaType: "coax",
    direction: "input",
    supportedRates: ["3G-SDI"],
    manufacturer: "Optional manufacturer",
    model: "Optional model",
    platforms: ["Optional platform identifier"],
    physicalConstraints: { clearanceMm: 20 }
  },
  cageCapabilities: {
    supportedFormFactors: ["sfp", "sfp-plus"],
    supportedRates: ["3G-SDI", "12G-SDI"],
    supportedSignalFamilies: ["sdi"],
    supportedMediaTypes: ["coax"],
    supportedModuleTypes: ["sfp-sdi-3g-rx", "sfp-sdi-12g-rx"],
    platforms: ["Optional platform identifier"]
  }
}
```

Rates are explicit capability sets, not inferred from a label. Matching is
case/punctuation-insensitive; `12G-SDI` does not imply support for every lower
rate. Known constraints are intersected across both modules and both hosts.
Unknown module rate or host/platform qualification is shown as **unverified**.
Physical constraints are retained/presented, not mechanically certified.

Named profiles cannot be contradicted by direction, form factor, signal family,
media type, assembly identity or expanded/empty rate overrides. Manufacturer/model and
other optional metadata survive unchanged. Generic LC/MPO options do not invent a
link speed or signal family. Historical module aliases are not migrated on load.
Explicit replacement clears obsolete aliases; selecting the same value does not
overwrite authored capability data.

## Editor Workflow

Select a cage in the existing Device Editor or canvas Inspector, then use
**Installed Module**. The same dropdown and details work for ordinary nodes,
card definitions and installed-card slot overrides.

- LC single-mode and multimode remain available for the existing cage families.
- RJ45 Ethernet is offered for SFP, SFP+ and SFP28.
- QSFP retains LC/MPO and gains its own DAC cable-end option.
- SDI BNC has explicit Receiver and Transmitter choices, with unspecified-rate,
  3G, 6G and 12G variants. The 6G/12G profiles require the SFP+ physical family or
  SFP28; plain SFP is not offered those profiles.
- DAC choices are SFP+ 10G, SFP28 25G and QSFP with unspecified rate.
- Empty removes the module and restores the inactive cage.

Options respect declared host constraints and node direction. Existing historical
selections remain visible even when they are not a current picker profile.

Installing, replacing or removing a module does not regenerate a connector ID,
add a second node, move coordinates, replace ownership, or invoke a new placement
solver. Duplication retains assignments through existing connector remapping.
Ordinary/card definitions, personal-library saves, installed-slot overrides and
project snapshots retain metadata.

Connected changes are blocked before mutation, including Inspector changes,
Device Editor changes and Apply. Existing wire identities, routes and history
remain intact. A same-value selection is a no-op. Undo restores complete
snapshots rather than reinstalling default profiles over custom data.

## SDI Behavior

The physical cage remains a cage; its external connector is the existing `sdi`
type (BNC SDI). Historical `sfpbnc` retains its existing `bnc` mapping. No extra
SDI connector identity is created and no SDI module is treated as optical fibre.

Receiver-only and transmitter-only modules constrain logical direction without
rewriting structural node direction or anchors. Compatibility, Jump roles,
Signal Chain and matrix endpoint classification use that effective direction.
Operational-status checks still run before connection approval.

Jump compatibility hits represent the complementary cable endpoint, not a
second installed receiver/transmitter. Their transient proxy marker is not
project data.

## DAC Model

Choose matching integrated DAC cable ends on two cages, then draw a normal cable.
No optical transceivers are required. This is **one existing physical wire
record**, with its normal ID, number, length, route, Loom assignment and endpoints.
There are no two extra copper leads or duplicate cable records.

```js
{
  id: "existing-wire-id",
  cableType: "dac-sfp-plus",
  length: "3m",
  from: { deviceId: "switch-a", connectorId: "stable-cage-a" },
  to: { deviceId: "switch-b", connectorId: "stable-cage-b" },
  cableAssembly: {
    kind: "direct-attach-copper",
    version: 1,
    cableType: "dac-sfp-plus",
    ends: {
      from: { formFactor: "sfp-plus", moduleType: "dac-sfp-plus", capabilities: {} },
      to: { formFactor: "sfp-plus", moduleType: "dac-sfp-plus", capabilities: {} }
    },
    supportedRates: ["10G"],
    warnings: ["Host/platform module support is unverified."]
  }
}
```

The example abbreviates end capabilities. Real records retain the selected end
metadata. The existing wire endpoint references couple the ends; module fields
describe integrated cable ends, not free transceivers with a separate lead.

This phase intentionally supports matching cage families only. It does not claim
blanket SFP+/SFP28 fallback interoperability, mixed-form-factor assemblies or QSFP
breakout DACs. DACs connect directly to their two cages; ordinary Jump termination
is rejected rather than creating a partial assembly. A direct DAC can still use
the existing Loom route because its physical endpoints remain the cages.

Cable type substitution is blocked for DAC in single/multiple Inspector preview
and commit paths. Rewiring must preserve the declared assembly/end compatibility.
Changing length/label/notes continues to use ordinary cable commands.

## Reports and Outputs

DAC is classified as Network in Cable Schedule, with a readable SFP+/SFP28/QSFP
DAC name and one physical cable count. Its length is the normal cable length.
Assembly details and unverified constraints appear in Inspector/report metadata.
Mixed Multi-Core projects validate a DAC as one assembly rather than comparing
its cage to a fictitious standalone copper connector.

Structured module data and assembly data survive normalization, card/rack
rendering projections, project mutation/save/reload and output scene snapshots.
Output Viewer/standalone HTML show installed-module and DAC details. PDF uses the
unchanged production renderer/export path. Portable JSON keeps module fields;
no new artwork dependency is introduced.

## Verification

Focused Node tests cover installation/removal, aliases, form factor, rates,
direction, metadata contradictions, connected guards, actual Inspector/history
normalization, card/rack projections, persistence, one-cable counting and output
scene parity.

`scripts/sfp-module-acceptance.mjs` uses an isolated real Chrome profile and actual
editor/dropdown/canvas interactions. It records the fixtures that require seeded
device placement, captures source hashes, and exercises personal save/reopen,
duplication, cards, SDI rejection/acceptance, both SFP+/SFP28 DAC connections,
undo/redo, project reload, connected guards, Signal Chain, Cable Schedule XLSX,
portable device JSON, offline HTML and production PDF. The portable definition is
reloaded through the existing project-definition path; the unrelated, unfinished
Device JSON Import UI is not part of this change.

The exact staged production tree is tested separately from the working tree,
excluding the unrelated Device JSON Import edits. The acceptance runner checks
that its source hashes do not change during the run. Additional Chrome regression
workflows cover Device Editor/card relationships, personal-definition isolation,
unsaved changes, and the Multi-Core editor.

Evidence is written beneath `/tmp/wirenexus-sfp-2026-10-20/`; `chrome-isolated/` artifacts
include `editor-sdi.png`, `card-installed-sdi.png`, `dac-sfp28-3m.png`,
`cable-schedule.png`, `offline-viewer.png`, and rasterized PDF pages.

Final isolated results: **1,663/1,663 Node tests**, **16/16 static validators**,
all three generated-bundle checks, and **36 Chrome acceptance checks** passed.
Chrome 155.0.8059.85 reported no page/console errors or changing source hashes.
Editor, installed-card, DAC, Cable Schedule, offline HTML and both rasterized
PDF pages were inspected. Syntax checks and `git diff --check` passed.

The verified commit/remote hashes are reported with the completed change.
Safari, Firefox, physical module interoperability, and hosted production
deployment are outside this local Chrome acceptance.

## Changed Files

- `index.html`, `src/factoryCatalogueBootstrap.js`: shared Engine module picker,
  editor/card metadata and guards, build/cache identifiers.
- `src/engine/transceiverModules.js`, `connectorCompatibility.js`: capability
  profiles and existing compatibility integration.
- `src/engine/productionBridge.js`: guarded Inspector/cable commands and history.
- `src/engine/projectAdapter.js`, `sceneGraph.js`, `projectMutations.js`: module,
  card/rack and assembly persistence without identity/placement changes.
- `src/engine/jumpNodeModel.js`, `matrixRouting.js`, `multiCoreConnectivity.js`,
  `cableSchedule.js`: effective direction and single-assembly connectivity/reporting.
- `src/engine/renderer.js`, `outputViewerModel.js`: module/assembly presentation.
- The three existing files under `src/engine/generated/`: regenerated viewer,
  PDF and Cable Schedule bundles.
- `test/transceiverModules.test.mjs`, `transceiverConnectedGuard.test.mjs`,
  `engineSfpMetadataPersistence.test.mjs`, `factoryCatalogueBootstrap.test.mjs`:
  new regressions and shared bootstrap contract.
- `scripts/sfp-module-acceptance.mjs`: real Chrome acceptance.
- Four existing canvas-layout, connector-operational-status, Jump and
  preview-ownership validators: build fingerprint updates only.
- This document: implementation contract, evidence and limitations.

## Hardware References

- [Embrionix coaxial video SFP families](https://www.embrionix.com/product/subfamily/uhd-12g-6g-sdi-emsfp)
  distinguish SDI rates and receiver/transmitter configurations.
- [Cisco SFP+ module data sheet](https://www.cisco.com/c/en_in/products/collateral/interfaces-modules/transceiver-modules/data_sheet_c78-455693.html)
  describes direct-attached twinax assemblies with integrated SFP+ ends.
- [Cisco QSFP module data sheet](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/data_sheet_c78-660083.html)
  distinguishes QSFP DAC assemblies from optical and breakout variants.
