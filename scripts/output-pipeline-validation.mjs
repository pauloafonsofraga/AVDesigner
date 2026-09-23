import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
export function validateOutputPipeline() {
  const index = read("index.html"), wrapper = read("viewer.html");
  const fn = name => {
    const start = index.search(new RegExp("    (?:async )?function " + name + "\\("));
    assert.ok(start >= 0, name);
    const tail = index.slice(start + 1), end = tail.search(/\n    (?:async )?function /);
    return index.slice(start, end < 0 ? undefined : start + 1 + end);
  };
  const forbidden = /legacy-svg-clone|legacyOutput|buildStandaloneHtml|wirechartSvgMarkup|wirechartSvgStyle|standaloneViewerCss|VIEWER_BEZIER_STEPS|viewerWirePolylineFromPoints|exportResolveLayout|exportInstalledCardConnector|hostedWirechartSvgCss|repairHostedViewerHtml/;
  assert.doesNotMatch(index + wrapper, forbidden, "retired output renderers must not return");
  // The supported Legacy canvas retains its application-only navigation snapshot.
  const outputs = ["buildCanonicalOutputSnapshot", "prepareEngineViewerOutput", "exportHtml",
    "publishHostedProject", "buildEnginePrintDrawing", "exportPdfReport", "buildPrintableReportHtml"].map(fn).join("\n");
  assert.doesNotMatch(outputs, /cloneNode|refreshNavigationSnapshot|objectBoundsForSelection/);
  assert.equal((index.replace(fn("refreshNavigationSnapshot"), "").match(/canvas\.cloneNode\s*\(\s*true\s*\)/g) || []).length, 0);
  for (const name of ["exportHtml", "publishHostedProject"]) assert.match(fn(name), /prepareEngineViewerOutput\(/);
  assert.match(fn("prepareEngineViewerOutput"), /buildCanonicalOutputSnapshot\(/);
  assert.match(fn("prepareEngineViewerOutput"), /viewerModule\.buildEngineViewerHtml\(snapshot/);
  assert.match(fn("engineViewerResources"), /generated\/outputViewerBundle\.json/);
  assert.match(fn("exportPdfReport"), /buildEnginePrintDrawing\(snapshot\)/);
  assert.match(fn("buildEnginePrintDrawing"), /outputSvgRenderer\.js/);
  assert.match(fn("buildEnginePrintDrawing"), /renderEngineOutputSvg\(snapshot/);
  assert.match(wrapper, /frame\.srcdoc = result\.html/);
  assert.match(wrapper, /fetch\("\/api\/project"/);
  const modules = readdirSync(new URL("../src/engine/", import.meta.url)).filter(f => /^output.*\.js$/.test(f));
  for (const file of modules) {
    const source = read("src/engine/" + file);
    assert.doesNotMatch(source, forbidden);
    assert.doesNotMatch(source, /cloneNode|function\s+(?:generatedCardConnectors|cardBandGeometry|wirePolylineFromPoints|calculateCableHops)\s*\(/,
      file + " must reuse Engine geometry");
  }
  for (const file of ["outputViewerModel.js", "outputViewerHtml.js"]) assert.match(read("src/engine/" + file), /assertOutputSceneContract/);
  assert.match(read("src/engine/outputSvgRenderer.js"), /createOutputViewerModel/);
  assert.doesNotMatch(read("src/engine/outputSvgRenderer.js"), /meshes\(primitives\.jumpLinks/,
    "PDF must never print virtual portal meshes");
  const bundle = JSON.parse(read("src/engine/generated/outputViewerBundle.json"));
  assert.ok(bundle.includedModules.includes("src/engine/outputSceneContract.js"));
  assert.ok(bundle.includedModules.includes("src/engine/renderer.js"));
  assert.ok(!bundle.includedModules.some(f => /productionBridge|projectMutations|projectAdapter/.test(f)));
  assert.doesNotMatch(bundle.javascript, forbidden);
  for (const file of ["index.html", "viewer.html"]) {
    let count = 0;
    for (const [, attrs, source] of read(file).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/\bsrc=|type=["'](?:module|application\/json)/.test(attrs)) continue;
      new vm.Script(source, { filename: file }); count++;
    }
    assert.ok(count > 0, file + " inline scripts parsed");
  }
  return { outputs: 3, modules: modules.length, bundleHash: bundle.bundleHash, legacyCanvasPreserved: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log("Unified output ownership, bundle boundaries and inline syntax PASS", validateOutputPipeline());
}
