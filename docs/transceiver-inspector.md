# Editable Transceiver Inspector (Phase A)

## Independent optical settings

Bandwidth remains the first control. Once an optical interface is selected, the
existing Canvas Inspector offers an optional, host/rate-filtered Optical profile,
fibre arrangement, signal direction, and wavelength configuration. An edit to
a preset setting switches the installed profile to Custom. Select changes
commit immediately; text edits commit on Enter or when leaving the field.
Invalid edits keep the previous module. SDI continues to take its TX/RX role
from the device.

SC/ST are selectable on SFP-family cages without declared interface restrictions.
That configuration remains Unverified unless the host declares support. Explicit
host restrictions still apply. An unoccupied MPO port can also attach a
[detachable MPO breakout](./mpo-physical-metadata.md).

In module capabilities, `optical.arrangement`, `optical.signalDirection` and
`optical.wavelengthMode` are independent. `txNm`/`rxNm` hold wavelength sets;
optional `laneWavelengths` stores sets for numbered logical lanes on a parallel
module. These lane numbers do not define MPO pin positions or signal routing.
A bidirectional simplex module shares one fibre (BiDi); it may use single
wavelengths per direction or WDM. Historical values are interpreted on read,
and old project records are not rewritten just by opening them. Missing
wavelength evidence remains Unverified.

10GBASE-LR is duplex single-wavelength and 100GBASE-LR4 is duplex WDM with four
nominal wavelengths per direction. SR4 uses four parallel optical lanes, not
four wavelengths on one fibre. 10G BX-U/D provides complementary simplex
1270/1330 nm examples for SFP+ hosts. See the
[Cisco QSFP data sheet](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/datasheet-c78-736282.html)
and [Cisco SFP+ data sheet](https://www.cisco.com/c/en/in/products/collateral/interfaces-modules/transceiver-modules/data_sheet_c78-455693.html).
Host eligibility, fibre type, explicit direction and receive ranges still apply.

This phase displays one cable route even for duplex. A resolved WDM declaration
uses a long/short 18/6/5/6 pattern in world pixels along the same geometry,
including during drawing and replugging, bends and hops. At most the ink changes: labels, lengths, quantities,
occupancy, and signal paths are unchanged. Known conflicting links are not
presented as WDM or played as operating paths. Uncertain facts such as optical
power, reach and actual per-lane MPO pairing are not verified. A WDM leg stays
dashed when connected to a Jump, and a compatible paired leg inherits the same
pattern. Jumps without a resolved WDM endpoint retain their default style.

A rate-only mismatch across a detachable transceiver link is allowed and shown
as Unverified. Different speed prefixes do not by themselves change an optical
family such as SR. Known signal, wavelength, interface and fibre conflicts still
reject; the installed module must still match its own cage. Integrated DAC/AOC,
breakout lane rates, and fixed-port validation keep their existing requirements.

The Designer and Technician Viewer (including offline HTML) share the Engine
renderer, and ordinary WDM paths are emitted to SVG/PDF as a single dashed
stroke. Play Cable retains the pattern on direct WDM wire steps. Run
`node --test test/opticalWavelengths.test.mjs` and
`node scripts/optical-wavelengths-smoke.mjs` against the local preview.

The earlier duplex-rendering and Inspector notes below are historical.

## Bandwidth and duplex update (2026-11-19)

The first Canvas Inspector choice is now **Bandwidth**, replacing the optical
Preset selector and the second Line rate field. It contains speed values only,
with no None/Unspecified choice. Fibre category remains a separate optical
property. Host/port restrictions and named-module-only hosts still apply.
Without declared host rates, the UI starts at 1G for SFP-family cages and 40G
for QSFP-family cages. Explicit host declarations can provide lower rates or
restrict the minimum to 100G. These UI choices do not certify host support.

Opening a cage does not install a module or change the project. An edited optical
configuration receives the selected rate on Apply; existing named profiles and
multi-rate/historical data remain unchanged until explicitly edited. Existing
multi-rate values have a retained Current option. Contradictory host declarations
show a disabled No supported bandwidth state instead of inventing a valid rate.
RJ45 module authoring also persists the selected bandwidth. DAC/AOC bandwidth
selection chooses an existing compatible assembly profile, not an invented cable.

**QSFP28 Cage** is directly available in the Engine Device Editor and Node Builder
palettes, including after library refresh. Placement uses the existing canonical
`qsfp-cage` physical type with `supportedFormFactors: ["qsfp28"]`. It does not
alter the factory catalogue, existing connector IDs, anchors or placed devices,
and does not automatically declare host rates or breakout support.

Explicitly declared duplex LC/SC/ST fibre now renders as two strands, crossing
near the final endpoint. The paths converge on the original anchors. The shared
Engine primitives provide this rendering in the canvas, offline HTML Viewer and
SVG/PDF. Simplex/BiDi, MPO, DAC/AOC and ordinary non-fibre graphics are unchanged.
Unknown legacy arrangements remain unknown, not silently marked duplex. Physical
cable records, routing geometry, electrical compatibility and lengths do not change.

Validation: 2,555 automated tests; 16 static validators; Chrome bandwidth/default,
SC/ST/SDI/MPO/DAC, occupied-cage, restricted-host, five cage families, native QSFP28
palette drag, Node Builder, duplicate, Undo/Redo, `.avd` reopen and offline Viewer
checks. QSFP breakout 4 -> 2 -> 1 branch replug/rejection/Undo/Redo also passes.
The focused command is `node scripts/transceiver-bandwidth-duplex-smoke.mjs`
against a localhost preview, with the existing Playwright/Chrome environment.
No deployment, database or infrastructure changes are included.

The sections below record the earlier Phase A behavior and acceptance results;
their Preset/Line rate instructions are superseded by the speed-first workflow.

## Standalone Connector Follow-up (2026-11-20)

The Engine palettes already contain ordinary `fiber-lc`, `fiber-sc`, `fiber-st`
and `fiber-mpo` connectors. They remain unchanged. LC/SC/ST now also have explicit
Duplex palette shortcuts, plus a **Fibre arrangement** control in the Canvas
Inspector, Device Editor and Card Editor. Placement retains each canonical
physical connector type and stores `fiberCapability.arrangement: "duplex"` (or
`"simplex"`) in the existing optional capability object. Unspecified historical
ports are not silently converted. Other fibre capability metadata is preserved.

The existing fibre-grade colour rules still apply: OS1/OS2 yellow, OM1/OM2 orange,
OM3 aqua, OM4 magenta and OM5 green. Changing the grade uses the existing node and
cable colour update path; duplex does not create another electrical connector
type or relax the existing single-mode/multimode restrictions. Explicit standalone
duplex LC/SC/ST uses the same two-strand end crossover as cage-mounted duplex
optics, including drag previews, offline Viewer and SVG/PDF primitives.

The palettes also expose preconfigured DAC/AOC ends for SFP+ 10G, SFP28 25G,
QSFP+ 40G and QSFP28 100G. These are shortcuts to the existing cage-and-integrated
module model, not detachable generic sockets. Existing host checks, one physical
assembly/length/schedule row, occupancy and permanent-end restrictions remain in
force. DAC keeps its existing brown and AOC its existing blue; neither is a
user-graded detachable fibre patch lead. MPO remains a multi-fibre interface with
its existing physical-property editor, not an invented duplex pair.

No factory definitions, original artwork, connector anchors or cable identities
are changed. Capability data persists through installed-card overrides, `.avd`
save/reopen and `.wnx` export/import. Legacy receives no new palette or controls.
The actual mouse-workflow regression is `scripts/standalone-fiber-browser-smoke.mjs`.
Validation passed 2,562 automated tests and 16 static validators, plus Chrome
checks for palette placement, seven cable connections, fibre-grade colours,
arrangement editing, Undo/Redo, save/reopen and offline Viewer rendering.

## Original Phase A implementation

The Canvas Inspector always shows the applicable configuration fields.
An optional preset fills the existing profile's known properties. Editing any
property clears the preset and commits a generic custom module with matching
physical interface metadata. Selecting nothing or only opening the Inspector
never rewrites installed profiles, historical IDs or MPO properties.

LC and MPO retain their existing cage eligibility. SC/ST use the existing
`fiber-sc` and `fiber-st` connector definitions. New SC/ST installation requires
an explicit `cageCapabilities.supportedModuleInterfaces: ["sc", "st"]` or a
matching generic module ID in `supportedModuleTypes`; a cage's shape alone does
not authorize them. The Device Editor's Host restrictions exposes this list.
Existing recognized SC/ST modules with undeclared host support remain unverified.
No manufacturer-specific SC/ST module or host claim is added.

Single-mode may declare OS2; multimode may declare OM3, OM4 or OM5.
Fibre grade remains unspecified unless authored. LC/SC/ST support simplex and
duplex configurations; MPO uses parallel fibre. Optical SDI requires an explicit
input/output role and simplex single-mode fibre; Ethernet stays bidirectional.
Wavelengths and applicable MPO properties are visible without Advanced menus.
Fixed-port MPO editors keep their existing collapsed physical-property form.

The Line rate select filters standardized rates by cage ceiling, declared host
rates and an authoritative module or selected preset's rates. A custom module's
saved rate is an editable value, not a permanent restriction on later edits.
Clearing a preset or editing its properties releases preset-only restrictions
without changing the current rate or dropping saved multi-rate metadata.
Unknown host support remains unverified and is identified beside the rate select.
Current multi-rate or nonstandard saved rates remain available as a retained
Current option. Only explicitly selecting another rate narrows that metadata.
Current cage families expose new standardized choices up to 100G; no higher
family, automatic lane breakout or unsupported host capability is inferred.

Hover shows at most two short lines; full details and warnings stay in the
Inspector. Optical technology classification preserves named profile IDs and
distinguishes single-wavelength, BiDi, WDM, parallel and unknown data without
inferring WDM from connector shape or rate. Cable rendering is unchanged.

The synthetic Generic QSFP Breakout Lab adds `qsfp28-2` at x=380, y=260,
54 units below its original QSFP28 cage. Its existing height of 582 accommodates
the new port. All ten previous connectors are unchanged. The new cage is an
independently configured 100G QSFP28 port with no breakout modes enabled.
Previously placed devices remain project snapshots; use the updated factory
example for the additional port.

## Manual acceptance correction

Baseline: `9719510`. All checks below use real Chrome controls and canvas/library
mouse actions. No hosted deployment was changed.

1. **LR4 editing: UX issue, not reproduced data loss for valid edits.** Selecting
   100GBASE-LR4 and changing OS2 or a wavelength already saved Custom LC correctly.
   However, the installed-profile summary stayed visible while a draft was being
   edited, and profile-only rates persisted after switching to custom. Pending
   edits now show `Custom LC - Not applied` separately from `Installed:`. Apply
   commits the generic custom identity. A deliberate change to single wavelength
   while retaining four wavelengths still rejects with a visible validation error;
   that is a contradiction, not a failed custom conversion.
2. **SC/ST: missing test prerequisite.** No previous factory test host declared
   SC/ST. The new **Generic Transceiver Configuration Lab**, under Network /
   Switches, explicitly labels its synthetic **SFP+ SC/ST test** port. It declares
   LC/SC/ST and 1G/10G for testing, not as a manufacturer claim. No existing factory
   device or compatibility rule was changed.
3. **Rates: confirmed code defect.** Reopening a saved custom 10G module on a
   1G/10G host incorrectly offered only 10G. Its selected value was being reused
   as an immutable module capability. The dropdown now retains valid host choices
   for custom authoring while keeping named-profile and host restrictions. The
   synthetic lab's SFP, SFP+, SFP28, QSFP+ and QSFP28 ports declare respectively
   100M/1G, 1G/10G, 10G/25G, 40G and 40G/100G. Unknown hosts show an Unverified
   rate-support status; their displayed cage-ceiling choices are not certification
   of host support.
4. **Extra cage: no missing connector reproduced; fresh-instance prerequisite.**
   A real library drag of Generic QSFP Breakout Lab creates eleven connectors,
   including `qsfp28-2` at (380, 260), independently configurable at 100G. Importing
   an old ten-port instance leaves it unchanged; dragging a new factory instance
   alongside it gives eleven. Its two original Breakout-labelled ports remain
   reserved for integrated breakouts, not the optical preset test.

### Repeat the tests

- Use the updated local application on `engine-prototype`, not an unchanged
  hosted deployment. Reload to start a fresh application/catalogue session; no
  browser data, personal library or project needs deleting.
- Under Network / Switches, drag a **fresh Generic QSFP Breakout Lab**. Right-click
  **QSFP28 2**, the third port down the right edge. Choose 100GBASE-LR4 and Apply.
  Choose OS2, confirm the pending Custom LC status, then Apply. Undo returns LR4;
  Redo returns Custom LC. Save As `.avd`, reopen and inspect the same port. The
  original **100G Breakout** port must remain unchanged.
- Drag **Generic Transceiver Configuration Lab**. Right-click **SFP+ SC/ST test**
  on its left edge. Choose SC, Single-mode, OS2, Duplex, Single wavelength, 1G and
  TX/RX 1310 nm; Apply. Repeat for ST. On an unqualified ordinary host SC/ST must
  remain unavailable. For an authored host, Device Editor / Connectors / selected
  cage / Host restrictions exposes Allowed module interfaces and Allowed line rates;
  declare only actual documented hardware capabilities.
- On that lab's five named ports, choose LC and inspect the rate lists above.
  Save 10G on SFP+ SC/ST test, reselect it and change to 1G. Both must save. On
  QSFP28 test, selecting LR4 limits rates to 100G; choosing preset None or editing
  a property makes it custom and exposes that host's 40G/100G choices. Unspecified
  is unknown, not zero speed and not a confirmed capability.

Automated coverage: three added regressions failed on the baseline before the
correction; the complete suite passes 2,530 tests with no failures/skips. Chrome
checks cover the four workflows, five cage families, host restriction authoring,
multi-rate preservation, stale/fresh instances, Undo/Redo and `.avd` reopening.
Existing DAC/AOC, occupied-cage, MPO, QSFP 4 -> 2 -> 1 replug, optical-status/playback,
HTML/PDF and derived Loom length checks pass. Baseline comparison preserves all
50,625 ordinary pairings, 1,681 module pairings, node colours, both routing-mode
projections, all previous factory definitions and all artwork manifests.

References for conservative hardware eligibility:

- [Siemens distinguishes SFP and SC/ST pluggable formats and host slots](https://cache.industry.siemens.com/dl/files/085/109991085/att_1334694/v1/BA_SxP_76_en-US.pdf)
- [Cisco module and host data-rate support](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/data_sheet_c78-455693.html)

Passive MPO harnesses, new breakout modes and wavelength dash patterns remain
outside this phase. Duplex dual-line drawing is covered by the update above.
