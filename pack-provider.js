// pack-provider.js
// Loader for story packs.
// Supports:
//   - v2 container JSON (fmt:"v2", payload is deflate+base64url, checksum is adler32 hex)
//   - raw v2c JSON (fmt:"v2c" or an object with ids/html/idx/version)
// Exposes:
//   loadPack(input)       => resolves to the normalized v2c object
//   getLoadedPack()       => returns the loaded v2c pack
//   createPackProvider()  => returns a provider object with get(id) method
//   getStartId()          => string
//   get(id)               => { id, html, links[], tags[] } | null
//   getAllIds()           => string[]
//   getTags(id)           => string[]

import { base64urlDecode, adler32 as adler32Hex } from "./core/bytes.js";

let _packV2c = null;

// Minimal, dependency-tolerant pako loader.
// 1) If window.pako exists, use it
// 2) Try dynamic import('pako') for bundlers
// 3) Otherwise, rely on <script> having loaded pako (or throw)
async function ensurePako() {
  if (globalThis.pako) return globalThis.pako;
  try {
    const mod = await import("pako");
    const lib = mod?.default ?? mod;
    if (lib) {
      globalThis.pako = lib;
      return lib;
    }
  } catch {
    /* ignore; fall through */
  }
  if (!globalThis.pako) {
    throw new Error(
      "pako not found. Include it via <script> (with SRI) or bundle it. " +
      "See: https://github.com/nodeca/pako"
    );
  }
  return globalThis.pako;
}

function isLikelyV2c(obj) {
  return !!obj && typeof obj === "object" &&
         obj.version === 1 && Array.isArray(obj.ids) && Array.isArray(obj.html) && Array.isArray(obj.idx);
}

function isV2Container(obj) {
  return !!obj && typeof obj === "object" && obj.fmt === "v2" && typeof obj.payload === "string";
}

function normalizeV2c(v2c) {
  // Basic sanity; you can strengthen this if you want strict validation.
  if (!isLikelyV2c(v2c)) throw new Error("Invalid v2c pack structure.");
  return v2c;
}

/**
 * Load a story pack.
 * @param {string|object} input - URL to JSON, or a parsed JSON object (v2 or v2c).
 * @returns {Promise<object>} v2c object.
 */
export async function loadPack(input) {
  let parsed;

  if (typeof input === "string") {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to fetch "${input}": ${res.status} ${res.statusText}`);
    const text = await res.text();
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON at "${input}": ${e.message}`);
    }
  } else if (input && typeof input === "object") {
    parsed = input;
  } else {
    throw new Error("loadPack: input must be a URL string or a JSON object.");
  }

  // Raw v2c given directly
  if (isLikelyV2c(parsed) || parsed.fmt === "v2c") {
    _packV2c = normalizeV2c(parsed);
    return _packV2c;
  }

  // v2 container → inflate → verify checksum → parse → v2c
  if (isV2Container(parsed)) {
    const comp = base64urlDecode(parsed.payload); // Uint8Array
    const pako = await ensurePako();
    const rawBytes = pako.inflate(comp);         // Uint8Array

    // Verify Adler-32 hex if provided
    const checksum = adler32Hex(rawBytes);       // 8-char lowercase hex
    if (parsed.checksum && typeof parsed.checksum === "string" && parsed.checksum !== checksum) {
      throw new Error(`checksum mismatch: expected ${parsed.checksum} got ${checksum}`);
    }

    // Decode bytes → string → JSON
    const jsonStr = new TextDecoder().decode(rawBytes);
    let v2c;
    try {
      v2c = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(`Inflated payload is not valid JSON: ${e.message}`);
    }
    _packV2c = normalizeV2c(v2c);
    return _packV2c;
  }

  throw new Error("Unrecognized pack format. Expect a v2 container {fmt:'v2', payload,...} or a v2c object.");
}

/**
 * Get the loaded pack (after calling loadPack)
 * @returns {object} The loaded v2c pack
 */
export function getLoadedPack() {
  if (!_packV2c) throw new Error("No pack loaded. Call loadPack() first.");
  return _packV2c;
}

/**
 * Create a provider object from a v2c pack
 * @param {object} v2c - The v2c pack object
 * @returns {object} Provider with async get(id) method
 */
export function createPackProvider(v2c) {
  if (!v2c || v2c.fmt !== "v2c") {
    throw new Error("createPackProvider: v2c pack required");
  }

  const ids = v2c.ids || [];
  const html = v2c.html || [];
  const idx = v2c.idx || [];
  const tags = Array.isArray(v2c.tags) ? v2c.tags : [];

  return {
    async get(id) {
      const i = ids.indexOf(id);
      if (i < 0) return null;
      
      const passageHtml = html[i];
      const links = (idx[i] || []).map(j => ids[j]);
      const passageTags = tags[i] || [];
      
      return passageHtml; // Engine expects just the HTML string
    }
  };
}

export function getStartId() {
  if (!_packV2c) throw new Error("No pack loaded. Call loadPack() first.");
  return _packV2c.start || _packV2c.ids?.[0] || "";
}

export function getAllIds() {
  if (!_packV2c) throw new Error("No pack loaded. Call loadPack() first.");
  return _packV2c.ids.slice();
}

export function getTags(id) {
  if (!_packV2c) throw new Error("No pack loaded. Call loadPack() first.");
  const i = _packV2c.ids.indexOf(id);
  if (i < 0) return [];
  return Array.isArray(_packV2c.tags) ? (_packV2c.tags[i] || []) : [];
}

export function get(id) {
  if (!_packV2c) throw new Error("No pack loaded. Call loadPack() first.");
  const i = _packV2c.ids.indexOf(id);
  if (i < 0) return null;
  const html = _packV2c.html[i];
  const links = (_packV2c.idx[i] || []).map(j => _packV2c.ids[j]);
  const tags  = Array.isArray(_packV2c.tags) ? (_packV2c.tags[i] || []) : [];
  return { id, html, links, tags };
}






