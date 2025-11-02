/* adapters/web/weft-loader.js
   Browser wrapper for parsing an uploaded .weft File/Blob.
   Exposes BOTH a named export and a default export for compatibility.
*/
import { parseWeftText } from "../../core/weft-parser.js"; // path from adapters/web → core

export async function parseWeftBlob(blob) {
  const text = await blob.text();
  const name = blob.name || "story.weft";
  return parseWeftText(text, name);
}

console.debug?.("[weft-loader] ready");
export default { parseWeftBlob };
