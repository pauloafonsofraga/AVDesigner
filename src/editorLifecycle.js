// JSON authored data: object key order is incidental; array order is meaningful.
export function editorDataContent(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

let active = null, opening = false, confirmation = null;

// Change-only controls must also commit their field into the detached draft on
// Escape (which does not blur them). Selection and viewport inputs are harmless.
export function pendingEditorFields(root) {
  const pending = new Set();
  const input = event => pending.add(event.target);
  const change = event => pending.delete(event.target);
  root.addEventListener("input", input);
  root.addEventListener("change", change);
  return {
    flush() {
      for (const field of [...pending]) {
        pending.delete(field);
        if (root.contains(field)) field.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    get pending() { return [...pending].some(field => root.contains(field)); },
    dispose() { pending.clear(); root.removeEventListener("input", input); root.removeEventListener("change", change); }
  };
}

export async function replaceEditor(open) {
  if (opening) return false;
  opening = true;
  try {
    if (active && !await active.requestClose()) return false;
    return await open();
  } finally { opening = false; }
}

function freeze(element) {
  const wasInert = element.inert;
  element.inert = true;
  return () => { element.inert = wasInert; };
}

export function confirmUnsavedChanges(label, root) {
  if (confirmation) return confirmation.promise;
  const focus = document.activeElement;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop editor-unsaved-backdrop";
  backdrop.innerHTML = `<section class="modal editor-unsaved-modal" role="dialog" aria-modal="true" aria-labelledby="editorUnsavedTitle" aria-describedby="editorUnsavedMessage">
    <header class="modal-header"><strong id="editorUnsavedTitle">Unsaved Changes</strong></header>
    <p id="editorUnsavedMessage"></p>
    <footer class="modal-footer"><button type="button" class="tool-button" data-choice="keep">Keep Editing</button><button type="button" class="tool-button danger-button" data-choice="discard">Discard Changes</button><button type="button" class="tool-button primary-button" data-choice="save">Save Changes</button></footer>
  </section>`;
  backdrop.querySelector("p").textContent = `You have unsaved changes to this ${label}. What would you like to do?`;
  const thaw = [...document.body.children].filter(el => el instanceof HTMLElement).map(freeze);
  document.body.append(backdrop);
  const buttons = [...backdrop.querySelectorAll("button")];
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  const finish = choice => {
    if (confirmation?.promise !== promise) return;
    confirmation = null;
    backdrop.remove(); thaw.forEach(restore => restore());
    if (focus?.isConnected && !focus.inert) focus.focus();
    else root?.querySelector("button,input,select,textarea")?.focus();
    resolve(choice);
  };
  const keydown = event => {
    // Own the event before editor/canvas handlers, including their capture phase.
    event.stopImmediatePropagation();
    if (event.key === "Escape") { event.preventDefault(); finish("keep"); }
    if (event.key === "Tab") {
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement);
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      finish(buttons.includes(document.activeElement) ? document.activeElement.dataset.choice : "keep");
    }
  };
  backdrop.addEventListener("click", event => {
    const choice = event.target.closest("[data-choice]")?.dataset.choice;
    if (choice) finish(choice);
  });
  confirmation = { promise, finish, keydown };
  buttons[0].focus();
  return promise;
}

// Installed before the classic shell/Engine capture handlers. Inactive editors
// incur no keyboard work and the confirmation cannot leak Escape to the canvas.
if (typeof window !== "undefined") window.addEventListener("keydown", event => {
  if (confirmation) confirmation.keydown(event);
  else if (active && event.key === "Escape" && document.querySelector("dialog[open]")) event.stopImmediatePropagation();
  else if (active?.saving) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);

export function createEditorGuard({ root, label = "device", dirty, prepare = () => {}, save, dispose, error = () => {}, busy = () => false, confirm = confirmUnsavedChanges }) {
  if (active && !active.closed) throw new Error("Close the current editor before replacing its draft.");
  let closePromise = null, savePromise = null, restoreSavingUi = null;
  const uploads = new Set();
  const beforeunload = event => {
    if (!guard.closed && !guard.saving) prepare();
    if (!guard.closed && (guard.saving || uploads.size || dirty())) { event.preventDefault(); event.returnValue = ""; }
  };
  const guard = {
    closed: false,
    get saving() { return !!savePromise || busy(); },
    trackUpload(promise) {
      uploads.add(promise);
      promise.then(() => uploads.delete(promise), () => uploads.delete(promise));
      return promise;
    },
    requestClose() {
      if (guard.closed) return Promise.resolve(true);
      if (guard.saving) return Promise.resolve(false);
      // A native top-layer dialog must finish before its underlying editor can
      // present a confirmation. Escape still performs the native cancellation.
      if (typeof document !== "undefined" && document.querySelector("dialog[open]")) return Promise.resolve(false);
      if (closePromise) return closePromise;
      const run = async () => {
        prepare();
        if (!dirty() && !uploads.size) { guard.dispose(); return true; }
        const choice = await confirm(label, root);
        if (guard.closed || choice === "keep") return false;
        if (choice === "discard") { guard.dispose(); return true; }
        return guard.save();
      };
      closePromise = run().catch(reason => { error(reason); return false; }).finally(() => { closePromise = null; });
      return closePromise;
    },
    save(operation = save, closeOnSuccess = true) {
      if (guard.closed) return Promise.resolve(false);
      if (savePromise) return savePromise;
      if (busy()) return Promise.resolve(false);
      try { prepare(); } catch (reason) { error(reason); return Promise.resolve(false); }
      const focus = typeof document === "undefined" ? null : document.activeElement;
      const thaw = root ? freeze(root) : () => {};
      root?.setAttribute("aria-busy", "true");
      restoreSavingUi = () => { thaw(); root?.removeAttribute("aria-busy"); restoreSavingUi = null; };
      // Defer invocation until savePromise owns the session, even for sync saves.
      savePromise = Promise.resolve().then(async () => {
        await Promise.all([...uploads]);
        if (guard.closed) return false;
        const saved = await operation();
        if (saved !== true || guard.closed) return false;
        if (closeOnSuccess) guard.dispose();
        return true;
      }).catch(reason => { if (!guard.closed) error(reason); return false; }).finally(() => {
        savePromise = null; restoreSavingUi?.();
        if (!guard.closed && focus?.isConnected) focus.focus();
      });
      return savePromise;
    },
    dispose() {
      if (guard.closed) return;
      guard.closed = true;
      restoreSavingUi?.();
      if (active === guard) { confirmation?.finish("keep"); active = null; }
      if (typeof window !== "undefined") window.removeEventListener("beforeunload", beforeunload);
      dispose();
    }
  };
  active = guard;
  if (typeof window !== "undefined") window.addEventListener("beforeunload", beforeunload);
  return guard;
}
