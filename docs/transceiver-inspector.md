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
rates and the current module or selected preset's rates. Unknown host support remains unverified.
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

References for conservative hardware eligibility:

- [Siemens distinguishes SFP and SC/ST pluggable formats and host slots](https://cache.industry.siemens.com/dl/files/085/109991085/att_1334694/v1/BA_SxP_76_en-US.pdf)
- [Cisco module and host data-rate support](https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/data_sheet_c78-455693.html)

Passive MPO harnesses, new breakout modes, wavelength dash patterns and duplex
dual-line drawing are outside this phase.
