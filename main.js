// main.js — load the pack first (raw v2c or v2 container), then start the engine.

import { createEngine } from "./engine.js";
import { loadPack, getLoadedPack, createPackProvider } from "./pack-provider.js";
import { attachDebugOverlay } from "./debug-overlay.js";
import { attachSidebar } from "./sidebar.js";

const engine = createEngine({
  appSelector: "#app",
  cacheSize: 200,
  useHashRouting: true,
  maxHistory: 50  // Maximum undo/redo steps
});

async function boot() {
  try {
    // 1) Load content.pack.json (handles both RAW v2c and v2 container)
    await loadPack("./content.pack.json");

    // 2) Get the validated raw pack and create a provider from it
    const rawPack = getLoadedPack(); // guaranteed fmt:"v2c"
    const provider = createPackProvider(rawPack);
    engine.useContentProvider(provider);

    // 3) Determine a starting passage
    let startId = rawPack.start || "start";

    // 4) Probe the starting passage; if unreadable, try first id as a fallback
    let html = await provider.get(startId);
    if (!html || typeof html !== "string" || html.length === 0) {
      const firstId = Array.isArray(rawPack.ids) && rawPack.ids.length ? rawPack.ids[0] : null;
      console.warn("[main] start probe failed for", startId, "— trying", firstId);
      if (firstId) {
        const alt = await provider.get(firstId);
        if (alt && typeof alt === "string" && alt.length) {
          startId = firstId;
        } else {
          throw new Error(`Could not load passage "${startId}" or fallback "${firstId}".`);
        }
      } else {
        throw new Error("Pack contains no passages.");
      }
    }

    // 5) Start the engine
    await engine.start(startId);
    
    // Log initial state for debugging
    console.log("[main] Engine started at passage:", startId);
    console.log("[main] Initial state:", engine.getState());
    
  } catch (e) {
    console.error("[main] boot error:", e);
    const app = document.querySelector("#app");
    if (app) {
      app.innerHTML = `<h1>Failed to load content pack</h1><p>${e?.message || String(e)}</p>`;
    }
  }
}

boot();

// Attach tools
attachDebugOverlay(engine, { hotkey: "`", startOpen: false });
attachSidebar(engine);

// Log engine capabilities
console.log("[main] Engine features:");
console.log("  - Undo/Redo: enabled (max", engine.historyLength || 0, "steps)");
console.log("  - Hash routing:", true);
console.log("  - Cache size:", engine.cacheSize);
console.log("  - Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Shift+Z (redo)");
