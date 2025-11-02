/* adapters/node/weft-loader.js
   Node wrapper to read a .weft file from disk and parse it.
*/
import fs from "node:fs";
import path from "node:path";
import { parseWeftText } from "../../core/weft-parser.js"; // <- FIXED PATH

export function loadWeftFile(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  const txt = fs.readFileSync(abs, "utf8");
  const { meta, passages, tagsMap, diagnostics } = parseWeftText(txt, abs);
  return { meta, passages, tagsMap, diagnostics };
}
