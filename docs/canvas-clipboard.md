# Canvas Clipboard

Build 54.35.4 normalizes clipboard image MIME from bytes, extending the asset-safe
envelope introduced in 54.35.3 at the existing canvas copy/paste entry
points. Native `copy` and `paste` events trigger the workflow. Cmd+C/V on Apple
platforms and Ctrl+C/V elsewhere remain browser shortcuts; Alt is not a modifier.
Text fields, contenteditable elements, selected browser text and modal editors
retain their native clipboard behavior.

## Transport and Contract

- `AVDESIGNER_SELECTION_V2:` prefixes validated JSON. V1 is rejected explicitly;
  this changes only the temporary clipboard format, not saved projects.
- Canvas copy cancels the native event synchronously, prepares assets, then uses
  async `navigator.clipboard.writeText`. It never writes to an expired native
  DataTransfer event. Native paste remains the primary reader.
- Preparation status stays visible until asset storage and the compact envelope
  are complete. Success distinguishes system clipboard, fallback, both, or failure.
- A single versioned localStorage record provides a same-origin fallback, with a
  30-minute expiry. Copy status identifies system success, fallback or failure.
- Non-AV or invalid system text is rejected, never replaced by stale fallback data.
  A newer explicitly fallback-only AV copy can supersede an older AV envelope left
  on the OS clipboard by a denied async write.
- Guards cap payloads at 16 MiB, 1,000 objects, 5,000 physical wires, 250,000 JSON
  values and 48 nesting levels. Storage quota failure does not block system copy.
- No application objects, executable values, cycles or DOM resources enter JSON.

## Temporary Artwork Store

`canvasClipboardAssets.js` uses IndexedDB database `avdesigner-canvas-clipboard`,
store `assets`, keyed by `sha256:<hex>` from Web Crypto SHA-256 of decoded bytes.
Each record contains the hash, MIME type, Blob, byte length, creation time and
expiry. Equal content is stored once, regardless of field name or data URL encoding.
Copies extend the asset lease, never shorten another unexpired envelope's lease.
Expired records are collected at startup, copy and paste; expired envelopes fail
even if a later copy renewed their asset records.

Discovery is content-based throughout selected data and its dependency closure,
including faceImage, thumbnailImage, connector thumbnails, card data, surface/image
image/src/href aliases and title-block logo/companyLogo fields. Stable repository
and ordinary remote URLs remain unchanged. Blob URLs are resolved before copying,
so source-tab closure cannot invalidate the result.

Images below 64 KiB may remain inline, up to a combined 256 KiB inline-string budget.
Larger images and all blob URLs use explicit `$avdClipboardAsset` markers plus a
sorted manifest. The marker is reserved; project data containing it is rejected.
Limits: 64 MiB per decoded image, 256 MiB total unique image bytes, 256 unique images.
The existing 16 MiB JSON limit still applies to the compact envelope. Limit errors
include measured and allowed values. PNG/JPEG/GIF/WebP/AVIF/BMP/ICO containers are
identified from their bytes, with signature, minimum structure and length checks;
image-only SVG requires valid UTF-8 and rejects active content and external
dependencies. This is not a replacement for the browser's raster decoder.

Detected MIME is authoritative, even when a data URL or Blob declares the wrong
type. Manifest entries and stored Blobs use the canonical detected MIME (`image/png`,
`image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `image/bmp`, `image/x-icon`, or
`image/svg+xml`). Each data URL reference independently preserves its supported
original header as representation metadata; inline data URLs remain unchanged.
For example, PNG bytes labelled `data:image/jpeg;base64` store as PNG but restore
with the original JPEG header. Correct/incorrect headers and empty/incorrect Blob
types still deduplicate to the same SHA-256 asset. Blob sources restore canonical
data URLs. Copy does not migrate or rewrite the source project or its definitions.
At paste, actual bytes must still match the canonical manifest MIME. Relaxing the
representation header never bypasses byte, length, hash or SVG safety validation.

Paste validates the envelope/manifest, loads every record, verifies byte length and
SHA-256, restores detached data URLs, then runs the existing complete paste planner.
Missing, expired or corrupt assets abort before any mutation or undo entry. Asset
references require the same origin, browser profile and available IndexedDB; they
are not system-wide portable. Inline-only envelopes do not require stored assets.
The asset lifetime is 30 minutes, matching the fallback.

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
- `node --test test/canvasClipboardMime.test.mjs`: real encoded image formats,
  incorrect MIME declarations, Blob types, header-preserving deduplication,
  truncated/unknown bytes, disguised unsafe SVG, definition reuse and undo/redo.
- `node scripts/canvas-clipboard-smoke.mjs`: real shortcuts between separate
  Chromium tabs containing different projects, source isolation, imported assets,
  repeated paste, source-tab closure, transaction rollback, text/modal isolation
  and denied-transport fallback. Configure `AVDESIGNER_BASE_URL`,
  `AVDESIGNER_PLAYWRIGHT_PATH` and `AVDESIGNER_CHROME_PATH` as needed.
- The browser suite includes an asset-heavy fixture, closes its source tab, tests
  real async permission denial in the correct browser context, checks actual
  rendered pixels/screenshots, and corrupts/deletes/expires IndexedDB records to
  prove no mutation or undo entry is created. The prior mixed-object/native-event
  suite still runs, including denied native DataTransfer access.
- The same browser acceptance runs again with PNG faceplate/image bytes declared
  as JPEG. It verifies rendered pixels in source/destination/fallback tabs,
  canonical IndexedDB MIME and unchanged original headers after source closure.
- Native browser acceptance was exercised on macOS Chrome. Windows/Linux modifier
  handling has unit coverage, not an OS-level browser run.

## Reproduction and Diagnostics

Before the fix, the regression failed at `621c27d` with exactly:
`Clipboard payload is unsupported or invalid: text is too large`.
Its initial inline fixture JSON was 78,907,092 bytes: 78,905,324 bytes of embedded
image strings, three unique assets across six references. The large valid PNG alone
decodes to 14,749,513 bytes and exceeds 16 MiB as a data URL. The fixture also has
distinct connector PNG and card SVG artwork, an image object, two devices and a wire.

The final real-browser payload measures 78,907,392 bytes inline versus 3,377 bytes
for the compact envelope. IndexedDB stores 14,930,343 bytes in three records.
`window.avDesignerClipboardDiagnostics` reports non-asset JSON bytes, original
inline size, compact size, unique/stored bytes and counts, references and largest
asset size, never asset contents. Byte totals can vary with instance metadata.

Card artwork fields are preserved, including SVG; the existing card-band renderer
continues to display its caption/band rather than introducing a card image renderer.

Before MIME normalization, both a 68-byte inline PNG and a 102,638-byte external
PNG declared as JPEG failed at `d29a621` with exactly:
`Clipboard image bytes do not match image/jpeg.` Both regressions were confirmed
red before production changes. Invalid-image diagnostics now identify the field
path, declared MIME, detected MIME (or unknown) and byte length, never asset content.
