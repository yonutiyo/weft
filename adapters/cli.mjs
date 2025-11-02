#!/usr/bin/env node
// adapters/cli.mjs
//
// Build tool for story packs.
// - Inputs: Weft files (.weft) or a JS module exporting { passages }.
// - Outputs:
//     * raw v2c JSON (--raw-out)
//     * v2 container JSON (--v2-out)
//     * single-file HTML with embedded pack + runtime (--single-file-out)
// - Options:
//     --start <id>, --title <t>, --author <a>, --locale <l>
//     --deterministic (fixed timestamps)
//     --strict-lint (exit nonzero if unreachable/dangling/empty)

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { compileRawPack } from "../core/pack-compiler.js";
import { validateV2c } from "../core/schema.js";
import { lint } from "../core/lint.js";
import { makeV2Container } from "../core/container.js";
import { base64urlDecode as fromBase64Url, adler32Hex } from "../core/bytes.js";
import { getNodeDeflate } from "./node/codec.js";
import { parseWeftText } from "../core/weft-parser.js";
import { buildSingleFileHtml } from "../core/export-single.js";

function log(...a) { console.log("[story-pack]", ...a); }

function usage(code = 0) {
  console.log(`
Usage:
  story-pack --in <paths...> [--raw-out pack.json] [--v2-out pack.v2.json] [--single-file-out index.html]
             [--start <id>] [--title <t>] [--author <a>] [--locale <l>]
             [--deterministic] [--strict-lint]

Inputs:
  --in <paths...>         One or more inputs (.weft or a JS module that exports { passages })
                          If omitted, tries ./story.weft, then ./passages.js

Outputs:
  --raw-out <path>        Write raw v2c JSON (ids/html/idx/tags/meta)
  --v2-out <path>         Write deflate-b64url container JSON with checksum
  --single-file-out <p>   Write a single-file HTML with embedded pack + runtime

Options:
  --start <id>            Override start passage id
  --title <t>             Override title
  --author <a>            Override author
  --locale <l>            Override locale (default en-US)
  --deterministic         Use fixed timestamps for reproducible builds
  --strict-lint           Exit nonzero if lint finds unreachable/dangling/empty
`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    inPaths: [],
    rawOut: null,
    v2Out: null,
    singleFileOut: null,
    start: "",
    title: undefined,
    author: undefined,
    locale: undefined,
    deterministic: false,
    strictLint: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--help": usage(0); break;
      case "--in": while (argv[i+1] && !argv[i+1].startsWith("--")) { args.inPaths.push(argv[++i]); } break;
      case "--raw-out": args.rawOut = argv[++i]; break;
      case "--v2-out": args.v2Out = argv[++i]; break;
      case "--single-file-out": args.singleFileOut = argv[++i]; break;
      case "--start": args.start = argv[++i]; break;
      case "--title": args.title = argv[++i]; break;
      case "--author": args.author = argv[++i]; break;
      case "--locale": args.locale = argv[++i]; break;
      case "--deterministic": args.deterministic = true; break;
      case "--strict-lint": args.strictLint = true; break;
      default:
        if (a.startsWith("--")) {
          console.error(`Unknown option: ${a}`);
          usage(1);
        } else {
          args.inPaths.push(a);
        }
    }
  }
  return args;
}

function exists(p) { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } }

async function resolveInput(cwd, inPaths) {
  // Decide between .weft and .js inputs; allow multiple .weft files, or a single JS module.
  const abs = (p) => path.resolve(cwd, p);
  if (!inPaths || inPaths.length === 0) {
    const weftDefault = abs("story.weft");
    const jsDefault = abs("passages.js");
    if (exists(weftDefault)) return { kind: "weft", paths: [weftDefault] };
    if (exists(jsDefault)) return { kind: "js", paths: [jsDefault] };
    usage(1);
  }
  const absPaths = inPaths.map(abs);
  const wefts = absPaths.filter(p => p.toLowerCase().endsWith(".weft"));
  const jss   = absPaths.filter(p => p.toLowerCase().endsWith(".js"));
  if (wefts.length > 0 && jss.length > 0) {
    throw new Error("Do not mix .weft and .js inputs in one invocation.");
  }
  if (wefts.length > 0) return { kind: "weft", paths: wefts };
  if (jss.length === 1) return { kind: "js", paths: jss };
  if (jss.length > 1) throw new Error("Provide only one JS module that exports { passages }.");
  throw new Error("No usable inputs found.");
}

function maybeReadTagsJson(cwd) {
  const p = path.resolve(cwd, "tags.json");
  if (!exists(p)) return null;
  try {
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    if (obj && typeof obj === "object") return obj;
  } catch {}
  return null;
}

const isoNow = () => new Date().toISOString();
const deterministicTimestamp = () => "2000-01-01T00:00:00.000Z";

async function buildPassagesFromWeft(paths) {
  let meta = {};
  let passages = {};
  let tagsMap = {};
  const diagnostics = [];

  for (const filePath of paths) {
    const txt = fs.readFileSync(filePath, "utf8");
    const r = parseWeftText(txt, filePath);
    // Merge
    for (const [k, v] of Object.entries(r.passages || {})) {
      if (passages[k] != null) throw new Error(`Duplicate passage id "${k}" across inputs.`);
      passages[k] = v;
    }
    if (r.meta) meta = { ...meta, ...r.meta }; // later files override earlier
    if (r.tagsMap) {
      for (const [k, arr] of Object.entries(r.tagsMap)) {
        tagsMap[k] = Array.isArray(tagsMap[k]) ? Array.from(new Set([...tagsMap[k], ...arr])) : arr.slice();
      }
    }
    if (Array.isArray(r.diagnostics) && r.diagnostics.length) diagnostics.push(...r.diagnostics);
  }
  return { meta, passages, tagsMap, diagnostics };
}

async function buildPassagesFromJsModule(cwd, filePath) {
  const url = pathToFileURL(path.resolve(cwd, filePath)).href;
  const mod = await import(url);
  const passages = mod?.passages || mod?.default?.passages || mod?.default || {};
  if (!passages || typeof passages !== "object") {
    throw new Error(`${filePath} did not export a passages map`);
  }
  return { meta: {}, passages, tagsMap: {}, diagnostics: [] };
}

// adapters/cli.mjs — only include runtime needed to PLAY, not author tools
function collectRuntimeSources(cwd) {
  const candidates = [
    "pack-provider.js",  // provides createJsonProvider(v2c)
    "engine.js",         // the actual engine
    "sidebar.js",        // optional; safe to skip if not present
    "debug-overlay.js"   // optional; safe to skip if not present
  ];
  const out = [];
  for (const rel of candidates) {
    const p = path.resolve(cwd, rel);
    if (exists(p)) {
      out.push({ name: rel, code: fs.readFileSync(p, "utf8") });
    }
  }
  return out;
}

function collectInlineCss(cwd) {
  const pick = [];
  for (const rel of ["ui.css", "style.css"]) {
    const p = path.resolve(cwd, rel);
    if (exists(p)) pick.push(fs.readFileSync(p, "utf8"));
  }
  return pick.join("\n");
}

(async function main() {
  try {
    const cwd = process.cwd();
    const args = parseArgs(process.argv);

    if (!args.rawOut && !args.v2Out && !args.singleFileOut) {
      log("No outputs specified. Use --raw-out and/or --v2-out and/or --single-file-out.");
      usage(1);
    }

    const input = await resolveInput(cwd, args.inPaths);

    let meta = {};
    let passages = {};
    let tagsMap = maybeReadTagsJson(cwd) || {};

    if (input.kind === "weft") {
      const r = await buildPassagesFromWeft(input.paths);
      meta = r.meta || {};
      passages = r.passages || {};
      // tags.json takes precedence; otherwise merge from weft
      if (!tagsMap || Object.keys(tagsMap).length === 0) tagsMap = r.tagsMap || {};
      if (r.diagnostics?.length) {
        for (const d of r.diagnostics) console.warn("[weft]", d);
      }
    } else if (input.kind === "js") {
      const r = await buildPassagesFromJsModule(cwd, input.paths[0]);
      meta = r.meta || {};
      passages = r.passages || {};
      if (!tagsMap || Object.keys(tagsMap).length === 0) tagsMap = r.tagsMap || {};
    } else {
      throw new Error(`Unknown input kind: ${input.kind}`);
    }

    const created  = args.deterministic ? deterministicTimestamp() : isoNow();
    const modified = args.deterministic ? deterministicTimestamp() : isoNow();

    const metaOverrides = {
      // Leave IFID alone unless you add a generator elsewhere.
      title: args.title ?? meta.title,
      author: args.author ?? meta.author,
      locale: args.locale ?? meta.locale
    };

    const startId = args.start || meta.start || "";

    const raw = compileRawPack(passages, {
      startId,
      metaOverrides,
      created,
      modified,
      strictIds: true,
      minify: true,
      tagsMap,
      parseInlineTags: true
    });

    const v = validateV2c(raw);
    if (!v.ok) {
      console.error(v.error);
      process.exit(1);
    }

    const report = lint(raw);
    if (report?.counts) {
      const c = report.counts;
      log(`Lint: unreachable=${c.unreachable}, dangling=${c.dangling}, empty=${c.empty}, duplicateTagPairs=${c.duplicateTagPairs}`);
      if (args.strictLint && (c.unreachable || c.dangling || c.empty)) process.exit(2);
    }

    if (args.rawOut) {
      fs.writeFileSync(path.resolve(cwd, args.rawOut), JSON.stringify(raw), "utf8");
      log(`Wrote RAW v2c → ${args.rawOut}`);
    }

    if (args.v2Out) {
  const deflate = getNodeDeflate(6);
  const v2 = makeV2Container(raw, { deflate, level: 6 });
  // v2 already has correct checksum - don't override it!
  fs.writeFileSync(path.resolve(cwd, args.v2Out), JSON.stringify(v2), "utf8");
  log(`Wrote V2 container → ${args.v2Out}`);
}

    if (args.singleFileOut) {
      const runtimeSources = collectRuntimeSources(cwd);
      const inlineCss = collectInlineCss(cwd);
      const html = buildSingleFileHtml({
        v2c: raw,
        runtimeSources,
        title: metaOverrides.title || raw?.meta?.title,
        inlineCss
      });
      fs.writeFileSync(path.resolve(cwd, args.singleFileOut), html, "utf8");
      log(`Wrote Single-File HTML → ${args.singleFileOut}`);
    }

  } catch (e) {
    console.error(e?.stack || String(e));
    process.exit(1);
  }
})();








