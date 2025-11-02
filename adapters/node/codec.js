// adapters/node/codec.js
import zlib from "node:zlib";

// Return a SYNC deflater to satisfy code paths that don't await.
// It takes a Uint8Array and returns a Uint8Array.
export function getNodeDeflate(level = 6) {
  return (u8) => new Uint8Array(zlib.deflateRawSync(u8, { level }));
}

// If you ever need async elsewhere, you can export this too:
// export async function getNodeDeflateAsync(level = 6) {
//   return (u8) => new Promise((res, rej) => {
//     zlib.deflateRaw(u8, { level }, (err, buf) => {
//       if (err) rej(err);
//       else res(new Uint8Array(buf));
//     });
//   });
// }
