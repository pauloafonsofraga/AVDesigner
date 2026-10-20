import test from "node:test";
import assert from "node:assert/strict";
import { createEditorGuard, editorDataContent, replaceEditor } from "../src/editorLifecycle.js";
import { MultiCoreEditorDraft } from "../src/engine/multiCoreEditorDraft.js";
import { connectedMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(t, options = {}) {
  const state = { draft: { name: "Original" }, canonical: { name: "Original" }, prompts: 0, saves: 0, history: 0, disposals: 0, errors: [] };
  const guard = createEditorGuard({ dirty: () => editorDataContent(state.draft) !== editorDataContent(state.canonical),
    confirm: async () => { state.prompts++; return state.choice || "keep"; },
    save: async () => { state.saves++; if (state.failure) throw new Error(state.failure); state.canonical = structuredClone(state.draft); state.history++; return true; },
    dispose: () => state.disposals++, error: e => state.errors.push(e.message), ...options });
  t.after(() => guard.dispose()); return { state, guard };
}

test("semantic JSON comparison ignores object order, not connector/array order", () => {
  assert.equal(editorDataContent({ b: 2, a: { z: 3, x: 1 } }), editorDataContent({ a: { x: 1, z: 3 }, b: 2 }));
  assert.notEqual(editorDataContent(["a", "b"]), editorDataContent(["b", "a"]));
});
test("clean close and edit then undo close without confirmation or history", async t => {
  const { state, guard } = fixture(t); state.draft.name = "Changed"; state.draft.name = "Original";
  assert.equal(await guard.requestClose(), true); assert.equal(state.prompts, 0); assert.equal(state.history, 0);
});
test("Keep and Discard leave canonical data and history untouched", async t => {
  const { state, guard } = fixture(t); state.draft.name = "Changed";
  assert.equal(await guard.requestClose(), false); assert.equal(state.draft.name, "Changed"); assert.equal(state.disposals, 0);
  state.choice = "discard"; assert.equal(await guard.requestClose(), true);
  assert.equal(state.canonical.name, "Original"); assert.equal(state.history, 0); assert.equal(state.saves, 0);
});
test("Save confirmation calls existing persistence once and closes only on success", async t => {
  const { state, guard } = fixture(t); state.draft.name = "Changed"; state.choice = "save";
  const a = guard.requestClose(), b = guard.requestClose(); assert.equal(a, b);
  assert.equal(await a, true); assert.equal(state.saves, 1); assert.equal(state.history, 1); assert.equal(state.disposals, 1);
});
for (const failure of ["missing connector in exclusive relationship", "missing artwork", "stale personal revision", "occupied channel", "asynchronous storage failure"]) {
  test(`${failure}: failed Save retains draft, allows retry or discard, no partial history`, async t => {
    const { state, guard } = fixture(t); state.draft.name = "Changed"; state.failure = failure; state.choice = "save";
    assert.equal(await guard.requestClose(), false); assert.equal(guard.closed, false); assert.equal(state.draft.name, "Changed");
    assert.equal(state.canonical.name, "Original"); assert.equal(state.history, 0); assert.deepEqual(state.errors, [failure]);
    state.choice = "keep"; assert.equal(await guard.requestClose(), false);
    state.choice = "discard"; assert.equal(await guard.requestClose(), true);
  });
}
test("async Save blocks replacement, repeated saves and close without duplicate persistence", async t => {
  const pending = deferred(); let saves = 0;
  const { guard } = fixture(t, { save: async () => { saves++; return pending.promise; } });
  const a = guard.save(), b = guard.save(); assert.equal(a, b);
  assert.equal(await guard.requestClose(), false);
  assert.equal(await replaceEditor(() => { throw new Error("Must not replace"); }), false);
  pending.resolve(true); assert.equal(await a, true); assert.equal(saves, 1);
});
test("late result from a disposed session cannot close a newer editor", async t => {
  const pending = deferred(); const { guard } = fixture(t, { save: () => pending.promise });
  const saving = guard.save(); await Promise.resolve(); guard.dispose();
  const next = fixture(t); pending.resolve(true); assert.equal(await saving, false); assert.equal(next.guard.closed, false);
});
test("late Save cleanup cannot unlock a replacement using the same modal root", async t => {
  const root = { inert: false, busy: false, setAttribute() { this.busy = true; }, removeAttribute() { this.busy = false; } };
  const old = deferred(), next = deferred();
  const first = fixture(t, { root, save: () => old.promise });
  const saving = first.guard.save(); await Promise.resolve(); first.guard.dispose();
  assert.equal(root.inert, false); assert.equal(root.busy, false);
  const replacement = fixture(t, { root, save: () => next.promise }); const second = replacement.guard.save();
  old.resolve(true); await saving;
  assert.equal(root.inert, true); assert.equal(root.busy, true); assert.equal(replacement.guard.closed, false);
  next.resolve(true); await second; assert.equal(root.inert, false); assert.equal(root.busy, false);
});
test("pending artwork prompts; Save waits, Discard disposes without waiting", async t => {
  const { state, guard } = fixture(t); const upload = deferred(); guard.trackUpload(upload.promise);
  state.choice = "keep"; assert.equal(await guard.requestClose(), false); assert.equal(state.prompts, 1);
  state.choice = "save"; const closing = guard.requestClose(); await Promise.resolve(); assert.equal(state.saves, 0);
  state.draft.name = "Artwork loaded"; upload.resolve(); assert.equal(await closing, true); assert.equal(state.canonical.name, "Artwork loaded");
});
test("Discard during upload releases the session immediately; rejected upload cannot affect a replacement", async t => {
  const upload = deferred(), first = fixture(t); first.guard.trackUpload(upload.promise); first.state.choice = "discard";
  assert.equal(await first.guard.requestClose(), true); assert.equal(first.state.history, 0);
  const next = fixture(t); upload.reject(new Error("Old upload failed")); await Promise.resolve();
  assert.equal(next.guard.closed, false); assert.equal(next.state.prompts, 0); assert.equal(next.state.history, 0);
});
test("rapid replacement is serialized and Keep preserves the current session", async t => {
  const choice = deferred(); let opens = 0;
  const { state } = fixture(t, { confirm: () => choice.promise }); state.draft.name = "Changed";
  const one = replaceEditor(() => opens++); assert.equal(await replaceEditor(() => opens++), false);
  choice.resolve("keep"); assert.equal(await one, false); assert.equal(opens, 0);
});
test("Multi-Core semantic dirty state covers styles/mappings/artwork and exact undo", () => {
  const project = connectedMultiCoreProject(), before = structuredClone(project), draft = new MultiCoreEditorDraft(project.multiCores[0], { project });
  assert.equal(draft.isDirty(), false);
  draft.value = Object.fromEntries(Object.entries(draft.value).reverse()); assert.equal(draft.isDirty(), false);
  for (const edit of [d => d.ends.B.style = "fanout", d => d.trunk.length = 73, d => d.circuits[1].endBPortId = "missing",
    d => d.ends.A.faces[0].image = "data:image/png;base64,changed"]) {
    draft.edit(edit); assert.equal(draft.isDirty(), true); draft.undoEdit(); assert.equal(draft.isDirty(), false);
  }
  assert.deepEqual(project, before);
});
