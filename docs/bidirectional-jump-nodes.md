# Bidirectional Jump Nodes

Build 54.31.1 fixes Jump role inference without changing saved link or wire data.
Output Migration Stage 3 remains paused.

## Roles and orientation

The local physical connector determines `baseRole`: neutral, input, output, or
bidirectional. V2 `signalDirection` takes precedence; explicit bidirectional
aliases include io, bidirectional, bi-directional, two-way, twoway, and both.
Unknown/missing direction remains neutral. The normalized connector's scalar
`jumpBaseRoleHint` retains that distinction when general connector normalization
defaults an unknown direction to io. It is runtime/output-scene metadata, not a
new saved-project field.

An unpaired bidirectional Jump is teal (#26c6a3). Once paired, the saved
`outputJumpId` / `inputJumpId` determines its effective role and existing blue /
orange color. Validation always uses the base role, so saved orientation cannot
hide a newly incompatible strict connector direction.

Strict output/input pairs are valid. A bidirectional endpoint complements either
strict role. For two bidirectional endpoints, the held endpoint becomes output.
Equal strict roles, neutral endpoints, self-links, and already-paired endpoints
are rejected. Existing real connector family, module, operational-status, and
fiber checks still apply. Older pairId links use stable project order for two
bidirectional peers and complementary orientation when a strict role exists.

Physical wire endpoints are not rewritten by pairing. Trace traversal reverses
the input-side cable when both physical cables were drawn device-to-Jump.

## Consumers and lifecycle

Engine SceneGraph and production bridge refresh roles on wire/link mutations,
restores, and connector synchronization. Legacy cleanup runs at committed wire
changes and Device Editor instance Apply, not during temporary rewire detachment.
Its wire-only SVG refresh also updates Jump colors, glow and information labels
in place; otherwise a correct semantic role could still leave a grey circle.

The canonical output scene and Stage 2 viewer reuse Engine roles and tracing.
The current standalone HTML viewer embeds shared shell role helpers. No HTML,
Publish, or PDF renderer migration is included. The renderer fingerprint is
unchanged; app/cache and production-bridge fingerprints identify 54.31.1.

## Verification

The initial focused regressions failed before implementation (20 failed, 63
passed). A separate rendered-color regression reproduced Legacy's stale grey
SVG after wire creation before its refresh was corrected.

- Focused role, gesture, output-scene and output-viewer tests: 111 passed.
- Full Node suite: 706 passed, 0 failed, 0 skipped.
- All 11 scripts/*validation.mjs: passed, no skips.
- Inline script and changed module syntax checks; git diff --check: passed.
- New Chrome acceptance: 28 groups passed across Engine and Legacy. Uses two
  actual Netgear M4250 catalog devices configured as V2 bidirectional endpoints.
  Covers real cable/hold gestures, click selection, empty release, effective and
  rendered colors, Jump to Pair, undo/redo, save/reload, unlink/re-pair,
  duplication, same-tab copy/paste, direction synchronization, local-wire
  deletion, real Shift-rewire, and both output viewers' playback. Stage 2 link
  selection is exercised by an actual mouse click. No console errors.
- Existing Jump hold browser suite: both modes, Fit and 100%, cancellation paths,
  invalid targets, multi-selection and Shift-rewire cancellation passed.
- Output-scene browser smoke: Engine and Legacy parity, unchanged HTML/PDF
  drawing ownership, deterministic snapshots and offline HTML passed.
- Stage 2 viewer browser smoke: representative and 100-device/300-wire fixtures,
  desktop/mobile, dark/light, nonmutation and live GPU parity passed. Optional
  private large-project performance was skipped because no
  AVDESIGNER_REAL_PROJECT_PATH was supplied for this run.

Legacy still has no dedicated disconnect button. Its unlink test uses the
existing canonical mutation adapter, followed by real undo/redo and re-pair
gestures; Engine uses the inspector's Disconnect Jump Nodes button. This task
does not add a new Legacy UI action.
