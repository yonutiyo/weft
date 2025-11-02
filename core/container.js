// core/container.mjs
// v2 container wrapper (codec: deflate-b64url; checksum: adler32)

import { utf8Encode, base64urlEncode, adler32 } from "./bytes.js";

export function makeV2Container(v2c, opts = {}) {
  const { deflate, level = 6 } = opts;
  if (typeof deflate !== "function") throw new Error("makeV2Container: deflate(bytes) function required");

  const rawBytes = utf8Encode(JSON.stringify(v2c));
  const checksum = adler32(rawBytes);
  let deflated;
  try {
    deflated = deflate(rawBytes, level);
  } catch (e) {
    throw new Error("Deflate failed");
  }
  const payload = base64urlEncode(deflated);
  return { fmt:"v2", codec:"deflate-b64url", algo:"adler32", size_raw: rawBytes.length, checksum, payload };
}
