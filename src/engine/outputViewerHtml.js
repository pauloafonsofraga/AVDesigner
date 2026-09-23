import { validateOutputAssets } from "./outputViewerAssets.js";
export { inlineOutputAssets } from "./outputViewerAssets.js";

export function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const escapeHtml = value => String(value || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function buildEngineViewerHtml(snapshot, { bundle, assets = {}, title, cableGroups = [] } = {}) {
  if (!bundle?.javascript || !bundle?.css || bundle.format !== "engine-output-viewer-v1") throw new Error("Engine viewer bundle is unavailable. Run npm run build:output-viewer.");
  const scene = snapshot.engineScene;
  if (scene?.version !== 1 || !scene.signature) throw new Error("Canonical Engine output scene is required.");
  validateOutputAssets(scene, assets);
  const projectName = title || snapshot.reportData?.projectName || "AV Designer";
  const payload = { engineScene: scene, assets, icons: bundle.icons, title: projectName,
    reportData: snapshot.reportData || {}, cableGroups,
    metadata: { ...snapshot.metadata, drawingDependency: "engine-webgl", sceneSignature: scene.signature,
      bundleHash: bundle.bundleHash, legacyFallback: false } };
  return `<!doctype html>
<html lang="en" data-avdesigner-output="engine-webgl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(projectName)} - AV Designer</title><link rel="icon" href="data:,">
<style>html,body,#outputViewer{margin:0;width:100%;height:100%;overflow:hidden}body{background:#181d23}${bundle.css}</style>
</head><body><main id="outputViewer"></main><noscript>JavaScript and WebGL2 are required.</noscript>
<script type="application/json" id="engineOutputPayload">${scriptJson(payload)}</script>
<script>${bundle.javascript.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
