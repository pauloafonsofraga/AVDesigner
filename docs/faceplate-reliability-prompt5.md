# Prompt 5: Single-Image Faceplate Reliability

## Scope and baseline

- Starting local and fetched `origin/engine-prototype`: `66184558b5ef2dc53e86652b6b78f9696af02f76`, build 54.38.126.
- Result build: 54.38.127. No deployment, release tag, or Prompt 6 work.
- The revised request supersedes the original prompt's independent front/rear assumption. Ordinary devices have one `faceImage`, natural dimensions, scale/axis scales and offsets. There is no ordinary-device face selector, image-body move tool, rotation tool or crop tool. None was added.
- Eight existing custom-image resize handles, image replacement, Fit, zoom and middle-button pan remain the interface. Generated power-distro faceplate/plug editing and Multi-Core front/rear editing are unchanged.

## Confirmed defects and repairs

1. **VERIFIED PASS: image resizing no longer changes structural geometry.** The previous custom-image resize path recalculated the connector origin and rebased modular placement. Native Chrome reproduction moved physical card slots from `[155,422]` to `[137,407]` and reduced chassis height from 687 to 672. The new artwork-only transaction preserves connectors, anchors, relationships, slots and height exactly; validates card safety before commit; and records one history operation.
2. **VERIFIED PASS: replacing an existing image no longer shifts slots/connectors.** Replacing a wide image with a square image reproduced the same structural coupling. Replacement now preserves the existing structural reservation and commits atomically. First artwork insertion and explicit faceplate removal/deletion retain their existing structural semantics.
3. **VERIFIED PASS: north/south handles preserve horizontal placement.** The old calculation reconstructed horizontal bounds even for a vertical-only resize. The shared geometry helper now changes only the requested edges, with stable opposite anchors and positive bounded dimensions. All eight handles and extreme deltas have regression coverage.
4. **VERIFIED PASS: handles remain usable across zoom levels.** Handles previously grew with the artwork; a fitted view produced handles roughly 45 screen pixels wide. The Engine now uses a 12px handle body, plus its 2px outline, and updates it on camera changes. Legacy dimensions are unchanged.

The existing aspect-ratio rendering policy is preserved: independent axes resize the placement box, and the bitmap is fitted proportionally inside it. No stretching, mirroring, rasterization or resampling is introduced by resizing.

## Narrow persistence repair

The old image height also owned the connector-layout origin. Retaining image-only transforms while keeping that origin fixed requires one optional reservation:

```json
{
  "faceImageLayout": {
    "height": 95,
    "connectorBounds": {"x": 20, "y": 46, "width": 340, "height": 79}
  }
}
```

This is layout metadata, not another image, transform, ownership scheme, or visible-content bounding box. It captures the pre-edit header height and the rectangle previously used for faceplate-side connectors. Existing scales/offsets remain the only artwork transforms. It is created only on explicit Engine artwork resizing or replacement; malformed reservations fall back to historical geometry. Opening an old definition alone does not add it. Explicit image removal clears it.

The reservation is retained by configuration capture/default restoration, personal settings compaction, project normalization, SceneGraph normalization and output snapshots; it participates in visual cache identity. Device definitions and factory artwork are not rewritten. The Engine-only shell gate leaves Legacy behavior unchanged. Source bytes remain unchanged through resize, undo/redo and project save/reopen.

## Interaction and persistence acceptance

**VERIFIED PASS**, using installed Google Chrome through Playwright and actual pointer/file/button interactions:

- Asymmetric 2048x512 PNG on a connected modular chassis, including a fixed chassis connector and a faceplate-side connector.
- South resize, east resize, north resize, preview/commit equality, no draft mutation during preview, stable slots and chassis height.
- Exact undo/redo; a completed resize contributes one history entry.
- Escape and pointer cancellation; zoom, middle-button pan, resize at a second zoom; fixed-screen handles.
- Keep Editing, Save Project Device, reopen, Discard Changes, project download/reload, original image bytes retained.
- Engine connector/anchor geometry and logical cable endpoint identities retained after artwork edits and reload.
- Different-aspect replacement, replacement undo/redo, malformed PNG error recovery, successful close after the error.
- Three repeated open/resize/cancel/close cycles without stale draft state or page errors: 999ms in the recorded run. This is end-to-end automation time, not an FPS or memory benchmark.

The synthetic fixture is saved once before measuring artwork edits so its newly added test image has canonical authored geometry. Existing initialization of old fixtures is not mistaken for an artwork edit. Cable comparisons cover logical identities/endpoints, not incidental cached polyline data.

**VERIFIED PASS: output**: hosted-viewer preparation, self-contained HTML opened with network disabled, the shared Output Viewer scene, and focused production PDF download. Reopened editor, offline viewer and rendered PDF screenshots were inspected; the red-left/blue-right artwork remains correctly oriented and proportioned. Poppler rendered the PDF successfully (with an environment fontconfig warning).

**VERIFIED PASS: unchanged previous workflows**: card swap safety and connected-card PDF export, Jump/node replacement, card area resizing/names, and animated card reordering in Chrome.

## Validation

Run against an isolated archive of the staged tree, with unfinished Device JSON Import excluded:

- `node --test test/*.test.mjs`: **1,851 passed**, zero failed/skipped.
- Focused Device Editor and new faceplate tests: **259 passed** (included above).
- All **16** `scripts/*-validation.mjs` validators passed.
- `node scripts/build-output-viewer.mjs --check`: passed.
- `node scripts/build-pdf.mjs --check`: passed.
- `node scripts/build-cable-schedule.mjs --check`: passed.
- Changed JS syntax checks, classic inline shell parsing and `git diff --check`: passed.
- `faceplate-reliability-smoke.mjs`, `card-safety-browser-smoke.mjs`, `jump-node-replacement-smoke.mjs`, `card-area-names-smoke.mjs`, `card-reorder-smoke.mjs`: passed.

Existing tests that expected image replacement to rebase the origin were updated to assert exact connector/slot preservation and zero structural-solver calls. Removal and first-upload structural assertions remain. The structural harness's synthetic image bounds now agree with its synthetic connector origin; native acceptance uses the real geometry functions.

## Pre-existing PDF failure

**PRE-EXISTING ISSUE**, independently reproduced on untouched baseline `66184558b5ef2dc53e86652b6b78f9696af02f76` and the scoped candidate:

```sh
node scripts/engine-pdf-production-smoke.mjs
```

```text
TypeError: Cannot read properties of null (reading 'installedModule')
  at installedModuleCapabilities (src/engine/transceiverModules.js:69:28)
  at installedModuleDetailsForEngine (src/engine/connectorCompatibility.js:362:19)
  at engineConnectorFiberMode (src/engine/connectorCompatibility.js:514:19)
  at jumpInfoFromLocal (src/engine/jumpNodeModel.js:787:16)
  at jumpNodeConnectionInfo (src/engine/jumpNodeModel.js:405:12)
  at SceneGraph.jumpNodeConnectionInfo (src/engine/sceneGraph.js:237:12)
  at drawJumpNodeInfoBox (src/engine/renderer.js:4822:13)
  at src/engine/renderer.js:3793:33
  at Array.forEach (<anonymous>)
  at drawEngineOutputLabels (src/engine/renderer.js:3791:17)
```

Impact: the wider Jump-label PDF fixture cannot complete; this is not a general PDF export failure. The focused connected-card/faceplate PDF checks pass. Neither the failing smoke test nor unrelated PDF production logic was changed. Renderer/bridge edits are cache fingerprints only.

## Protections, evidence and limitations

- **VERIFIED PASS:** SHA-256 comparison of all 101 protected paths, including original personalDefinitions work, untracked artwork/faceplates/Masters/backups/import files. The original unstaged index.html import patch remains unchanged and excluded. Tracked factory artwork has no diff.
- Local evidence: `/tmp/wirenexus-prompt5/` contains baseline failure logs, full suite/validator/bundle logs, native acceptance, before/preview/reopened/offline screenshots, the downloaded project/HTML/PDF and `pdf-render.png`. Re-run the browser script with `AVDESIGNER_BASE_URL` for another local server.
- **KNOWN LIMITATION:** artwork resizing stays within the existing reserved header; it no longer grows the chassis. No new direct artwork-body dragging, crop, rotation, dual-face editing or transparent-pixel bounds.
- **KNOWN LIMITATION:** the existing upload preparation/resolution policy is unchanged. Existing artwork edits do not recompress; uploading a new file still uses the established preparation path.
- **KNOWN LIMITATION:** the existing renderer refresh path is retained during resize. This pass does not introduce a new image-overlay renderer or optimize all per-frame preview reconstruction.
- **NOT TESTED separately in Chrome:** personal-library duplicate/promotion round-trip, SVG-specific image replacement, huge-resolution stress, hour-long memory/resource soak, and a published remote viewer. Their shared persistence/output code has suite coverage, but those manual workflows are not claimed as completed.
- The revised single-image scope makes front/rear parity/switching tests inapplicable. Multi-Core, Legacy and future phase work were not changed.
