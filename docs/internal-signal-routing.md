# Internal Signal Routing

Engine devices can opt in with **Device Editor > Device > Device Options >
Enable internal routing**, below **Has Swappable Cards**. Matrix devices keep
their existing exclusive Matrix controls and crosspoint tables.

For an enabled project device, right-click its canvas body and choose **Internal
Signal Routing**. The window uses the Engine Device Editor preview surface and
the Matrix route anchors, curves, gradient renderer and buffer. Drag between an
input and output, or click the two ports. Drag the background to pan; use the
wheel or toolbar to zoom. Select a route and delete it with **Delete Route** or
Delete/Backspace. Escape cancels an unfinished wire; Close ends the window.
Edits commit immediately through project history and support Undo/Redo.

`template.enableInternalRouting` enables the feature. Project instances own an
optional `internalSignalRoutes` array of `{inputId, outputId}` pairs using resolved
connector IDs, including installed-card IDs. Inputs and outputs support fan-out
and fan-in, with no cable-type, bandwidth or processing checks. Duplicate pairs
are idempotent. Empty/missing ports and stale endpoint IDs are not projected.
Disabling the feature leaves the stored instance routes intact but inactive.

Routes never enter `connections`, allocate Cable IDs, occupy physical cable
ports, or add Cable Schedule rows. Existing cables, connector geometry, card
slots and definitions remain unchanged. Scene-only serialization and normal
project save/reopen retain the capability and routes. Engine canvas, Output
Viewer, offline HTML and PDF reuse the Matrix internal gradient layer.

Signal Chain adds explicitly declared directed processing edges to its existing
connectivity graph. The shared graph walker enumerates fan-in/fan-out paths;
ordinary devices without enabled routes remain boundaries. Conversion routes
do not require matching endpoint colors/types. Physical lead validation remains
unchanged. Each edge is visited at most once per path, so feedback loops produce
cycle diagnostics rather than infinite traversal. Logical edges have no cable
length and are never counted as physical cables. Branches are shown separately
in the existing Signal Chain window and exported HTML viewer.

Coverage: `test/internalSignalRouting.test.mjs` and
`scripts/internal-signal-routing-smoke.mjs`. Legacy has no new menu, interaction,
renderer or routing behavior; the new Device Options control is Engine-only.
