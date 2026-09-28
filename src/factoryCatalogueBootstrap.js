import { createFactoryCatalogueLoader, portableProjectData } from "./factoryCatalogue.js";
import * as imageAssets from "./imageAssets.js";
import { observeLibraryArtwork } from "./libraryArtwork.js";

const version = new URL(import.meta.url).searchParams.get("v") || "";
const load = createFactoryCatalogueLoader({ url: new URL(`../data/factory-catalogue.json?v=${encodeURIComponent(version)}`, import.meta.url) });
const shell = document.querySelector(".app");
const panel = document.getElementById("catalogueStartup");
const message = document.getElementById("catalogueStartupMessage");
const retry = document.getElementById("catalogueRetry");
let phase = "idle";

function setPhase(value) {
  phase = value;
  panel.dataset.phase = value;
}

function start() {
  if (phase === "shell-failed") {
    // A classic script may already have installed listeners and changed globals.
    // Only a fresh document can safely initialize it again.
    window.location.reload();
    return;
  }
  if (phase !== "idle" && phase !== "catalogue-failed") return window.wireNexusReady;
  setPhase("loading-catalogue");
  retry.hidden = true;
  message.textContent = "Loading device catalogue...";
  window.wireNexusReady = load().then(async catalogue => {
    setPhase("initializing-shell");
    message.textContent = "Starting WireNexus...";
    Object.defineProperty(window, "WireNexusFactoryCatalogue", { value: catalogue });
    Object.defineProperty(window, "WireNexusImageAssets", { value: Object.freeze({ ...imageAssets, portableProjectData }) });
    observeLibraryArtwork();
    // Keep the existing classic-script globals used by the shell/bridge. No app
    // initialization or persistence can run against an absent catalogue.
    const script = document.createElement("script");
    const source = document.getElementById("wireNexusAppSource");
    script.textContent = source.textContent;
    try {
      document.body.append(script);
    } finally {
      script.remove();
      source.remove();
    }
    if (!window.wireNexusShellReady || typeof window.wireNexusShellReady.then !== "function") {
      throw new Error("Application initialization did not complete");
    }
    await window.wireNexusShellReady;
    setPhase("ready");
    shell.inert = false;
    panel.remove();
    return catalogue;
  });
  window.wireNexusReady.catch(error => {
    const detail = error instanceof Error ? error.message : String(error);
    const catalogueFailed = phase === "loading-catalogue";
    setPhase(catalogueFailed ? "catalogue-failed" : "shell-failed");
    message.textContent = catalogueFailed
      ? `${detail}. Your saved data has not been changed. Restore the connection and retry.`
      : `${detail}. WireNexus could not finish starting. Reload the page to try again. Reloading does not clear saved settings or project files.`;
    retry.textContent = catalogueFailed ? "Retry" : "Reload Page";
    retry.hidden = false;
  });
  return window.wireNexusReady;
}
retry.addEventListener("click", start);
start();
