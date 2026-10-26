# Device Editor Height

Auto Height continues to use the existing content-height calculation. Disabling
it captures the current height in the existing `manualHeight` property. In Engine,
the Device tab then shows a numeric Height field with the current content minimum.

Manual edits use `setEditorDeviceHeight` and the existing editor history. Values
below the connector/slot footprint clamp to its minimum; blank or nonfinite input
restores the current value without creating an undo entry. Enabling Auto Height
clears the manual floor and recalculates from geometry, including contraction of
historically oversized devices. No schema, artwork, node-position or cable changes
are introduced. The new field is not exposed in Legacy.

`test/deviceEditorManualHeight.test.mjs` covers mode transitions, minimum bounds,
automatic growth/contraction, serialization and rejected input. Run
`node scripts/device-manual-height-smoke.mjs` against a local server (override
`AVDESIGNER_BASE_URL` if needed) for Chrome acceptance, undo/redo, save/reopen,
Discard and connected-project preservation. It also checks MCTRL4K, E2 Gen2 and
Pixera Two factory definitions with unusually large historical height metadata.
