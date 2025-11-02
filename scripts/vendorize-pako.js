// scripts/vendorize-pako.js
// Copies Pako ESM build from node_modules into ./vendor/pako.min.js
// Run: npm run vendor:pako
// Note: Requires 'pako' to be installed as a dependency or devDependency.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function tryCopy(srcRel, destRel) {
  const src = path.resolve(root, srcRel);
  const dest = path.resolve(root, destRel);
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    return true;
  } catch (e) {
    return false;
  }
}

const candidates = [
  'node_modules/pako/dist/pako.esm.mjs',
  'node_modules/pako/dist/pako.min.js',
  'node_modules/pako/dist/pako.js'
];

const dest = 'vendor/pako.min.js';

let ok = false;
for (const c of candidates) {
  ok = await tryCopy(c, dest);
  if (ok) {
    console.log(`[vendorize-pako] Copied ${c} -> ${dest}`);
    break;
  }
}

if (!ok) {
  console.error('[vendorize-pako] Could not locate Pako build in node_modules. Did you install it?');
  console.error('  Try: npm i -D pako');
  process.exit(1);
} else {
  // Wrap as ESM with a named 'default' export if needed
  const destPath = path.resolve(root, dest);
  let content = await fs.readFile(destPath, 'utf8');
  if (!/export\s+/.test(content)) {
    content = [
      '// Auto-wrapped Pako for ESM import',
      'const g = (typeof globalThis !== "undefined") ? globalThis : window;',
      'const pako = g.pako || (function(){',
      content,
      '; return g.pako; })();',
      'export default pako;',
      'export const inflate = pako.inflate;',
      'export const deflate = pako.deflate;'
    ].join('\n');
    await fs.writeFile(destPath, content, 'utf8');
    console.log('[vendorize-pako] Wrapped non-ESM build for ESM import.');
  }
}
