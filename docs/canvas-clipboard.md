# Canvas Clipboard

Build 54.35.2 hardens the existing canvas copy/paste entry points. The native
`copy` and `paste` events are the primary transport. Cmd+C/V on Apple platforms
and Ctrl+C/V elsewhere remain browser shortcuts; Alt is not a clipboard modifier.
Text fields, contenteditable elements, selected browser text and modal editors
retain their native clipboard behavior.

## Transport and Contract

- `AVDESIGNER_SELECTION_V1:` prefixes deterministic, validated JSON.
- Async `navigator.clipboard` supports command calls and browsers that suppress
  native events. Tab-owned image URLs are embedded before either transport writes.
- A single versioned localStorage record provides a same-origin fallback, with a
  30-minute expiry. Copy status identifies system success, fallback or failure.
- Non-AV or invalid system text is rejected, never replaced by stale fallback data.
- Guards cap payloads at 16 MiB, 1,000 objects, 5,000 physical wires, 250,000 JSON
  values and 48 nesting levels. Storage quota failure does not block system copy.
- No application objects, executable values, cycles or DOM resources enter JSON.

`src/engine/canvasClipboard.js` owns selection dependencies, validation, remapping
and pure paste planning. The classic application entry points adapt native events
to that module. Engine commits the prepared plan as one undoable command, after
validating its complete normalized scene; failed commits restore the prior state.
Legacy application mode uses the same payload and planner, not a second clipboard.

## Objects and Dependencies

Devices (including adapters, LED processors, matrices, Power Distros and installed
cards), LED surfaces, areas, Jump Nodes, comments, title blocks, images and racks
are included. Complete rack selections preserve membership, exposed ports and
internal connections. Selecting only some rack members copies independent devices.

Physical wires are included only when both endpoints are selected. Route points
translate with the rigid group. Paired Jumps receive new link/pair IDs; a singleton
is detached. Every pasted project identity is new. Template-local connector/card
IDs remain intact so installed connector endpoints continue to resolve.

Required custom device and connector definitions travel with the selection.
Identical definitions are reused; content collisions get deterministic new IDs
without overwriting destination definitions. Card definitions remain embedded in
their device definition. Built-ins remain references. Undo removes imports only
when no remaining object requires them.

Wire-only and connector-only selections are not independent pasteable objects.
Missing built-in definitions fail validation. The fallback requires the same
origin and available storage; real system copy works independently of the source
tab after it closes. Oversized groups may extend beyond the current viewport;
paste does not alter the camera to force them into view.

## Verification

- `node --test test/canvasClipboard.test.mjs`: serialization, invalid payloads,
  stable identities, dependencies, geometry, racks, undo/redo, expiry, platform
  modifiers and a 129-device mixed performance fixture.
- `node scripts/canvas-clipboard-smoke.mjs`: real shortcuts between separate
  Chromium tabs containing different projects, source isolation, imported assets,
  repeated paste, source-tab closure, transaction rollback, text/modal isolation
  and denied-transport fallback. Configure `AVDESIGNER_BASE_URL`,
  `AVDESIGNER_PLAYWRIGHT_PATH` and `AVDESIGNER_CHROME_PATH` as needed.
- Chrome permits trusted clipboard events despite async permission denial. The
  fallback test denies the async permission and additionally simulates denied
  native DataTransfer access while retaining real keyboard shortcuts/events.
- Native browser acceptance was exercised on macOS Chrome. Windows/Linux modifier
  handling has unit coverage, not an OS-level browser run.
