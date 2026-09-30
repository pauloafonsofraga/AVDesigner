import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['src/accountAuthEntry.js'], bundle: true, write: false,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true, charset: 'ascii', legalComments: 'eof' });
// esbuild preserves one Supabase helper's whitespace-bearing template literal.
// Keep the exact value while avoiding repository trailing-whitespace failures.
const file = new URL('../src/generated/accountAuth.js', import.meta.url);
const text = result.outputFiles[0].text.replace('` \t\n\\r=`', '" \\t\\n\\r="');
if (process.argv.includes('--check')) {
  if (await readFile(file, 'utf8') !== text) throw new Error('Stale account Auth bundle. Run node scripts/build-account-auth.mjs');
} else { await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true }); await writeFile(file, text); }
console.log(`Account Auth bundle verified: ${text.length} bytes`);
