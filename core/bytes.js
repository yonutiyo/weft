// core/bytes.js
// Shared utilities: UTF-8, Base64URL, Adler-32.
// Optimized for performance and memory efficiency

// ---- UTF-8 ----
const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
const dec = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;

export function utf8Encode(str) {
  if (enc) return enc.encode(str);
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(str, "utf8"));
  // Minimal fallback
  const arr = unescape(encodeURIComponent(str)).split("").map(c => c.charCodeAt(0));
  return new Uint8Array(arr);
}

export function utf8Decode(u8) {
  if (dec) return dec.decode(u8);
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("utf8");
  return decodeURIComponent(escape(String.fromCharCode(...u8)));
}

// ---- Base64URL (bytes <-> string) ----
/**
 * Optimized base64 encoding that avoids String.fromCharCode.apply stack issues
 * Uses a more efficient chunked approach
 */
function base64FromBytes(u8) {
  // Fast Node path
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  
  // Browser path - optimized chunking
  // Use smaller chunks and pre-allocated array for better performance
  const CHUNK = 8192; // 8KB chunks - good balance of performance and memory
  const chunks = [];
  
  for (let i = 0; i < u8.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, u8.length);
    const chunk = u8.subarray(i, end);
    
    // Build string more efficiently
    let str = '';
    for (let j = 0; j < chunk.length; j++) {
      str += String.fromCharCode(chunk[j]);
    }
    chunks.push(str);
  }
  
  return btoa(chunks.join(''));
}

/**
 * Optimized base64 decoding
 */
function bytesFromBase64(b64) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  
  // Use a single pass with direct charCodeAt
  for (let i = 0; i < len; i++) {
    out[i] = bin.charCodeAt(i);
  }
  
  return out;
}

/**
 * Base64URL encoding (URL-safe base64)
 * Replaces + with -, / with _, and removes padding
 */
export function base64urlEncode(u8) {
  const b64 = base64FromBytes(u8);
  // Use regex replace for better performance on large strings
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Base64URL decoding
 * Handles URL-safe base64 with proper padding
 */
export function base64urlDecode(b64url) {
  // Normalize: replace URL-safe chars and add padding
  // Padding formula: add '=' chars to make length multiple of 4
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (b64.length % 4)) % 4;
  const padded = b64 + "===".slice(0, pad);
  
  return bytesFromBase64(padded);
}

// Optional aliases
export const toBase64Url = base64urlEncode;
export const fromBase64Url = base64urlDecode;

// ---- Adler-32 ----
/**
 * Optimized Adler-32 checksum
 * Returns unsigned 32-bit integer
 * 
 * Performance optimizations:
 * - Process in larger blocks to reduce modulo operations
 * - Use bitwise ops for final combination
 */
export function adler32U32(u8) {
  const MOD = 65521;
  const BLOCK_SIZE = 5552; // Largest n where 255n(n+1)/2 + (n+1)(BASE-1) <= 2^32-1
  
  let a = 1;
  let b = 0;
  let pos = 0;
  
  while (pos < u8.length) {
    const end = Math.min(pos + BLOCK_SIZE, u8.length);
    
    // Process block without modulo (deferred)
    while (pos < end) {
      a += u8[pos++];
      b += a;
    }
    
    // Apply modulo after block
    a %= MOD;
    b %= MOD;
  }
  
  return ((b << 16) | a) >>> 0;
}

/**
 * Hex string helper - returns 8 lowercase hex chars
 */
export function adler32Hex(u8) {
  return adler32U32(u8).toString(16).padStart(8, "0");
}

// Back-compat export
export const adler32 = adler32Hex;

/**
 * Additional utility: Fast comparison of two Uint8Arrays
 * Useful for content verification
 */
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  
  // Use typed array comparison if available (much faster)
  if (a.every) {
    return a.every((val, i) => val === b[i]);
  }
  
  // Fallback
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  
  return true;
}

/**
 * Create a hex dump string for debugging
 * Useful for inspecting binary data
 */
export function hexDump(u8, maxBytes = 256) {
  const len = Math.min(u8.length, maxBytes);
  const lines = [];
  
  for (let i = 0; i < len; i += 16) {
    const hex = [];
    const ascii = [];
    
    for (let j = 0; j < 16 && i + j < len; j++) {
      const byte = u8[i + j];
      hex.push(byte.toString(16).padStart(2, '0'));
      ascii.push(byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.');
    }
    
    const offset = i.toString(16).padStart(8, '0');
    lines.push(`${offset}  ${hex.join(' ').padEnd(48)}  ${ascii.join('')}`);
  }
  
  if (u8.length > maxBytes) {
    lines.push(`... (${u8.length - maxBytes} more bytes)`);
  }
  
  return lines.join('\n');
}
