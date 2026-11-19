# Mini-USB-A and Triax Connectors

Added factory nodes `mini-usb-a`, `triax-8`, `triax-11` and `triax-14`.

- Mini-USB-A: brown `#795548`, distinct from the other USB shades. Uses the
  existing bidirectional USB-family compatibility and USB schedule numbering.
- Triax 8, 11 and 14: steel blue `#5B8FA8`. All three sizes mate with one another
  in either connection-drawing order. Normal input/output and faulty-node checks
  remain enforced. Triax does not implicitly mate with BNC, SDI or other families.
- Triax cables use the Video family and VX numbering. Matrix eligibility follows
  ordinary video connectors; Mini-USB-A follows the existing USB exclusion.
- Existing node appearance and cable geometry are unchanged. The neutral existing
  thumbnail is used rather than an inaccurate connector photograph.

The Device Editor, Engine, output bundles and shared validators use the same
new IDs. Factory node-only curation receipts follow the existing multiband-node
pattern. Historical library tests explicitly remove only these four verified
additions before checking their original source inventories.

Validation: 2,537 automated tests pass. Chrome verifies palette availability,
real mouse connections for all three cross-size Triax combinations and Mini-USB-A
to USB-A, Undo/Redo, HTML and `.avd` save/reopen. All 50,625 existing connector
pairings match the starting baseline; device definitions and artwork are unchanged.

No deployment or infrastructure changes.
