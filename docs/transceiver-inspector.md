# Editable Transceiver Inspector (Phase A)

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

Passive MPO harnesses, new breakout modes, wavelength dash patterns and duplex
dual-line drawing are outside this phase.
