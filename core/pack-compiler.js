// core/pack-compiler.js
// Pure compiler: passages -> v2c. No DOM, no fs, no localStorage.

import { normalizeV2c, validateV2c } from "./schema.js";

/** Conservative HTML minifier (keeps author formatting mostly intact) */
function minifyHtml(html) {
  let s = html.replace(/<!--[\s\S]*?-->/g, "");   // strip comments
  s = s.replace(/>\s+</g, "><");                  // collapse inter-tag whitespace
  return s.trim();
}

/** Extract link targets used to build idx (data-goto="id" or go="id") */
function extractLinks(html) {
  const out = [];
  const re = /\b(?:data-goto|go)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

const TAG_LINE_RE = /^\s*(?:<!--\s*)?tags:\s*([^>-][^>]*)?(?:\s*-->)?\s*$/i;

function parseInlineTagsFirstLine(source) {
  const lines = String(source || "").split(/\r?\n/);
  if (!lines.length) return { tags: [], body: "" };
  const first = lines[0];
  const m = TAG_LINE_RE.exec(first);
  if (!m) return { tags: [], body: String(source) };
  const tagStr = (m[1] || "").trim();
  const tags = tagStr
    ? tagStr.split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
    : [];
  // Remove the directive line from HTML body
  const body = lines.slice(1).join("\n");
  return { tags, body };
}

function isValidId(id){ return /^[A-Za-z0-9._-]+$/.test(id); }

/**
 * @param {Record<string,string>} passagesMap  id -> html
 * @param {object} options
 * @param {string=} options.startId
 * @param {object=} options.metaOverrides
 * @param {string=} options.created
 * @param {string=} options.modified
 * @param {boolean=} options.strictIds
 * @param {boolean=} options.minify
 * @param {Record<string,string[]>=} options.tagsMap  sidecar tags.json (id -> tags[])
 * @param {boolean=} options.parseInlineTags  if true, parse "tags: a,b" from first line of each passage
 */
export function compileRawPack(passagesMap, options = {}) {
  if (!passagesMap || typeof passagesMap !== "object") throw new Error("compileRawPack: passagesMap required");
  const {
    startId,
    metaOverrides = {},
    created,
    modified,
    strictIds = true,
    minify = true,
    tagsMap = null,
    parseInlineTags = true
  } = options;

  // Stable order from object keys (your sources preserve insertion order)
  const ids = Object.keys(passagesMap);
  if (ids.length === 0) throw new Error("No passages provided.");
  if (strictIds) for (const id of ids) if (!isValidId(id)) throw new Error(`Invalid id "${id}". Allowed: A-Z a-z 0-9 . _ -`);

  const idToIdx = new Map(ids.map((id, i) => [id, i]));

  const html = new Array(ids.length);
  const idx  = new Array(ids.length);
  const tags = new Array(ids.length);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const raw = passagesMap[id];
    if (typeof raw !== "string") throw new Error(`Passage "${id}" is not a string`);

    // Inline tags directive (first line), optional
    let inlineTags = [];
    let body = raw;
    if (parseInlineTags) {
      const parsed = parseInlineTagsFirstLine(raw);
      inlineTags = parsed.tags;
      body = parsed.body;
    }

    // Sidecar tags.json, optional
    const sidecar = Array.isArray(tagsMap?.[id]) ? tagsMap[id] : [];

    // Merge, normalize, and dedupe tags
    const mergedTags = Array.from(new Set([...sidecar, ...inlineTags].map(t => t.trim().toLowerCase()).filter(Boolean)));

    // Minify the body we’ll store
    html[i] = minify ? minifyHtml(body) : body;
    tags[i] = mergedTags;

    // Build outgoing edges from final HTML
    const links = extractLinks(html[i]);
    const out = [];
    const seen = new Set();
    for (const to of links) {
      const j = idToIdx.get(to);
      if (j != null && !seen.has(j)) { out.push(j); seen.add(j); }
    }
    idx[i] = out;
  }

  const start = (typeof startId === "string" && startId)
    ? startId
    : (ids.includes("start") ? "start" : ids[0]);

  const nowIso = new Date().toISOString();
  const meta = {
    title: "Untitled Story",
    author: "",
    ifid: metaOverrides.ifid || "",
    version: metaOverrides.version || "0.1.0",
    created: created || nowIso,
    modified: modified || nowIso,
    locale: metaOverrides.locale || "en-US",
    options: metaOverrides.options || { strictIds: true, hashRouting: true },
    ...metaOverrides
  };

  const draft = { fmt:"v2c", version:1, start, ids, html, idx, tags, meta };
  const v2c = normalizeV2c(draft);
  const v = validateV2c(v2c);
  if (!v.ok) throw new Error(`compileRawPack validation failed: ${v.error}`);
  return v2c;
}
