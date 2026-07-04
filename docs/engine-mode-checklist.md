# AV Designer Engine Mode Checklist

Engine mode is experimental and remains behind `index.html?engine=1`.

## How To Test

1. Open normal production mode: `index.html`.
2. Open engine mode: `index.html?engine=1`.
3. Open the debug loading guard: `index.html?engine=1&debugLoad=1`.
4. Open a timed loading guard: `index.html?engine=1&loadDelay=1500`.
5. Load a real `.avd` or `.json` project.
6. Use **Validate Engine Scene** after loading and after a few edits.

## Covered

- Production mode still opens without the engine bridge.
- Engine mode is opt-in through `?engine=1`.
- Selection sync from engine mode to production state.
- Single device move.
- Multi-device move as one command.
- Route point move.
- Wire create/delete.
- Engine undo/redo.
- Production data write-through after engine commands.
- Real-project script validation.
- Loading guard for engine scene setup.
- Manual scene validation button.

## Not Covered Yet

- Making the engine renderer default.
- Export/viewer migration.
- Report migration.
- Full production renderer replacement.
- Full advanced rack/internal wiring validation beyond current scene checks.
- Full visual parity for every production detail.

## Guardrails

- Do not remove `?engine=1` isolation until production/export/viewer parity is proven.
- Do not run validation during drag.
- Do not rebuild device textures for position-only moves.
- Do not add report/export recalculation to pointermove or drag/drop paths.
- Keep custom route points, jump-node data, cable hops, and rack/internal wire data intact.
