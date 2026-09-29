import { execFileSync } from "node:child_process";
import { cp, mkdir, writeFile, readFile, lstat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination || !process.argv.includes("--enable-factory-authoring") || destination === resolve(root)) {
  throw new Error("Usage: node scripts/build-factory-authoring.mjs NEW_OUTPUT_DIRECTORY --enable-factory-authoring. Serve this separate build on your stable authoring origin.");
}
try { await lstat(destination); throw new Error("Output directory must not exist. This command never overwrites a build or project."); }
catch (error) { if (error.code !== "ENOENT") throw error; }
// Tracked static application files only: no private/untracked files, tokens,
// server endpoints, Git state, node_modules or browser data enter this build.
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString().split("\0").filter(Boolean);
for (const file of tracked.filter(file => ["index.html", "VideoCoreLogo.png"].includes(file) || /^(src|data|assets|Devices|Nodes|icons|Images|Logos|fonts)\//.test(file))) {
  await mkdir(dirname(resolve(destination, file)), { recursive: true });
  await cp(resolve(root, file), resolve(destination, file));
}
await writeFile(resolve(destination, "src/buildCapabilities.js"), "export const FACTORY_AUTHORING = true;\n");
const build = (await readFile(resolve(destination, "index.html"), "utf8")).match(/const APP_ITERATION = "([^"]+)"/)[1];
console.log(`Factory authoring build ${build}: ${destination}\nServe only on a trusted/stable editing origin. Repository access remains the publishing authority. Do not deploy this build as the public application.`);
