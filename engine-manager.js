import { passages as jsPassages } from "./passages.js";
import { mountGraphFromPassages } from "./graph-view.js";

// core
import { compileRawPack } from "./core/pack-compiler.js";
import { validateV2c } from "./core/schema.js";
import { makeV2Container } from "./core/container.js";
import { lint } from "./core/lint.js";
import { buildSingleFileHtml } from "./core/export-single.js";
import { getBrowserDeflate } from "./adapters/web/engine-manager-adapter.js";

// ---------- UI helpers ----------
const $ = (s) => document.querySelector(s);
const errEl = $("#error");
const statusEl = $("#status");
const prog = $("#prog");
const bar = prog?.querySelector("div");
const previewEl = $("#preview");
const statsEl = $("#stats");

// Weft UI
const loadWeftBtn = $("#loadWeftBtn");
const weftInput = $("#weftInput");

// Build controls
const buildRawBtn = $("#buildRawBtn");
const downloadRawBtn = $("#downloadRawBtn");
const buildCompressedBtn = $("#buildCompressedBtn");
const downloadCompressedBtn = $("#downloadCompressedBtn");
const buildSingleBtn = $("#buildSingleBtn");
const downloadSingleBtn = $("#downloadSingleBtn");

// Graph controls
const renderGraphBtn = $("#renderGraphBtn");
const fitBtn = $("#fitBtn");
const resetBtn = $("#resetBtn");
const layoutSelect = $("#layoutSelect");
const hideUnreachableCheckbox = $("#hideUnreachable");
const searchBox = $("#searchBox");

// Tag controls
const inlineTagsCheckbox = $("#inlineTags");
const tagChips = $("#tagChips");
const tagFilterInput = $("#tagFilterInput");
const tagHideMode = $("#tagHideMode");

// Inspector
const inspectTitle = $("#inspectTitle");
const inspectHtml = $("#inspectHtml");
const inspectTags = $("#inspectTags");

function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }
function showError(msg) { if (errEl) { errEl.style.display = "block"; errEl.textContent = msg; } }
function clearError()   { if (errEl) { errEl.style.display = "none"; errEl.textContent = ""; } }
function setProgress(f) {
  if (!prog || !bar) return;
  if (f == null) { prog.style.display = "none"; bar.style.width = "0%"; return; }
  prog.style.display = "block";
  bar.style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + "%";
}
const kib = (n) => (n/1024).toFixed(1) + " KiB";
function currentTheme() { return (document.documentElement.getAttribute("data-theme") === "dark") ? "dark" : "light"; }

// IFID convenience for browser (not used by CLI)
const IFID_KEY = "em-ifid";
function uuidV4() {
  const a = crypto.getRandomValues(new Uint8Array(16));
  a[6] = (a[6] & 0x0f) | 0x40; a[8] = (a[8] & 0x3f) | 0x80;
  const h = [...a].map(b => b.toString(16).padStart(2,"0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function getOrCreateIFID() {
  let id = localStorage.getItem(IFID_KEY);
  if (!id) { id = uuidV4(); localStorage.setItem(IFID_KEY, id); }
  return id;
}
const createdCacheKey = "em-created";
if (!localStorage.getItem(createdCacheKey)) localStorage.setItem(createdCacheKey, new Date().toISOString());

// ---------- Tab System ----------
const TAB_KEY = "em-active-tab";

function initTabs() {
  const tabs = document.querySelectorAll(".tab");
  const tabContents = document.querySelectorAll(".tab-content");
  
  // Restore last active tab
  const savedTab = localStorage.getItem(TAB_KEY) || "build";
  
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetTab = tab.dataset.tab;
      
      // Update tab states
      tabs.forEach(t => {
        t.classList.toggle("active", t.dataset.tab === targetTab);
        t.setAttribute("aria-selected", String(t.dataset.tab === targetTab));
      });
      
      // Update content visibility
      tabContents.forEach(content => {
        content.classList.toggle("active", content.id === `tab-${targetTab}`);
      });
      
      // Save preference
      try { localStorage.setItem(TAB_KEY, targetTab); } catch {}
      
      // Lazy init graph if switching to graph tab for first time
      if (targetTab === "graph" && graphApi === null && lastRawPack !== null) {
        // Auto-render graph if data is available
        setTimeout(() => {
          if (renderGraphBtn && !renderGraphBtn.disabled) {
            console.log("[tabs] Auto-rendering graph on first visit");
          }
        }, 100);
      }
    });
  });
  
  // Activate saved tab
  const tabToActivate = Array.from(tabs).find(t => t.dataset.tab === savedTab);
  if (tabToActivate) {
    tabToActivate.click();
  }
}

// ---------- Active source (weft or js) ----------
let activeSource = { type: "js", name: "passages.js" };
let activePassages = null;   // when type=weft, this holds the merged passages object
let activeTagsMap = null;    // weft-only; for js we may still read tags.json if present
let activeMeta = null;       // weft header (title/author/locale/start) if present

function isWeft() { return activeSource.type === "weft"; }
function getSourcePassages() { return isWeft() ? (activePassages || {}) : jsPassages; }
function getParseInlineTagsFlag() { return isWeft() ? false : !!inlineTagsCheckbox?.checked; }
function getTagsMapForBuild() { return isWeft() ? (activeTagsMap || null) : null; }

// ---------- State ----------
let lastRawPack = null;
let lastCompressedContainer = null;
let lastSingleHtml = null;
let graphApi = null;
let lastLint = null;

// ---------- Theme toggle ----------
const themeBtn = document.getElementById("themeToggle");
const THEME_KEY = "em-theme";
function applyTheme(mode) {
  const m = (mode === "dark") ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", m);
  if (themeBtn) {
    themeBtn.textContent = (m === "dark" ? "Dark" : "Light");
    themeBtn.setAttribute("aria-pressed", String(m === "dark"));
  }
  try { localStorage.setItem(THEME_KEY, m); } catch {}
  try { graphApi?.setTheme?.(m); } catch {}
}
(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const initial = saved || currentTheme();
  applyTheme(initial);
})();
themeBtn?.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
});

// ---------- Utilities ----------
async function maybeLoadTagsJson() {
  try {
    const res = await fetch("./tags.json?ts=" + Date.now(), { cache: "no-cache" });
    if (!res.ok) return null;
    const j = await res.json();
    return j && typeof j === "object" ? j : null;
  } catch { return null; }
}
function tagsArrayToMap(ids, tagsArr) {
  const map = {};
  for (let i=0;i<ids.length;i++) map[ids[i]] = Array.isArray(tagsArr[i]) ? tagsArr[i] : [];
  return map;
}
function renderInspector({ id, html, tags }) {
  if (inspectTitle) inspectTitle.textContent = `Inspector — ${id}`;
  if (inspectHtml) inspectHtml.textContent = String(html || "").slice(0, 4000) || "(empty)";
  if (inspectTags) {
    const items = (Array.isArray(tags) ? tags : []).map(t => `<span class="chip" tabindex="0">${t}</span>`).join(" ");
    inspectTags.innerHTML = items ? `Tags: ${items}` : "";
  }
}
function buildTagChips(topTags = []) {
  if (!tagChips) return;
  tagChips.innerHTML = "";
  for (const { tag } of topTags) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = tag;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      const pressed = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-pressed", String(!pressed));
      applyTagFilterFromUI();
    });
    tagChips.appendChild(btn);
  }
}
function getSelectedChips() {
  if (!tagChips) return new Set();
  const out = new Set();
  tagChips.querySelectorAll('.chip[aria-pressed="true"]').forEach(el => out.add(el.textContent.trim().toLowerCase()));
  return out;
}
function parseTagInput() {
  const raw = (tagFilterInput?.value || "").trim().toLowerCase();
  if (!raw) return new Set();
  return new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
}
function applyTagFilterFromUI() {
  if (!graphApi) return;
  const set = new Set([...getSelectedChips(), ...parseTagInput()]);
  const mode = tagHideMode?.checked ? "filter" : "highlight";
  graphApi.setTagFilter({ include: set, mode });
}

function updatePreviewAndStats(obj) {
  try {
    const v2c = obj && obj.fmt === "v2c" ? obj : (lastRawPack || null);
    if (v2c && previewEl) {
      const i = v2c.ids.indexOf(v2c.start);
      const head = String(v2c.html[i] || "").slice(0, 300);
      previewEl.textContent = head || "(no preview)";
    }
  } catch { if (previewEl) previewEl.textContent = "(preview unavailable)"; }

  try {
    if (!statsEl) return;
    statsEl.innerHTML = "";
    const add = (label, value) => {
      const div = document.createElement("div");
      div.innerHTML = `<div><b>${label}:</b> ${value}</div>`;
      statsEl.appendChild(div);
    };

    if (lastRawPack) {
      const rawJson = JSON.stringify(lastRawPack);
      add("Source", isWeft() ? "Weft (.weft)" : "JS (passages.js)");
      add("RAW fmt", lastRawPack.fmt);
      add("RAW version", String(lastRawPack.version));
      add("RAW passages", String(lastRawPack.ids.length));
      add("RAW size (JSON)", kib(new TextEncoder().encode(rawJson).length));
      const m = lastRawPack.meta || {};
      add("Title", m.title || "Untitled Story");
      add("IFID", m.ifid || "(none)");
      add("Locale", m.locale || "en-US");
      add("Start", lastRawPack.start);
      if (lastLint) {
        add("Unique tags", String(lastLint.counts.uniqueTags));
        add("Lint (unreachable)", lastLint.counts.unreachable);
      }
    }

    if (lastCompressedContainer) {
      const b64 = lastCompressedContainer.payload;
      const cBytes = b64.length * 0.75;
      add("Compressed size (est.)", kib(cBytes));
      const ratio = lastRawPack ? (cBytes / new TextEncoder().encode(JSON.stringify(lastRawPack)).length * 100).toFixed(1) : "N/A";
      add("Compression ratio", `${ratio}%`);
    }

    if (lastSingleHtml) {
      add("Single HTML size", kib(new TextEncoder().encode(lastSingleHtml).length));
    }
  } catch (e) { console.error("[stats] render error:", e); }
}

async function fetchText(path, optional = false) {
  try {
    const r = await fetch(path + "?ts=" + Date.now(), { cache: "no-cache" });
    if (!r.ok) {
      if (!optional) console.warn(`[fetch] ${path} not found (${r.status})`);
      return null;
    }
    return await r.text();
  } catch (e) {
    if (!optional) console.error(`[fetch] ${path} error:`, e);
    return null;
  }
}

// ---------- Build RAW ----------
buildRawBtn?.addEventListener("click", async () => {
  clearError(); setStatus("Building RAW pack…"); setProgress(0.2);
  try {
    const created = localStorage.getItem(createdCacheKey);
    const modified = new Date().toISOString();
    const metaOverrides = {
      ifid: getOrCreateIFID(),
      title: activeMeta?.title || undefined,
      author: activeMeta?.author || undefined,
      locale: activeMeta?.locale || undefined
    };
    const sourcePassages = getSourcePassages();
    const tagsMapSidecar = isWeft() ? getTagsMapForBuild() : await maybeLoadTagsJson();

    lastRawPack = compileRawPack(sourcePassages, {
      created, modified, metaOverrides,
      parseInlineTags: getParseInlineTagsFlag(),
      tagsMap: tagsMapSidecar
    });

    if (isWeft() && activeMeta?.start && lastRawPack.ids.includes(activeMeta.start)) {
      lastRawPack.start = activeMeta.start;
    }

    const v = validateV2c(lastRawPack);
    if (!v.ok) throw new Error(v.error);
    lastLint = lint(lastRawPack);

    setProgress(1);
    setStatus("RAW pack built.");
    downloadRawBtn.disabled = false;
    updatePreviewAndStats(lastRawPack);
  } catch (e) {
    console.error("[builder] RAW build error:", e);
    showError(e?.message || String(e)); setStatus("Idle (build failed).");
  } finally { setProgress(null); }
});

downloadRawBtn?.addEventListener("click", () => {
  if (!lastRawPack) return;
  const json = JSON.stringify(lastRawPack, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "content.pack.json"; document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
});

// ---------- Build compressed ----------
buildCompressedBtn?.addEventListener("click", async () => {
  clearError(); setStatus("Building compressed pack…"); setProgress(0.2);
  try {
    if (!lastRawPack) {
      const created = localStorage.getItem(createdCacheKey);
      const modified = new Date().toISOString();
      const metaOverrides = {
        ifid: getOrCreateIFID(),
        title: activeMeta?.title || undefined,
        author: activeMeta?.author || undefined,
        locale: activeMeta?.locale || undefined
      };
      const sourcePassages = getSourcePassages();
      const tagsMapSidecar = isWeft() ? getTagsMapForBuild() : await maybeLoadTagsJson();

      lastRawPack = compileRawPack(sourcePassages, {
        created, modified, metaOverrides,
        parseInlineTags: getParseInlineTagsFlag(),
        tagsMap: tagsMapSidecar
      });
      if (isWeft() && activeMeta?.start && lastRawPack.ids.includes(activeMeta.start)) {
        lastRawPack.start = activeMeta.start;
      }
      const v = validateV2c(lastRawPack);
      if (!v.ok) throw new Error(v.error);
      lastLint = lint(lastRawPack);
    }
    setProgress(0.5);

    const deflate = await getBrowserDeflate();
    lastCompressedContainer = makeV2Container(lastRawPack, { deflate });

    setProgress(1);
    setStatus("Compressed pack built.");
    downloadCompressedBtn.disabled = false;
    updatePreviewAndStats(lastRawPack);
  } catch (e) {
    console.error("[builder] Compressed build error:", e);
    showError(e?.message || String(e)); setStatus("Idle (build failed).");
  } finally { setProgress(null); }
});

downloadCompressedBtn?.addEventListener("click", () => {
  if (!lastCompressedContainer) return;
  const json = JSON.stringify(lastCompressedContainer, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "content.pack.json"; document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
});

// ---------- Build single-file ----------
buildSingleBtn?.addEventListener("click", async () => {
  clearError(); setStatus("Building single-file HTML…"); setProgress(0.15);
  try {
    if (!lastRawPack) {
      const created = localStorage.getItem(createdCacheKey);
      const modified = new Date().toISOString();
      const metaOverrides = {
        ifid: getOrCreateIFID(),
        title: activeMeta?.title || undefined,
        author: activeMeta?.author || undefined,
        locale: activeMeta?.locale || undefined
      };
      const sourcePassages = getSourcePassages();
      const tagsMapSidecar = isWeft() ? getTagsMapForBuild() : await maybeLoadTagsJson();

      lastRawPack = compileRawPack(sourcePassages, {
        created, modified, metaOverrides,
        parseInlineTags: getParseInlineTagsFlag(),
        tagsMap: tagsMapSidecar
      });
      if (isWeft() && activeMeta?.start && lastRawPack.ids.includes(activeMeta.start)) {
        lastRawPack.start = activeMeta.start;
      }
      const v = validateV2c(lastRawPack);
      if (!v.ok) throw new Error(v.error);
      lastLint = lint(lastRawPack);
    }
    setProgress(0.4);

    // Runtime JS sources
    const srcs = [];
    const addIf = async (path, optional=false) => {
      const t = await fetchText(path, optional);
      if (t != null) srcs.push({ name: path.replace(/^\.\//, ""), code: t });
    };
    await addIf("./pack-provider.js");
    await addIf("./engine.js");
    await addIf("./debug-overlay.js", true);
    await addIf("./sidebar.js", true);

    // Inline CSS
    let cssText = "";
    const css1 = await fetchText("./style.css", true);
    const css2 = await fetchText("./ui.css", true);
    if (css1) cssText += "/* style.css */\n" + css1 + "\n";
    if (css2) cssText += "/* ui.css */\n" + css2 + "\n";
    setProgress(0.7);

    lastSingleHtml = buildSingleFileHtml({
      v2c: lastRawPack,
      runtimeSources: srcs,
      title: lastRawPack?.meta?.title || "Story",
      inlineCss: cssText
    });

    setProgress(1);
    setStatus("Single-file build complete.");
    downloadSingleBtn.disabled = false; downloadRawBtn.disabled = false;
    updatePreviewAndStats(lastRawPack);
  } catch (e) {
    console.error("[builder] Single-file build error:", e);
    showError(e?.message || String(e)); setStatus("Idle (build failed).");
  } finally { setProgress(null); }
});

downloadSingleBtn?.addEventListener("click", () => {
  if (!lastSingleHtml) return;
  const blob = new Blob([lastSingleHtml], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "story.html"; document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
});

// ---------- Graph controls ----------
renderGraphBtn?.addEventListener("click", async () => {
  const loadingEl = document.getElementById("graphLoading");
  const loadingDetail = document.getElementById("graphLoadingDetail");
  
  try {
    if (loadingEl) loadingEl.classList.add("show");
    if (loadingDetail) loadingDetail.textContent = "Preparing data...";
    
    if (!lastRawPack) {
      const created = localStorage.getItem(createdCacheKey);
      const modified = new Date().toISOString();
      const metaOverrides = {
        ifid: getOrCreateIFID(),
        title: activeMeta?.title || undefined,
        author: activeMeta?.author || undefined,
        locale: activeMeta?.locale || undefined
      };
      const sourcePassages = getSourcePassages();
      const tagsMapSidecar = isWeft() ? getTagsMapForBuild() : await maybeLoadTagsJson();

      lastRawPack = compileRawPack(sourcePassages, {
        created, modified, metaOverrides,
        parseInlineTags: getParseInlineTagsFlag(),
        tagsMap: tagsMapSidecar
      });
      if (isWeft() && activeMeta?.start && lastRawPack.ids.includes(activeMeta.start)) {
        lastRawPack.start = activeMeta.start;
      }
      lastLint = lint(lastRawPack);
    }
    updatePreviewAndStats(lastRawPack);
    
    if (loadingDetail) loadingDetail.textContent = `Rendering ${lastRawPack.ids.length} nodes...`;
    
    if (graphApi) { graphApi.destroy(); graphApi = null; }

    // Small delay to show loading indicator
    await new Promise(resolve => setTimeout(resolve, 50));

    const tagsById = tagsArrayToMap(lastRawPack.ids, lastRawPack.tags);
    
    // Smart layout selection: breadthfirst for large graphs, cose for smaller
    let selectedLayout = layoutSelect?.value || "cose";
    const nodeCount = lastRawPack.ids.length;
    if (nodeCount >= 500 && selectedLayout === "cose") {
      selectedLayout = "breadthfirst";
      if (layoutSelect) layoutSelect.value = "breadthfirst";
      console.log(`[graph] Auto-selected breadthfirst for ${nodeCount} nodes`);
    }
    
    graphApi = mountGraphFromPassages({
      container: document.getElementById("graph"),
      passages: getSourcePassages(),
      startId: lastRawPack.start,
      layout: selectedLayout,
      hideUnreachable: !!hideUnreachableCheckbox?.checked,
      theme: currentTheme(),
      tagsById,
      onStats: (s) => {
        const el = document.getElementById("graphStats");
        if (el) {
          let perfClass = "perf-good";
          let perfLabel = "Good";
          if (s.nodes > 1000) { perfClass = "perf-ok"; perfLabel = "OK"; }
          if (s.nodes > 2000) { perfClass = "perf-slow"; perfLabel = "Slow"; }
          
          el.innerHTML = `Nodes: ${s.nodes}, Edges: ${s.edges} · Components: ${s.components} · Reachable: ${s.reachable} <span class="perf-indicator ${perfClass}">${perfLabel}</span>`;
        }
      },
      onSelect: renderInspector
    });

    buildTagChips(lastLint?.topTags || []);
    fitBtn.disabled = false;
    resetBtn.disabled = false;
    setStatus("Graph rendered.");
  } catch (e) { 
    console.error("[graph] render error:", e); 
    showError(e?.message || String(e)); 
  } finally {
    if (loadingEl) loadingEl.classList.remove("show");
  }
});

fitBtn?.addEventListener("click", () => { try { graphApi?.fit(); } catch {} });
resetBtn?.addEventListener("click", () => { 
  try { 
    graphApi?.fit(); 
    if (searchBox) searchBox.value = "";
    if (tagFilterInput) tagFilterInput.value = "";
    graphApi?.search("");
    graphApi?.setTagFilter({ include: new Set(), mode: "filter" });
    // Reset chip selections
    if (tagChips) {
      tagChips.querySelectorAll('.chip').forEach(chip => {
        chip.setAttribute("aria-pressed", "false");
      });
    }
  } catch {} 
});

layoutSelect?.addEventListener("change", () => { try { graphApi?.runLayout(layoutSelect.value); } catch {} });
hideUnreachableCheckbox?.addEventListener("change", () => { try { graphApi?.toggleHideUnreachable(hideUnreachableCheckbox.checked); } catch {} });
searchBox?.addEventListener("input", () => { try { graphApi?.search(searchBox.value || ""); } catch {} });

// Tag filter UI -> graph
tagFilterInput?.addEventListener("input", () => applyTagFilterFromUI());
tagHideMode?.addEventListener("change", () => applyTagFilterFromUI());

// ---------- Weft loader (UI; supports multi-file merge) ----------
loadWeftBtn?.addEventListener("click", () => weftInput?.click());
weftInput?.addEventListener("change", async (ev) => {
  clearError(); setStatus("Parsing .weft…"); setProgress(0.15);
  try {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;

    let parseWeftBlob;
    try {
      ({ parseWeftBlob } = await import("./adapters/web/weft-loader.js"));
    } catch {
      showError("Weft loader not found (adapters/web/weft-loader.js)."); setStatus("Idle."); return;
    }

    // Merge multiple .weft files
    let mergedPassages = {};
    let mergedTags = {};
    let firstMeta = null;
    let error = null;

    for (const f of files) {
      const { meta, passages, tagsMap, diagnostics } = await parseWeftBlob(f);
      diagnostics.forEach(d => {
        const prefix = d.severity === "error" ? "ERR" : "WARN";
        console[prefix === "ERR" ? "error" : "warn"](`${prefix} ${d.file}:${d.line}:${d.col} ${d.message}`);
      });
      if (diagnostics.some(d => d.severity === "error")) {
        error = new Error(`Weft parse error in ${f.name}`);
        break;
      }
      // Merge passages (error on duplicates)
      for (const [id, html] of Object.entries(passages)) {
        if (mergedPassages[id] != null) {
          error = new Error(`Duplicate passage id '${id}' across files`);
          break;
        }
        mergedPassages[id] = html;
      }
      if (error) break;
      // Merge tags
      for (const [id, tags] of Object.entries(tagsMap || {})) {
        if (!mergedTags[id]) mergedTags[id] = [];
        if (Array.isArray(tags)) {
          for (const t of tags) if (!mergedTags[id].includes(t)) mergedTags[id].push(t);
        }
      }
      if (!firstMeta) firstMeta = meta;
    }

    if (error) {
      showError(error.message); setStatus("Idle."); return;
    }

    activeSource = { type: "weft", name: files.length === 1 ? files[0].name : `${files.length} files` };
    activePassages = mergedPassages;
    activeTagsMap = mergedTags;
    activeMeta = firstMeta || null;

    // Clear previous builds (so buttons rebuild from new source)
    lastRawPack = null;
    lastCompressedContainer = null;
    lastSingleHtml = null;

    setProgress(1);
    setStatus(`Weft loaded: ${activeSource.name}`);
    downloadRawBtn.disabled = false;
    updatePreviewAndStats(null);
  } catch (e) {
    console.error("[weft] load error:", e);
    showError(e?.message || String(e)); setStatus("Idle.");
  } finally {
    setProgress(null);
    if (weftInput) weftInput.value = "";
  }
});

// ---------- Initialize ----------
initTabs();

// Auto-load story.weft if present
(async function autoLoadWeft() {
  try {
    const res = await fetch("./story.weft?ts=" + Date.now(), { cache: "no-cache" });
    if (!res.ok) {
      console.log("[init] No story.weft found, using passages.js");
      setStatus("Idle. Using passages.js (no story.weft found).");
      return;
    }
    
    const blob = await res.blob();
    if (blob.size === 0) {
      console.log("[init] story.weft is empty, using passages.js");
      setStatus("Idle. Using passages.js (story.weft empty).");
      return;
    }
    
    console.log("[init] Found story.weft, auto-loading...");
    setStatus("Loading story.weft...");
    setProgress(0.15);
    
    let parseWeftBlob;
    try {
      ({ parseWeftBlob } = await import("./adapters/web/weft-loader.js"));
    } catch {
      console.warn("[init] Weft loader not available");
      setStatus("Idle. Using passages.js (weft loader unavailable).");
      return;
    }
    
    const { meta, passages, tagsMap, diagnostics } = await parseWeftBlob(blob);
    diagnostics.forEach(d => {
      const prefix = d.severity === "error" ? "ERR" : "WARN";
      console[prefix === "ERR" ? "error" : "warn"](`${prefix} story.weft:${d.line}:${d.col} ${d.message}`);
    });
    
    if (diagnostics.some(d => d.severity === "error")) {
      console.error("[init] story.weft has parse errors, falling back to passages.js");
      setStatus("Idle. Using passages.js (story.weft has errors).");
      setProgress(null);
      return;
    }
    
    activeSource = { type: "weft", name: "story.weft" };
    activePassages = passages;
    activeTagsMap = tagsMap;
    activeMeta = meta || null;
    
    setProgress(1);
    setStatus(`Loaded: story.weft (${Object.keys(passages).length} passages)`);
    downloadRawBtn.disabled = false;
    updatePreviewAndStats(null);
    
    setTimeout(() => setProgress(null), 500);
  } catch (e) {
    console.error("[init] Auto-load error:", e);
    setStatus("Idle. Using passages.js.");
    setProgress(null);
  }
})();

downloadRawBtn.disabled = true;
downloadCompressedBtn.disabled = true;
downloadSingleBtn.disabled = true;
clearError();











