# Installed Card Layout Parity

Build 54.38.141 fixes the Aquilon Cmini MVR HDMI overlap demonstrated in
`Screen Recording 2026-10-23 at 16.30.17.mov`.

## Cause and Correction

Installation used independent input/output counters unless a card had saved
`editingBounds`. The Card Editor always used `cardConnectorEditingLayout`.
Consequently, a both-side LAN node failed to reserve the right-hand row during
installation, placing Genlock on top of LAN. Older shared-bus cards also had
different footprint calculations depending on whether they had been resized.

Engine installation, Connectors tab generation, and footprint calculation now
use the existing Card Editor layout regardless of resize metadata. MVR HDMI
offsets are `[0, 54, 108, 162, 54]`, with a 324-unit footprint. Existing slot
reservations remain a floor; the shared chassis solver makes room for expanded
content. Empty-slot reservations retain their full dimensions. No separate
installed-card algorithm or persistence schema was added; Legacy is unchanged.

Saving existing installed content permits vertical growth beyond historical
reservations while retaining side constraints and cable compatibility checks.
Replacement cards and explicitly changed reservations still require a fit.
Card, slot, connector and cable identities are preserved. The factory catalogue
and original artwork are not modified.

Output normalization also consumes the shared solver's resolved chassis rows.
Previously it used shifted card bands but ignored displaced chassis rows,
allowing the expanded card to overlap following LAN nodes in offline output.
These are derived display coordinates only; saved connector positions and
anchor metadata remain intact, and shared-bus members move as one group.
The derived chassis bounds include the resolved cards and connector margins,
so the shifted nodes cannot fall outside the rendered body. Saved dimensions
remain unchanged.

## Verification

- `test/cardEditorInstalledParity.test.mjs`: actual Aquilon cards, mixed
  connector counts 1/2/4/8/16, 36/54/72-unit rows, authored and historical
  bounds, shared buses, margins, JSON reopen, output parity and cable identity.
- Existing installation/placement tests and the real-project validator now
  expect both-side-aware footprints, keeping anchor and wiring assertions.
- `scripts/aquilon-card-layout-smoke.mjs`: Chrome Cards tab versus actual
  Connectors/Engine preview, screenshots, unchanged definitions and existing
  HDMI cable, Save As/reopen, and offline HTML viewer parity.
- Isolated staged tree: 1,974 Node tests; all 16 static validators; output
  viewer, PDF and Cable Schedule bundle freshness checks.
- Aquilon project production PDF download succeeds without browser errors;
  general HTML smoke covers offline export, simulated Publish and scale cases.

Unrelated Device JSON Import changes remain excluded. All 101 protected local
files are hash-checked, including artwork, Masters, backups and import work.
