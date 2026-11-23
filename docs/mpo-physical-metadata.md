# MPO Physical Metadata (Step 2B)

The existing `fiber-mpo` identity and colour resolver are unchanged. This is
physical metadata, not a breakout, optical path solver or new cable type.

## Ownership and Version

Fixed device and card connectors use optional `connector.mpoPhysical`.
Installed MPO optics use `connector.moduleCapabilities.mpoPhysical`, so removing
or replacing the module removes that module's properties without changing the
host cage. Existing projects are not migrated and receive no physical defaults.

```json
{
  "schemaVersion": 1,
  "format": "mpo-12",
  "positionCount": 12,
  "reference": "mating-face-key-up-left-to-right",
  "fiberCategory": "om4",
  "termination": "receptacle",
  "pinConfiguration": "pinned",
  "keying": "centered",
  "keyOrientation": "up",
  "matingOrientation": "key-up-to-key-down",
  "polish": "upc",
  "populatedPositions": [1, 2, 3, 4, 9, 10, 11, 12],
  "activePositions": [1, 2, 3, 4, 9, 10, 11, 12]
}
```

Except for the version, fields may be omitted. An omitted array means unknown;
an empty array explicitly declares no populated or active positions. MPO-12 is
a 1x12 ferrule even when only eight positions are populated. Other formats
require a later version/extension; imported raw properties remain recoverable.
OS2, OM3 and OM4 are supported; omission means unspecified. Gender is represented
only by guide pins: pinned (male), unpinned (female). There is no independent,
potentially contradictory gender flag.

The numbering reference is a normalized mating-face view with the key up and
positions increasing left to right, not connector placement on the canvas.
`keyOrientation` records the physical key's authored orientation; it is not a
rotation command or a cable-polarity shortcut. `matingOrientation` describes
the adapter's relative key alignment.

## Validation Boundary

The shared Engine summary rejects malformed declarations, OS2/multimode
conflicts and contradictions with declared optical module properties.
OM3/OM4 mixing is not declared incompatible solely because the grades differ.
Direct mates require one pinned and one unpinned ferrule, compatible polish and
keying. Conventional APC MPO-12 requires key-up to key-down mating.

A declared plug is a mateable end. Two equipment receptacles connected by a
drawn patch cable are not directly mated: the unspecified cable may have two
unpinned ends. Such links remain Unverified rather than incorrectly rejecting
two pinned ports. Patch-end editing/validation as a separate cable configuration
is not implemented here. Unknown legacy terminations also remain Unverified.
Fully declared mating interfaces can be physically Compatible, but the Engine
does not claim a verified end-to-end optical path from physical metadata alone.

## Position Maps

Optional `positionMapping` contains `schemaVersion: 1`, `scope: "cable"`,
`positionCount: 12`, `fromReference`, `toReference`, optional `polarity` and
`pairs: [{from: 1, to: 12}, ...]`. Both references use the normalized view above.
Source/destination positions must be unique; partial maps remain Unverified.

Explicit presets: A maps i to i; B maps i to 13-i; C swaps adjacent pairs.
A preset materializes all twelve pairs. A contradictory label/map is rejected.
Neither these pairs nor Step 1's historical `optical.laneMapping` list define
transceiver TX/RX assignments. No lanes, branches or signal paths are generated.

## Controls and Preservation

Custom MPO Inspector edits apply as soon as a selection is made or a text field
is committed. Fixed MPO uses the same fields in the Device Editor, Card Editor
and Canvas Inspector, with explicit Apply. Termination and numbering reference
are not editable here; historical values remain stored, and new position entries
use the standard reference internally. Opening the controls does not modify a device.
Occupied ports must be disconnected before changing their physical properties.

The existing project mutation/history, instance/card overrides, output contract
and device package paths carry the metadata. No reporting columns, cable counts,
geometry or routing modes were added. Invalid imported attachments remain
documented and are handled by the existing validated connection-status path.

## Detachable harnesses

An unoccupied MPO port can attach an MPO-12 to four duplex LC harness in OM3,
OM4 or OS2. The harness is one Adapter/Breakout instance with a private template,
stable trunk and branch connector IDs, a fixed fibre-position map and its own
length. The project uses normal connection gestures for the attachment legs;
the schedule counts them together as one harness. The trunk can be disconnected
without changing the optical module. It does not configure host breakout mode,
claim operational lane compatibility or add a separate polarity control.
When the trunk faces right, the layout is mirrored horizontally to keep the
labels and branch order upright. Older half-turned harnesses keep their
connector positions and existing attachments, with upright text.

## References

- [Corning mating and pin placement](https://www.corning.com/catalog/coc/documents/application-engineering-notes/AEN069.pdf)
- [Fluke Type A/B/C polarity](https://www.flukenetworks.com/blog/cabling-chronicles/101-series-12-fiber-mpo-polarity)
- [Fluke APC mating orientation](https://www.flukenetworks.com/blog/cabling-chronicles/getting-12-and-8-fiber-polarity-right)
