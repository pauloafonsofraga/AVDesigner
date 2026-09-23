import { build, transform, version } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
export const bundlePath = path.join(root, "src/engine/generated/outputViewerBundle.json");
const hash = value => createHash("sha256").update(value).digest("hex");

export async function createViewerBundle() {
  const result = await build({ absWorkingDir: root, entryPoints: ["src/engine/outputViewerEntry.js"],
    bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", charset: "ascii",
    minify: true, legalComments: "none", metafile: true, outfile: "output-viewer.js" });
  const javascript = result.outputFiles[0].text;
  const includedModules = Object.entries(Object.values(result.metafile.outputs)[0].inputs)
    .filter(([, info]) => info.bytesInOutput > 0).map(([file]) => file).sort();
  for (const file of includedModules) {
    if (/(productionBridge|projectMutations|commands|history|outputSnapshot|projectAdapter|enginePreview)\.js(?:\?|$)/.test(file)) {
      throw new Error(`Editor or project-normalization code in viewer bundle: ${file}`);
    }
  }
  const css = (await transform(await readFile(path.join(root, "src/engine/outputViewer.css"), "utf8"),
    { loader: "css", minify: true, charset: "ascii" })).code;
  const icons = {};
  for (const [name, file] of [["light", "lightmode.png"], ["dark", "darkmode.png"]]) {
    icons[name] = `data:image/png;base64,${(await readFile(path.join(root, "icons", file))).toString("base64")}`;
  }
  const inputs = [...new Set([...Object.keys(result.metafile.inputs), "src/engine/outputViewer.css",
    "scripts/build-output-viewer.mjs", "package.json", "package-lock.json", "icons/lightmode.png", "icons/darkmode.png"])].sort();
  const inputHashes = [];
  for (const file of inputs) inputHashes.push([file, hash(await readFile(fileURLToPath(new URL(file, pathToFileURL(root)))))]);
  return { format: "engine-output-viewer-v1", esbuildVersion: version,
    sourceHash: hash(JSON.stringify(inputHashes)), bundleHash: hash(javascript + css + JSON.stringify(icons)),
    includedModules, javascript, css, icons };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const artifact = JSON.stringify(await createViewerBundle()) + "\n";
  if (process.argv.includes("--check")) {
    if (await readFile(bundlePath, "utf8") !== artifact) throw new Error("Stale Engine viewer bundle: run npm run build:output-viewer");
  } else { await mkdir(path.dirname(bundlePath), { recursive: true }); await writeFile(bundlePath, artifact); }
  console.log(`Engine output bundle ${process.argv.includes("--check") ? "current" : "built"}: ${Buffer.byteLength(artifact)} bytes`);
}
