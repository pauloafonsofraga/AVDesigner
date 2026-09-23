import { EngineOutputViewer } from "./outputViewerApp.js";
import { buildEngineOutputScene } from "./outputSceneSnapshot.js";
import { outputViewerParityFixture, outputViewerScaleFixture } from "../../fixtures/output-viewer.mjs";

// Development-only fixture generation. The viewer itself accepts scene JSON only.
window.mountOutputViewer = async snapshot => {
  window.outputViewer?.dispose();
  window.outputViewer = new EngineOutputViewer(document.getElementById("viewer"), snapshot);
  await window.outputViewer.ready;
  return window.outputViewer.diagnostics();
};
async function loadFixture() {
  const project = document.getElementById("fixture").value === "scale" ? outputViewerScaleFixture() : outputViewerParityFixture();
  return window.mountOutputViewer(JSON.parse(JSON.stringify(buildEngineOutputScene(project))));
}
function showError(error) { document.getElementById("error").textContent = error.message; }
document.getElementById("fixture").addEventListener("change", () => loadFixture().catch(showError));
document.getElementById("snapshot").addEventListener("change", async event => {
  const file = event.target.files[0]; if (!file) return;
  try { await window.mountOutputViewer(JSON.parse(await file.text())); } catch (error) { showError(error); }
});
if (!new URLSearchParams(location.search).has("empty")) loadFixture().catch(showError);
