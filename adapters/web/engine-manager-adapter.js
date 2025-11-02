// adapters/web/engine-manager-adapter.mjs
// Small helpers for the browser to supply deflate() to the core.

export async function ensurePako() {
  if (window.pako) return window.pako;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js";
    s.onload = res; s.onerror = () => rej(new Error("Failed to load pako"));
    document.head.appendChild(s);
  });
  return window.pako;
}

export async function getBrowserDeflate(level = 6) {
  const pako = await ensurePako();
  return (bytes, lvl = level) => pako.deflate(bytes, { level: lvl });
}
