import { EngineOutputViewer } from "./outputViewerApp.js";
import { installOutputReport } from "./outputViewerReport.js";

const host = document.getElementById("outputViewer");
try {
  const payload = JSON.parse(document.getElementById("engineOutputPayload").textContent);
  const viewer = new EngineOutputViewer(host, payload.engineScene, { assets: payload.assets, icons: payload.icons, title: payload.title });
  window.outputViewer = viewer;
  window.engineOutputMetadata = Object.freeze(payload.metadata);
  installOutputReport(viewer, payload.reportData, payload.cableGroups);
  window.engineOutputReady = viewer.ready.then(diagnostics => {
    if (diagnostics.assetFailures) throw new Error(`${diagnostics.assetFailures} embedded viewer images could not be decoded.`);
    return { ...diagnostics, bundleHash: payload.metadata.bundleHash };
  });
  window.engineOutputReady.catch(showFailure);
} catch (error) { showFailure(error); }

function showFailure(error) {
  console.error("Engine output viewer failed", error);
  const message = document.createElement("p"); message.setAttribute("role", "alert");
  message.style.cssText = "position:fixed;inset:12px auto auto 12px;padding:12px;background:#20262d;color:#fff;z-index:100";
  message.textContent = `Engine viewer unavailable: ${error.message}. No Legacy fallback was used.`;
  document.body.append(message);
}
