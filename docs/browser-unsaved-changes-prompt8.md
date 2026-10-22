# Prompt 8: Browser Unsaved Project Protection

Baseline: `b134962de7d9413128643541a4cb299417c48842`, `engine-prototype`.
Build: 54.38.136. No deployment or release tag.

## Existing State Audit

`productionDirty`, mutation dirty flags and undo-stack size are diagnostics, not saved-file checkpoints: scene rebuilds reset some flags, successful saves do not reset all of them, previews can affect render diagnostics, and history can contain pre-mutation snapshots. Using those flags alone would either miss unsaved changes or warn after a successful save.

The implementation instead reuses the existing project snapshot/save paths and memory-safe `cloneHistoryValue` for one saved-content checkpoint. There are no new command hooks, history revisions, autosave, persisted flags, custom exit dialogs or per-frame polling.

## Behavior

- `src/projectUnsavedChanges.js` installs one native `beforeunload` listener after Engine startup finishes. It cancels the event only when current authored project content differs from the saved checkpoint. Browser-native Stay/Leave confirmation supplies its own text.
- `projectSnapshotData({readOnly:true})` uses the existing persisted field list without normalizing/mutating instances or nodes, or consulting rendered LED port positions. It includes device definitions, card operations, connections, looms, model-only Multi-Core fields, title blocks and other saved scene/settings data. Selection, cameras, history and detached editor drafts are not project fields.
- Favorites are library preferences, not authored scene changes, so the comparison omits their top-level template flag. An absent/null connection `routePoints` field compares as `[]`: a native move/undo reproduced this existing default materialization and otherwise caused a false warning. This normalization exists only in the comparison; no source data or save schema is changed.
- Comparison recursively visits structural data and compares immutable artwork strings directly. It does not serialize or duplicate full base64 PNG strings on every check. The checkpoint is cloned once at initialization/load/new/save boundaries using the existing memory-safe structural clone.
- A successful Load or confirmed New creates a clean checkpoint. Undo/redo does not reset it. Canceled/rejected operations and scene-only previews do not become project changes.
- Save captures the checkpoint beside the exact project snapshot, after existing numbering/normalization and before asynchronous asset embedding. Native writes accept that checkpoint only after `writable.close()` succeeds. Changes made during the write remain unsaved. Failed writes, asset failures and canceled pickers never mark the project saved. New/load invalidates older in-flight save tokens.
- The download fallback accepts the checkpoint only after initiating the existing download successfully. Browsers provide no reliable completion/cancellation acknowledgement for the download shelf; disk completion cannot be guaranteed through this fallback. Native file-write failures/cancellation are observable and covered.

The Device Editor's existing independent guard remains unchanged, including its own native unload protection and Keep/Discard/Save confirmation. Two handlers still yield one native browser prompt. Project saves do not save detached editor drafts. Legacy does not install the new project guard; its default save/snapshot behavior is preserved.

## Verification

15 new focused Node tests cover native-event cancellation, nested/project-family mutations, unchanged/reverted data, saved checkpoint timing, edits during writes, generation isolation, large PNG strings, key ordering, read failure, listener disposal, real shell Save/Save As success/failure/cancellation/download paths, payload capture before asset awaits, and the nonmutating read projection.

`scripts/project-unsaved-changes-smoke.mjs` uses installed Google Chrome with an explicit browser context (so Playwright does not force-close the context instead of exercising tab close):

- Fresh/loaded/saved projects are clean; clean reload has no native warning.
- Committed canvas movement is dirty; move/undo returns clean and redo becomes dirty.
- Device drag and wire-label previews, Escape cancellation, and a rejected wire edit remain clean.
- Native reload, navigation and tab close can be canceled, keeping the live project intact without a custom exit dialog.
- Canceled Save As and a failed native close/write retain the warning.
- Download save and the actual native-file save path with a controlled writable handle clear the correct checkpoint.
- Opening the downloaded project is clean. Detached card edits trigger the editor guard, not project dirty state; Keep and Discard preserve that separation. Applying the card edit makes the project dirty and saving clears it.
- Confirmed New is clean. Native Leave successfully refreshes/closes. Five actual native `beforeunload` dialogs are asserted; there are no page errors.

`scripts/editor-unsaved-changes-smoke.mjs` passes its existing Device/Faceplate/Multi-Core workflows, validation and storage failures, upload cancellation, focus/Escape isolation, and confirmation layouts. Its editor-only unload assertion now establishes a project checkpoint so earlier committed fixture edits do not mask editor-disposal behavior. All original editor assertions remain.

The existing factory-artwork save and branding tests retain their assertions; their harnesses accept the optional snapshot callback/new shell guard variable. Full isolated Node tests, all 16 static validators and all generated-bundle checks run before commit. Final counts are in the completion report. Evidence is under `/tmp/wirenexus-prompt8*`.

## Browser Limits and Protections

Native dialogs require prior user interaction and are subject to browser policy. The browser controls wording and buttons. Mobile process termination, browser crashes, OS force-quit and download-shelf cancellation cannot be reliably intercepted. This is an exit warning, not autosave or crash recovery. Safari/Firefox and OS-native file-picker UI were not separately acceptance-tested; installed Chrome and controlled file-handle success/failure paths were.

No project schema, artwork, connector/card geometry, electrical behavior, Legacy rendering or Device Editor lifecycle implementation changed. All protected artwork, faceplates, Masters, backups and unfinished Device JSON Import work remain excluded; all 101 protected paths and the original unstaged import patch are hash/diff verified before commit.
