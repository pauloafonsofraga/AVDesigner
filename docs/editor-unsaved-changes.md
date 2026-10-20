# Shared Editor Unsaved Changes Protection

Build: 54.38.114. Branch: `engine-prototype`.
Starting local and independently fetched/queried remote HEAD:
`5ddac820c2475fae3a3eab25cc732571ae44d5f6`.

## Scope and lifecycle audit

- Device Editor owns the detached device collection, connector/card definitions,
  instance name, dependency contexts and saved baselines. Its Faceplate, Cards,
  Connectors and Defaults tabs share this lifecycle; they are not separate windows.
- Multi-Core Editor owns `MultiCoreEditorDraft`, its original value, draft undo/redo,
  preview surface and expected personal-library revision.
- `src/editorLifecycle.js` provides one confirmation, session-owned Save/Close,
  serialized replacement, pending-field flushing, upload tracking and native unload
  protection. The bootstrap exposes the same module instance to the classic shell.
- Device Close and Escape, Multi-Core X/Cancel/Escape, replacement by another
  Device or Multi-Core editor, and Multi-Core duplicate/reload transitions are guarded.
  An awaited open declined with Keep cannot reset the retained draft's baseline.
- These editor backdrops do not dismiss on outside clicks. No dismissal was added.
  There was no existing editor-close-on-application-navigation path beyond these
  centralized functions, and no existing page `beforeunload` handler to replace.
- Explicit deletion still uses its existing destructive confirmation and revision
  checks, then disposes the successfully deleted editor. It does not offer to save
  a definition that has just been deleted.
- Defaults reset/discard-in-place remains its existing explicit operation. The new
  confirmation's Discard closes instead. Rack Builder and Node Builder have different
  state ownership and were not pulled into a broad dialog rewrite.
- No Legacy renderer, placement solver, connector identity, compatibility rule,
  Multi-Core mapping or Phase 4.1 validation implementation was changed. The historic
  `openDeviceEditorForCanvasInstanceLegacy` shell entry point now delegates to guarded
  initialization; this is also the current Engine Device Editor entry point.

## Comparison and actions

Device comparisons reuse `personalDefinitions.definitionContent`: sorted object keys,
authored array order, and the existing exclusions for incidental flags/revisions.
Closing checks all retained device drafts, not just the currently selected device.
Dependency contexts are immutable replacements: identical references are fast-pathed,
otherwise content is compared. Viewport, selection, texture caches and preview state
are outside the authored draft. Lazy image decoding does not write that draft.
Multi-Core compares stable JSON content against the detached opening value, retaining
all authored IDs, mappings, geometry, artwork and provenance.

Keep closes only the confirmation. Discard invokes disposal without persistence or
history. Save calls the existing persistence body, retaining its validation and
revision token, and disposes only after explicit success. The ordinary Defaults Save
still stays in the editor and advances only its saved baseline. A new device's Save
uses the personal library; existing project/library modes retain their existing save
destinations. Closing never silently chooses a save destination or promotes a factory
definition.

Validation/storage/revision failure returns to the usable draft and its existing
error display. The user can correct, retry, Keep or Discard. No guard action adds a
history entry; successful project saves retain their established atomic command.

## Keyboard, concurrency and resources

- Escape first cancels a current placement/drag, then on a later Escape requests close.
  PD faceplate plug cancellation restores the original authored placement (including
  absence of a manual placement), rather than committing the moved position.
- Confirmation focus starts on Keep, cycles through all three buttons, and returns
  to the previous editor control. Enter/Space activates the focused button. Escape
  means Keep and is intercepted before editor/canvas capture handlers.
  Native top-layer dialogs retain their own Escape cancellation without closing
  or prompting the underlying editor.
- Body siblings are temporarily inert while confirming. The saving editor is inert
  during persistence. Existing inert states are restored, not blindly cleared.
- Repeated Close shares one pending result; repeated Save shares one transaction.
  Replacement is serialized and cannot proceed while a save/library operation is busy.
  A disposed session's late result cannot close the replacement session.
- Pending uploads count as unsettled work. Save awaits them; Discard can dispose
  immediately. Device upload revision checks and Multi-Core closed-session checks
  prevent late artwork from modifying a replacement editor.
- Disposal removes field listeners and the session's unload listener, closes any
  confirmation and uses existing preview disposal. One shared lifetime keyboard
  dispatcher is installed before the shell; editors do not add another on every open.

Native `beforeunload` is scoped to an active dirty draft, pending upload or save. It
does not read/write the project's saved-file dirty state and adds no custom browser
dialog. Browsers control wording and may require prior user activation or suppress
the warning on process termination/mobile app shutdown. It is not autosave or crash
recovery. Chrome acceptance checks event cancellation and listener removal; it does
not claim reliable delivery after a browser/OS crash.

## Verification and evidence

Evidence directory: `/tmp/wirenexus-unsaved-2026-10-20/`.
An isolated checkout made from the Git index excludes every unrelated local file and
the unfinished import implementation. Tests run against the production files intended
for this commit, not only the mixed development checkout.

- Full isolated Node suite: 1,610 passed, zero failures/skips (`node-isolated.log`).
- The mixed working-tree suite also passed, including the 20 pre-existing,
  uncommitted Device JSON Import tests. Final production validation used the
  isolated checkout, including the final late UI-lock cleanup regression.
- All 16 static validators passed in the working and isolated checkouts.
- Output-viewer, cable-schedule and PDF bundle reproducibility/currentness checks pass.
- Inline shell and changed modules parse; staged/unstaged diff checks pass.
- `editor-unsaved-changes-smoke.mjs`: real Chrome buttons, fields, pointer drag,
  keyboard, focus/inert state, invalid Exclusive references, invalid channel mapping,
  history/canonical retention, replacement, late upload and simulated asynchronous
  storage failure. The simulated failure is explicitly injected; persistence/conflict
  smokes below use the real browser store.
- `multi-core-editor-smoke.mjs`: Hybrid 14, independent End B style, stable IDs/mappings,
  connector movement, marquee, drag cancellation, transparent image replacement,
  occupied ports, invalid mapping, project undo/redo, save/reopen, personal duplication,
  real two-tab revision conflict (also through Save Changes), reload, 8/16/32/64-channel
  editors, offline HTML, simulated Publish, production PDF and future-schema inspection.
  Passed against the isolated checkout with no page errors.
- `personal-definition-isolation-smoke.mjs`: six checks passed, including actual
  two-tab IndexedDB revision conflicts, an explicitly delayed read, scoped artwork/
  nodes, duplication and project save/reopen.
- `device-editor-integration-smoke.mjs`: 32 checkpoints and 15 native drags passed,
  including modular cards, buses, faceplate docking/detach, Escape cancellation,
  relationships, reset/duplicate, project reload and offline output parity.
  Also passed against the isolated checkout.
- Inspected dark, light and 390px screenshots of the compact confirmation. Screenshots
  and JSON acceptance results are under `chrome/` and `isolated-chrome/`.

Coverage of the requested A-V matrix:

| Cases | Evidence |
| --- | --- |
| A-C | Clean close, name edit and Keep: new Chrome smoke and lifecycle unit tests |
| D-E | Discard identity/history retention; Save via existing Device and Multi-Core operations |
| F, R, S | Actual invalid Exclusive references and Multi-Core mappings reject without trapping close |
| G | Device edit/revert; Multi-Core draft undo; existing connector metadata/placement undo tests |
| H-I | Tab/face switching, selection, pan/zoom remain preview-only; existing editor smokes |
| J-K, N | PD drag/cancel and committed drag; modular connector/card native drags; Multi-Core Escape cancellation |
| L | Device faceplate upload and Multi-Core PNG/SVG replacement |
| M, O-P | Repeated Close, dirty Escape, confirmation Escape and default Enter; keyboard focus trap |
| Q | Real two-tab personal-library revision conflicts, including confirmation Save |
| T | Injected delayed rejected storage Save; actual persistence rejection unit tests |
| U | Canonical snapshots/history before failed Save, Keep/Discard, atomic Save undo/redo |
| V | Repeated editor cycles, preview disposal, modal removal, native unload listener removal, late upload |

No Safari/Firefox/manual assistive-technology acceptance is claimed. Publish was an
offline/simulated viewer check, not deployment. No release tag or deployment was made.

## Working-tree protection and commit boundary

Before edits, 101 protected file hashes and the 49-line, three-hunk Device JSON Import
addition to `index.html` were recorded. The protected `src/personalDefinitions.js`,
untracked import code/tests/docs, artwork, `Masters/` and backups remain untouched.
The index was staged with exactly those 49 import lines excluded, without rewriting
the user's working copy. No reset, stash or clean was used.

Scoped files: the shared helper/bootstrap; Device shell lifecycle and compact CSS;
Multi-Core canvas/editor/draft; build/cache fingerprints and generated viewer metadata;
focused unit/Chrome tests; existing regression harnesses adjusted to take the explicit
Discard action; this audit. The final commit and independently verified remote hash
are reported in the task completion message.
