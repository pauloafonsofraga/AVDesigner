import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createFactoryCatalogueLoader } from "../src/factoryCatalogue.js";
import { FACTORY_AUTHORING } from "../src/buildCapabilities.js";

// Execute the actual bootstrap entry point with its DOM boundary substituted.
// The production loader and the entire start/error/button sequence still run.
const source = readFileSync(new URL("../src/factoryCatalogueBootstrap.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replaceAll("import.meta.url", '"https://example.test/src/factoryCatalogueBootstrap.js?v=test"');
const catalogue = { version: 1, devices: [{ id: "device" }], nodes: [{ id: "node" }],
  nodeTypes: {}, assets: {}, nodeThumbnails: {}, nodeTags: {}, libraryThumbnails: {} };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness({ fetchCatalogue = async () => Response.json(catalogue), initialize } = {}) {
  const calls = { fetch: 0, scripts: 0, observers: 0, reloads: 0, listeners: 0 };
  const panel = { dataset: {}, remove() { this.removed = true; } }, message = {};
  const retry = { hidden: true, textContent: "Retry", addEventListener(type, listener) { calls.listeners++; this.click = listener; } };
  const shell = { inert: true }, app = { textContent: "classic app", remove() { this.removed = true; } };
  const window = { location: { reload() { calls.reloads++; } } };
  const document = {
    querySelector: () => shell,
    getElementById: id => ({ catalogueStartup: panel, catalogueStartupMessage: message, catalogueRetry: retry, wireNexusAppSource: app })[id],
    createElement: () => ({ remove() {} }),
    body: { append() { calls.scripts++; window.wireNexusShellReady = initialize ? initialize() : Promise.resolve(); } }
  };
  const context = { window, document, URL, Error, FACTORY_AUTHORING,
    createFactoryCatalogueLoader: options => createFactoryCatalogueLoader({ ...options, fetchCatalogue: (...args) => { calls.fetch++; return fetchCatalogue(...args); } }),
    imageAssets: {}, portableProjectData() {}, observeLibraryArtwork() { calls.observers++; },
    localStorage: { setItem() { assert.fail("bootstrap must not write storage"); }, clear() { assert.fail("bootstrap must not clear storage"); } }
  };
  vm.runInNewContext(source, context);
  return { window, shell, panel, message, retry, app, calls };
}

test("catalogue rejection, Retry and shell readiness run through the actual bootstrap without duplicate initialization", async () => {
  let offline = true;
  const shellReady = deferred();
  const h = harness({ fetchCatalogue: async () => offline ? new Response("offline", { status: 503 }) : Response.json(catalogue), initialize: () => shellReady.promise });
  await assert.rejects(h.window.wireNexusReady, /503/);
  assert.equal(h.panel.dataset.phase, "catalogue-failed");
  assert.equal(h.retry.textContent, "Retry"); assert.equal(h.retry.hidden, false);
  assert.equal(h.calls.scripts, 0); assert.equal(h.shell.inert, true);
  offline = false;
  const ready = h.retry.click();
  assert.equal(h.retry.click(), ready);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.panel.dataset.phase, "initializing-shell");
  assert.equal(h.shell.inert, true); assert.equal(h.panel.removed, undefined);
  assert.equal(h.retry.click(), ready);
  shellReady.resolve(); await ready;
  assert.equal(h.panel.dataset.phase, "ready");
  assert.equal(h.shell.inert, false); assert.equal(h.panel.removed, true);
  assert.equal(h.retry.click(), ready);
  assert.deepEqual(h.calls, { fetch: 2, scripts: 1, observers: 1, reloads: 0, listeners: 1 });
});

test("shell rejection after catalogue success offers explicit reload, never retries the partial classic script", async () => {
  const h = harness({ initialize: () => Promise.reject(new Error("Forced shell readiness failure")) });
  const ready = h.window.wireNexusReady;
  await assert.rejects(ready, /Forced shell readiness failure/);
  assert.equal(h.panel.dataset.phase, "shell-failed");
  assert.equal(h.retry.textContent, "Reload Page"); assert.equal(h.retry.hidden, false);
  assert.match(h.message.textContent, /Reloading does not clear saved settings or project files/);
  assert.equal(h.shell.inert, true); assert.equal(h.panel.removed, undefined);
  assert.ok(Object.isFrozen(h.window.WireNexusFactoryCatalogue));
  h.retry.click();
  assert.equal(h.window.wireNexusReady, ready, "a rejected ready promise must not become false success");
  assert.equal(h.panel.dataset.phase, "shell-failed");
  assert.doesNotMatch(h.message.textContent, /Loading device catalogue/);
  assert.deepEqual(h.calls, { fetch: 1, scripts: 1, observers: 1, reloads: 1, listeners: 1 });
});

test("missing shell readiness is a recoverable initialization error, not a ready application", async () => {
  const h = harness({ initialize: () => undefined });
  await assert.rejects(h.window.wireNexusReady, /initialization did not complete/);
  assert.equal(h.panel.dataset.phase, "shell-failed");
  assert.equal(h.shell.inert, true); assert.equal(h.retry.textContent, "Reload Page");
  h.retry.click(); assert.equal(h.calls.scripts, 1); assert.equal(h.calls.reloads, 1);
});
