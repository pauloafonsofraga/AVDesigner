# Device Editor and Jump follow-ups

Build 54.38.137, `engine-prototype`. No deployment or release tag.

## Changes

- Jump clipboard presentation is selected before strict JSON serialization. Undefined optional fields and runtime topology are not serialized. Jump cables are excluded before cloning as well. Destination ID reservation tolerates repeated/cyclic runtime references without accepting non-JSON clipboard payloads. Paste always creates independent empty Jumps; originals are retained.
- Connector fields no longer participate in annotation displacement. Their vertical anchors remain authored; opposing rows divide the available horizontal space. Field widths decrease with zoom, text is fitted or hidden, and outlines remain visible. Engine and SVG card previews share the width calculation. Caption-only collision avoidance remains enabled. No authored layout or connector data changes.
- Ordinary Engine devices have optional `backplate` artwork, containing the existing image/transform fields. The Faceplate tab's selector and Upload Backplate button reuse the image preparation and resize/move controls. The Connectors preview substitutes the Backplate only in a detached rendering view. Front artwork remains the default on the main canvas and all normal outputs. No existing device requires migration. Saved project/personal definitions retain Backplate bytes using the existing recursive artwork asset path. Unused Backplate artwork does not become an additional canvas/export texture.
- At fitted chassis zoom, the old 18-pixel installed-connector hit tolerance could cover an entire visible card body and intercept card dragging. Card-body hits now use a precise 4-pixel connector tolerance; other connector picking is unchanged. Existing placement solver, fixed/locked bay rules and neighbor animation are retained. Reordering adds a faded existing card icon/name ghost and retains the insertion indicator. Dragging never remaps slot/card/connector identities.
- Replacing a connected installed card asks exactly: "This will remove the current card connected nodes", with Proceed and Cancel. Detailed replacement information is logged only for debugging. Approval is held outside saved definitions. No project cables change during draft edits, cancellation or discard. Save removes approved affected cables in the same snapshot transaction as the card change; project undo restores both. The production bridge independently verifies approved removal keys against actual replaced slots. Unapproved changes and retained incompatible cables still fail validation. Unconnected cards do not prompt.

## Verification

- Focused Node regressions cover undefined/cyclic Jump runtime data, isolated paired/Loom/Multi-Core Jumps, Backplate transforms and portability, deleted front faceplates, opposing field widths, and narrowly authorized card connection removal.
- `scripts/editor-followups-smoke.mjs`: installed Chrome checks replacement Cancel/Proceed/Save/Undo/Redo; unconnected replacement; Backplate upload/resize/save/reopen; offline HTML and PDF; opposing shared buses at 100%, 85%, 55%, 34%, 15%; actual Jump paste and undo/redo without changing original topology.
- `scripts/card-reorder-smoke.mjs`: real pointer drags, ghost/target, animated neighbors, cancellation, undo/redo, fixed/locked slots, save/reopen and offline HTML/PDF, including 12- and 24-card chassis.
- `scripts/card-safety-browser-smoke.mjs` is updated for the intentionally changed connected-card confirmation/removal contract. Programmatically bypassing approval remains rejected.
- `scripts/connector-label-collisions-smoke.mjs`: caption collision checks at eight side/zoom combinations, stable SVG field rows, hover, unchanged authored geometry, equal canvas/offline-HTML drawing, and PDF export.
- `scripts/faceplate-content-bounds-smoke.mjs`: original PNG bytes, alpha bounds, resize/move/undo/cancel, save/reopen and exports remain unchanged for front artwork.
- Full Node suite, all 16 static validators and all three generated bundle checks are run against the staged isolated tree before commit.
- Final isolated suite: 1,919 tests pass (the 20 unrelated uncommitted import tests are excluded). The independent production PDF smoke passes all 23 cases without warnings.
- Screenshots and a rasterized exported PDF are inspected. Test artifacts stay outside the repository under `/tmp`.

## Protection and scope

The pre-existing Device JSON Import changes in `index.html` and `src/personalDefinitions.js` are excluded from the commit. All 101 protected artwork, backup, Masters and import files are hash-checked. Factory definitions and artwork are not modified. Legacy and the Multi-Core editor are not extended. Physical or locked bays remain intentionally non-reorderable. Backplate selection is editor-only; normal canvas/HTML/PDF artwork remains the Faceplate.
