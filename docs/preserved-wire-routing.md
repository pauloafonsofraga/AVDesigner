# Preserve User-Defined Cable Routing

Build 54.38.150 keeps global routing changes separate from per-cable authored
geometry. The global Bezier/90-degree button affects automatic cables and the
default for new cables. Manually placed paths, edited control points, and moved
orthogonal segments retain their own style and points. Node and cable endpoints,
connector compatibility, rack-internal routing and Multi-Core trunk rules are
unchanged. Legacy routing remains unchanged.

The existing `manualRoute` and `manualRouteStyle` fields describe authored paths.
An optional backward-compatible `routeAutomatic: true` marker identifies known
automatically generated point caches. Previously, automatic cached orthogonal
points and hand-edited segments used the same array without reliable ownership
metadata. Unmarked historical nonempty route arrays are therefore conservatively
preserved as authored geometry, not discarded or reinterpreted by a mode switch.
There is no migration or rewrite on load. Explicit manual ownership always wins.

**Reset Wire Route** in the Inspector or cable context menu clears authored
ownership and returns the cable to the current global routing mode. Reset,
control-point edits and segment drags use existing history commands, now carrying
the route ownership as well as its geometry. Undo/Redo restores both; automatic
history states follow the currently selected global mode. Canceled previews do
not claim ownership or dirty the project. History snapshots retain subpixel
authored coordinates.
Deleting the last control point retains the existing behavior of returning that
cable to automatic routing as well.

The global routing toggle also records its mode change in the existing Engine
command history, so Undo/Redo of the toggle never rewrites per-cable routes.

One pure routing policy is shared by live synchronization, saved-project
normalization and output snapshots. It does not modify source connections.
Existing project serializers retain the optional marker; HTML/PDF consume the
same normalized per-cable geometry.

Regression coverage: `test/preservedWireRouting.test.mjs` and
`scripts/preserved-wire-routing-smoke.mjs` exercise mixed manual/automatic cables,
both routing modes, historical points, edits, Reset, history, save/reopen and
offline HTML geometry parity plus production PDF export. The existing
`scripts/route-point-zoom-smoke.mjs` covers native point editing at multiple zooms.

## Pre-existing Broad Smoke Failure

The unrelated Loom finishing-click assertion in
`scripts/routing-placement-browser-smoke.mjs:671` fails with
`bezier-direct: browser emitted finishing pointerdowns` on both this change and
untouched baseline `980ce71b9398c0bff176bf61ddd71178dc86fe2e`. Reproduced with:

```sh
AVDESIGNER_BASE_URL=http://127.0.0.1:8792 \
AVDESIGNER_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node scripts/routing-placement-browser-smoke.mjs
```

Port 8792 served an isolated archive of the baseline. The same stack is at
`createFinishingDoubleClick` line 671, called at line 685; this concerns the test's
count of finishing Loom pointer events, not cable routing preservation. No Loom
production code or this assertion was modified. The focused cable-routing and
existing route-point zoom browser checks pass separately.
