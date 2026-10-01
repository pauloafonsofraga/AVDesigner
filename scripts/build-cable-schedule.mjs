import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "src/engine/generated/cableScheduleBundle.js");
const result = await build({
  entryPoints: [resolve(root, "src/engine/cableScheduleXlsx.js")],
  bundle: true, platform: "browser", format: "iife", target: "es2020", minify: true,
  write: false, globalName: "WireNexusCableScheduleXlsx"
});
const code = result.outputFiles[0].text;
if (process.argv.includes("--check")) {
  if (await readFile(output, "utf8") !== code) throw new Error("Cable Schedule XLSX bundle is stale. Run npm run build:cable-schedule.");
  console.log("Cable Schedule XLSX bundle is current.");
} else {
  await writeFile(output, code);
  console.log(`Built Cable Schedule XLSX bundle (${code.length} bytes).`);
}
