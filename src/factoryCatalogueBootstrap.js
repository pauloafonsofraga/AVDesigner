import { createFactoryCatalogueLoader, portableProjectData } from "./factoryCatalogue.js";
import * as imageAssets from "./imageAssets.js";
import { observeLibraryArtwork } from "./libraryArtwork.js";

const version = new URL(import.meta.url).searchParams.get("v") || "";
const load = createFactoryCatalogueLoader({ url: new URL(`../data/factory-catalogue.json?v=${encodeURIComponent(version)}`, import.meta.url) });
const shell = document.querySelector(".app");
const panel = document.getElementById("catalogueStartup");
const message = document.getElementById("catalogueStartupMessage");
const retry = document.getElementById("catalogueRetry");
let started = false;

function start() {
  retry.hidden = true;
  message.textContent = "Loading device catalogue...";
  window.wireNexusReady = load().then(async catalogue => {
    if (started) return catalogue;
    Object.defineProperty(window, "WireNexusFactoryCatalogue", { value: catalogue });
    Object.defineProperty(window, "WireNexusImageAssets", { value: Object.freeze({ ...imageAssets, portableProjectData }) });
    observeLibraryArtwork();
    // Keep the existing classic-script globals used by the shell/bridge. No app
    // initialization or persistence can run against an absent catalogue.
    const script = document.createElement("script");
    const source = document.getElementById("wireNexusAppSource");
    script.textContent = source.textContent;
    started = true;
    document.body.append(script);
    script.remove();
    source.remove();
    await window.wireNexusShellReady;
    shell.inert = false;
    panel.remove();
    return catalogue;
  });
  window.wireNexusReady.catch(error => {
    message.textContent = `${error.message}. Your saved data has not been changed. Restore the connection and retry.`;
    retry.hidden = false;
  });
}
retry.addEventListener("click", start);
start();
