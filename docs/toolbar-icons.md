# Toolbar Icon System

Build 54.38.149 replaces main-toolbar PNGs and long text actions with 27px inline
SVGs inside 34x32px buttons. Button IDs, order, native disabled states, existing
tooltips, click handlers and keyboard handling remain unchanged. Missing tooltip
and accessible names on former text actions are derived from their existing labels.

`src/toolbarIcons.js` contains a locally vendored subset of Lucide 1.17.0 (license
in `icons/toolbar/LUCIDE-LICENSE`), plus WireNexus-specific chassis/ports, Loom,
Multi-Core, paired Jump, crossing-hop, title-block and Save As compositions.
No network icon runtime or package dependency is introduced. Icons share a 24-unit
coordinate grid, two-unit strokes, rounded joins/caps and inherited button color.

Theme/grid/snap/hop/routing states reuse the current state setters. The explicit
110V/220V value and Auto/Manual dropdown remain visible. Original artwork files
are retained. The toolbar stays single-row, with fixed-size glyphs and horizontal
scrolling when its contents exceed available width. Inter-button gaps are 4px;
each icon has 3.5px horizontal and 2.5px vertical padding within its button.

Coverage: `test/toolbarIcons.test.mjs` checks action inventory, SVG consistency,
state swaps and the unchanged control order. `scripts/toolbar-icons-smoke.mjs`
checks four desktop widths (1366, 1440, 1920, 2560), padding, scrolling and all main
toolbar controls, including keyboard Undo, dialogs, file choosers, project
save/load and HTML/PDF downloads. Publishing is tested only by opening/canceling
its dialog; no publish, deployment or release is performed.
