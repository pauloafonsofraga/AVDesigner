import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {})
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("crash", () => errors.push("renderer crashed"));
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready);

  const result = await page.evaluate(async () => {
    const artwork = `data:image/png;base64,${"A".repeat(1024 * 1024)}`;
    state.areas = [{ id: "history-probe", name: "original", x: 0, y: 0,
      width: 100, height: 100, retainedArtwork: artwork }];
    undoStack = [];
    redoStack = [];
    for (let index = 0; index < 35; index += 1) {
      state.areas[0].name = `step-${index}`;
      pushUndo();
    }
    const classic = {
      count: undoStack.length,
      oldest: undoStack[0].areas[0].name,
      newest: undoStack.at(-1).areas[0].name
    };
    const lastSnapshot = undoStack.at(-1);
    state.areas[0].name = "changed after snapshot";
    const isolated = lastSnapshot.areas[0].name === "step-34";

    const bridge = activeEngineBridge();
    for (let index = 0; index < 35; index += 1) {
      bridge.recordCommand({ type: `history-probe-${index}`, undo: () => ({}), redo: () => ({}) });
    }
    const engine = { count: bridge.commandHistory.length, oldest: bridge.commandHistory[0].type };
    restoreSnapshot(lastSnapshot);
    const restored = state.areas[0].name === "step-34"
      && state.areas[0].retainedArtwork === artwork;
    const saved = JSON.parse(await projectJsonPayload());
    return { limit: MAX_HISTORY_ENTRIES, classic, engine, isolated, restored,
      saved: saved.areas[0].name === "step-34" && saved.areas[0].retainedArtwork === artwork };
  });

  assert.deepEqual(result, {
    limit: 30,
    classic: { count: 30, oldest: "step-5", newest: "step-34" },
    engine: { count: 30, oldest: "history-probe-5" },
    isolated: true,
    restored: true,
    saved: true
  });
  assert.deepEqual(errors, []);
  console.log("History memory smoke PASS: bounded Engine/classic undo, isolation, restore, portable save");
  await page.close();
} finally {
  await browser.close();
}
