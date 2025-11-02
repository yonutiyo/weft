// Sidebar: fixed overlay with variables, saves, and history controls

export async function attachSidebar(engine, inlineOptions = {}) {
  // Load config
  let fileConfig = {};
  try { const mod = await import("./sidebar.config.js"); if (mod?.default) fileConfig = mod.default; } catch {}

  const cfg = {
    title: "Journal",
    items: [],
    when: "",
    width: 280,
    rail: 52,
    ...fileConfig,
    ...inlineOptions
  };

  // Persisted prefs
  const PREF_THEME = "ui.theme";
  const PREF_FONT  = "ui.font";
  const PREF_COLL  = "ui.sidebarCollapsed";
  const PREF_SKIN  = "ui.skin";

  const load = (k,d)=>{ try{const v=localStorage.getItem(k); return v==null?d:v;}catch{return d;} };
  const save = (k,v)=>{ try{localStorage.setItem(k,v);}catch{} };

  let theme = load(PREF_THEME, "light");
  let font  = load(PREF_FONT,  "system");
  let skin  = load(PREF_SKIN,  "classic");
  let collapsed = load(PREF_COLL, "0")==="1";

  function fontCSS(f){
    if (f==="serif") return 'Georgia, "Times New Roman", serif';
    if (f==="mono")  return 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
    if (f==="verdana") return 'Verdana, Geneva, Tahoma, sans-serif';
    return 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  }
  function applyTheme(t){ theme=(t==="dark"?"dark":"light"); document.documentElement.setAttribute("data-theme",theme); save(PREF_THEME,theme); }
  function applyFont(f){ font=(["serif","mono","verdana"].includes(f)?f:"system"); document.documentElement.style.setProperty("--font-body", fontCSS(font)); save(PREF_FONT,font); }
  function applySkin(s){ skin=(["classic","solarized-light","solarized-dark","noir","terminal","paper"].includes(s)?s:"classic"); document.documentElement.setAttribute("data-skin", skin); save(PREF_SKIN, skin); }

  // Expression helpers
  const lit=(tok,st,id)=>{ const t=(tok||"").trim(); if(t==="true")return true; if(t==="false")return false;
    if(/^-?\d+(\.\d+)?$/.test(t))return Number(t); const m=t.match(/^'(.*)'$|^"(.*)"$/); if(m) return (m[1]??m[2]); if(t==="id")return id; return st[t]; };
  function ok(expr,st,id){ if(!expr)return true; const s=expr.trim(); if(s.startsWith("!"))return !ok(s.slice(1),st,id);
    let i=s.indexOf("!="); if(i!==-1) return lit(s.slice(0,i),st,id) != lit(s.slice(i+2),st,id);
    i=s.indexOf("=="); if(i!==-1)   return lit(s.slice(0,i),st,id) == lit(s.slice(i+2),st,id);
    return !!lit(s,st,id); }

  // Sidebar host
  const host = document.createElement("aside");
  Object.assign(host.style, {
    position: "fixed",
    top: "0", bottom: "0", left: "0",
    zIndex: 99998,
    width: (collapsed ? cfg.rail : cfg.width) + "px",
    pointerEvents: "auto"
  });
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode:"open" });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: var(--font-body); }
      .panel {
        width: 100%; height: 100%;
        background: var(--surface); color: var(--text);
        border-right: 1px solid var(--border);
        display: grid; grid-template-rows: auto 1fr;
        overflow: hidden;
      }
      .hdr { 
        display:flex; align-items:center; justify-content:space-between; 
        padding:10px 12px; border-bottom:1px solid var(--border);
        background: color-mix(in oklab, var(--surface), black 3%); 
      }
      .ttl { font-weight:700; font-size:14px; }
      .btn, .icon-btn {
        border: 1px solid var(--ctl-border); background: var(--ctl-bg); color: var(--ctl-text);
        padding: 6px 8px; border-radius: 0; cursor:pointer; box-shadow: var(--shadow-sm);
        font-size: 12px;
      }
      .btn:hover, .icon-btn:hover { background: var(--ctl-bg-hover); }
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .icon-btn { width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; padding:0; }
      
      .body { overflow-y: auto; overflow-x: hidden; }
      
      .tabs { 
        display: flex; 
        border-bottom: 1px solid var(--border);
        background: color-mix(in oklab, var(--surface), black 2%);
      }
      .tab { 
        flex: 1; 
        padding: 8px 4px; 
        border: none; 
        background: transparent; 
        color: var(--muted);
        cursor: pointer;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        border-bottom: 2px solid transparent;
      }
      .tab:hover { color: var(--text); }
      .tab.active { 
        color: var(--text); 
        font-weight: 600;
        border-bottom-color: var(--link); 
      }
      
      .tab-content { display: none; padding: 12px; }
      .tab-content.active { display: block; }
      
      .section { margin-bottom: 16px; }
      .section h4 { 
        margin: 0 0 8px 0; 
        font-size: 11px; 
        text-transform: uppercase; 
        letter-spacing: 0.04em; 
        color: var(--muted);
        cursor: pointer;
        user-select: none;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .section h4:hover { color: var(--text); }
      .section h4::before {
        content: '▼';
        font-size: 8px;
        transition: transform 0.2s;
      }
      .section.collapsed h4::before {
        transform: rotate(-90deg);
      }
      .section.collapsed .section-content {
        display: none;
      }
      
      .row { 
        display:flex; 
        justify-content:space-between; 
        align-items:center; 
        padding:6px 4px; 
        border-bottom:1px dashed var(--border); 
      }
      .lab { color: var(--muted); font-size:11px; }
      .val { font-weight:600; font-size:12px; }
      
      .history-controls {
        display: flex;
        gap: 4px;
        margin-bottom: 8px;
      }
      .history-controls .btn {
        flex: 1;
        padding: 8px 6px;
        font-size: 11px;
      }
      
      .save-slot {
        background: color-mix(in oklab, var(--surface), black 2%);
        border: 1px solid var(--border);
        padding: 6px 8px;
        margin-bottom: 4px;
        border-radius: 0;
        font-size: 11px;
      }
      .save-slot-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 3px;
      }
      .save-name {
        font-weight: 600;
        font-size: 11px;
      }
      .save-time {
        font-size: 9px;
        color: var(--muted);
      }
      .save-passage {
        font-size: 10px;
        color: var(--muted);
        margin-bottom: 4px;
      }
      .save-actions {
        display: flex;
        gap: 3px;
      }
      .save-actions .btn {
        flex: 1;
        padding: 3px 5px;
        font-size: 9px;
      }
      
      .save-form {
        display: flex;
        gap: 4px;
        margin-bottom: 12px;
      }
      .save-form input {
        flex: 1;
        padding: 6px 8px;
        border: 1px solid var(--ctl-border);
        background: var(--surface);
        color: var(--text);
        font-size: 11px;
      }
      
      .empty-state {
        text-align: center;
        color: var(--muted);
        font-size: 10px;
        padding: 12px 10px;
      }
      
      .muted { color: var(--muted); font-size:11px; padding:4px 0; }

      .rail {
        width:100%; height:100%; 
        background: var(--surface); color: var(--text);
        border-right:1px solid var(--border); 
        display:none; 
        flex-direction: column;
        align-items:center; 
        padding-top: 12px;
        gap: 8px;
      }
      .rail .rail-btn { 
        width:36px; height:36px; 
        border-radius:0; 
        border:1px solid var(--ctl-border);
        background: var(--ctl-bg); 
        color: var(--ctl-text); 
        display:flex; 
        align-items:center; 
        justify-content:center; 
        cursor:pointer; 
      }
      .rail .rail-btn:hover { background: var(--ctl-bg-hover); }

      .sr-only { position:absolute; left:-9999px; top:auto; width:1px; height:1px; overflow:hidden; }
    </style>

    <div class="panel" id="panel" aria-label="Sidebar">
      <div class="hdr">
        <div class="ttl" id="title">Game</div>
        <div style="display:flex; gap:6px;">
          <button class="icon-btn" id="settingsBtn" title="Settings" aria-label="Settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="display:block">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" stroke-width="2"/>
              <path d="M19.4 15a7.96 7.96 0 0 0 .1-2l2-1.2-2-3.4-2.2.6a8.2 8.2 0 0 0-1.7-1l-.3-2.3H11l-.3 2.3a8.2 8.2 0 0 0-1.7 1l-2.2-.6-2 3.4 2 1.2a8 8 0 0 0 0 2l-2 1.2 2 3.4 2.2-.6a8.2 8.2 0 0 0 1.7 1l.3 2.3h3.6l.3-2.3a8.2 8.2 0 0 0 1.7-1l2.2.6 2-3.4-2-1.2Z" stroke="currentColor" stroke-width="2"/>
            </svg>
          </button>
          <button class="btn" id="collapseBtn" aria-expanded="true">Hide</button>
        </div>
      </div>
      
      <div class="body">
        <div class="tabs">
          <button class="tab active" data-tab="stats">Stats</button>
          <button class="tab" data-tab="saves">Saves</button>
          <button class="tab" data-tab="history">History</button>
        </div>
        
        <!-- Stats Tab -->
        <div class="tab-content active" id="statsTab">
          <div class="section">
            <h4>Variables</h4>
            <div class="section-content">
              <div id="varsList"></div>
              <div class="muted" id="varsEmpty" style="display:none;">No variables visible.</div>
            </div>
          </div>
        </div>
        
        <!-- Saves Tab -->
        <div class="tab-content" id="savesTab">
          <div class="section">
            <h4>Quick Save</h4>
            <div class="section-content">
              <div class="save-form">
                <input type="text" id="saveNameInput" placeholder="Save name..." />
                <button class="btn" id="quickSaveBtn">Save</button>
              </div>
            </div>
          </div>
          
          <div class="section" id="savesSection">
            <h4>Saved Games (<span id="savesCount">0</span>)</h4>
            <div class="section-content">
              <div id="savesList"></div>
              <div class="empty-state" id="savesEmpty">No saved games yet</div>
            </div>
          </div>
          
          <div class="section" id="autoSavesSection">
            <h4>Auto-Saves (<span id="autoSavesCount">0</span>)</h4>
            <div class="section-content">
              <div id="autoSavesList"></div>
              <div class="empty-state" id="autoSavesEmpty">No auto-saves</div>
            </div>
          </div>
        </div>
        
        <!-- History Tab -->
        <div class="tab-content" id="historyTab">
          <div class="section">
            <h4>Undo/Redo</h4>
            <div class="section-content">
              <div class="history-controls">
                <button class="btn" id="undoBtn" disabled>Undo</button>
                <button class="btn" id="redoBtn" disabled>Redo</button>
              </div>
              <div class="muted" id="historyInfo">
                <div>Undo: <span id="undoCount">0</span> steps</div>
                <div>Redo: <span id="redoCount">0</span> steps</div>
                <div style="margin-top:8px;">
                  <button class="btn" id="clearHistoryBtn" style="width:100%;">Clear History</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="sr-only" id="live" aria-live="polite"></div>
    </div>

    <div class="rail" id="rail">
      <button class="rail-btn" id="expandBtn" aria-expanded="false" title="Expand sidebar">▶</button>
    </div>
  `;

  // Elements
  const panel = shadow.getElementById("panel");
  const rail = shadow.getElementById("rail");
  const collapseBtn = shadow.getElementById("collapseBtn");
  const expandBtn = shadow.getElementById("expandBtn");
  const settingsBtn = shadow.getElementById("settingsBtn");
  const titleEl = shadow.getElementById("title");
  const liveRegion = shadow.getElementById("live");
  
  // Tab elements
  const tabs = shadow.querySelectorAll(".tab");
  const tabContents = shadow.querySelectorAll(".tab-content");
  
  // Stats tab
  const varsList = shadow.getElementById("varsList");
  const varsEmpty = shadow.getElementById("varsEmpty");
  
  // Saves tab
  const saveNameInput = shadow.getElementById("saveNameInput");
  const quickSaveBtn = shadow.getElementById("quickSaveBtn");
  const savesList = shadow.getElementById("savesList");
  const savesEmpty = shadow.getElementById("savesEmpty");
  const savesCount = shadow.getElementById("savesCount");
  const autoSavesList = shadow.getElementById("autoSavesList");
  const autoSavesEmpty = shadow.getElementById("autoSavesEmpty");
  const autoSavesCount = shadow.getElementById("autoSavesCount");
  const savesSection = shadow.getElementById("savesSection");
  const autoSavesSection = shadow.getElementById("autoSavesSection");
  
  // History tab
  const undoBtn = shadow.getElementById("undoBtn");
  const redoBtn = shadow.getElementById("redoBtn");
  const clearHistoryBtn = shadow.getElementById("clearHistoryBtn");
  const undoCount = shadow.getElementById("undoCount");
  const redoCount = shadow.getElementById("redoCount");

  if (cfg.title) titleEl.textContent = cfg.title;

  // Collapsible sections
  shadow.querySelectorAll('.section h4').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.parentElement;
      section.classList.toggle('collapsed');
    });
  });

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener("click", async () => {
      const targetTab = tab.getAttribute("data-tab");
      tabs.forEach(t => t.classList.remove("active"));
      tabContents.forEach(tc => tc.classList.remove("active"));
      tab.classList.add("active");
      shadow.getElementById(`${targetTab}Tab`).classList.add("active");
      
      // Refresh content when switching tabs
      if (targetTab === "saves") await renderSaves();
      if (targetTab === "history") updateHistoryUI();
    });
  });

  function setCollapsed(next) {
    collapsed = !!next;
    const px = collapsed ? cfg.rail : cfg.width;
    host.style.width = px + "px";
    panel.style.display = collapsed ? "none" : "grid";
    rail.style.display  = collapsed ? "flex" : "none";
    collapseBtn.setAttribute("aria-expanded", String(!collapsed));
    expandBtn.setAttribute("aria-expanded", String(collapsed));
    save(PREF_COLL, collapsed ? "1" : "0");
  }
  
  collapseBtn.addEventListener("click", () => setCollapsed(true));
  expandBtn.addEventListener("click", () => setCollapsed(false));

  // Settings Modal
  const modalRoot = document.createElement("div");
  modalRoot.style.cssText = `position:fixed; inset:0; display:none; place-items:center; z-index:100001;`;
  modalRoot.innerHTML = `
    <style>
      .backdrop { position:absolute; inset:0; background: rgba(0,0,0,.45); }
      .window {
        position:relative; width:520px; max-width:92vw;
        background: var(--surface); color: var(--text);
        border:1px solid var(--border); border-radius:0; box-shadow: var(--shadow-lg); padding:16px 18px;
      }
      .w-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .w-title  { font-weight:700; }
      .btn { border:1px solid var(--ctl-border); background: var(--ctl-bg); color: var(--ctl-text);
             padding:6px 8px; border-radius:0; cursor:pointer; box-shadow: var(--shadow-sm); }
      .btn:hover { background: var(--ctl-bg-hover); }
      .row { display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px dashed var(--border); }
      .lab { color:#57606a; font-size:12px; }
      .switch { position:relative; width:42px; height:22px; }
      .switch input{ opacity:0; width:0; height:0; }
      .slider{ position:absolute; inset:0; background:#d1d5db; border-radius:999px; cursor:pointer; transition:.2s; }
      .slider:before{ content:""; position:absolute; height:18px; width:18px; left:2px; top:2px; background:#fff; border-radius:50%; transition:.2s; box-shadow: var(--shadow-sm); }
      html[data-theme="dark"] .slider{ background:#334155; }
      html[data-theme="dark"] .slider:before{ background:#cbd5e1; }
      .switch input:checked + .slider { background:#4f46e5; }
      .switch input:checked + .slider:before { transform: translateX(20px); }
      select { padding:6px 8px; border:1px solid var(--ctl-border); background: var(--surface); color: var(--text); border-radius:0; }
    </style>
    <div class="backdrop"></div>
    <div class="window" role="dialog" aria-modal="true" aria-labelledby="set-title">
      <div class="w-header">
        <div id="set-title" class="w-title">Settings</div>
        <button class="btn" id="closeSettings">Close</button>
      </div>
      <div class="row">
        <div class="lab">Theme</div>
        <label class="switch">
          <input id="themeToggle" type="checkbox" />
          <span class="slider"></span>
        </label>
      </div>
      <div class="row">
        <div class="lab">Skin</div>
        <select id="skinSelect">
          <option value="classic">Classic</option>
          <option value="solarized-light">Solarized Light</option>
          <option value="solarized-dark">Solarized Dark</option>
          <option value="noir">Noir</option>
          <option value="terminal">Terminal</option>
          <option value="paper">Paper</option>
        </select>
      </div>
      <div class="row">
        <div class="lab">Font</div>
        <select id="fontSelect">
          <option value="system">System (Sans)</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospace</option>
          <option value="verdana">Verdana</option>
        </select>
      </div>
    </div>
  `;
  document.body.appendChild(modalRoot);
  
  const modalWindow = modalRoot.querySelector(".window");
  const closeSettings = modalRoot.querySelector("#closeSettings");
  const themeToggleEl = modalRoot.querySelector("#themeToggle");
  const fontSelectEl  = modalRoot.querySelector("#fontSelect");
  const skinSelectEl  = modalRoot.querySelector("#skinSelect");

  let lastFocused = null;
  let modalKeydownHandler = null;

  function openSettings() {
    themeToggleEl.checked = (theme === "dark");
    fontSelectEl.value = font;
    skinSelectEl.value = skin;
    const sw = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (sw > 0) document.body.style.paddingRight = sw + "px";
    modalRoot.style.display = "grid";
    lastFocused = document.activeElement;
    const focusables = modalWindow.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    modalKeydownHandler = (e) => {
      if (e.key === "Tab") {
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      } else if (e.key === "Escape") { e.preventDefault(); closeSettingsModal(); }
    };
    window.addEventListener("keydown", modalKeydownHandler);
    (first || closeSettings).focus();
  }

  function closeSettingsModal() {
    modalRoot.style.display = "none";
    window.removeEventListener("keydown", modalKeydownHandler);
    modalKeydownHandler = null;
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
    (settingsBtn || lastFocused)?.focus();
  }

  closeSettings.addEventListener("click", closeSettingsModal);
  settingsBtn.addEventListener("click", openSettings);
  themeToggleEl.addEventListener("change", ()=> applyTheme(themeToggleEl.checked ? "dark" : "light"));
  fontSelectEl.addEventListener("change",  ()=> applyFont(fontSelectEl.value));
  skinSelectEl.addEventListener("change",  ()=> applySkin(skinSelectEl.value));

  // Variable rendering
  function fmt(val, f){ 
    if(f==="boolYesNo")return val?"Yes":"No"; 
    if(f==="boolOnOff")return val?"On":"Off"; 
    if(f==="boolIcon")return val?"●":"○"; 
    return val==null?"":String(val); 
  }
  
  function renderVars(){
    const id = engine.current;
    const st = engine.getState();
    if (!ok(cfg.when, st, id)) { host.style.display="none"; return; } 
    else { host.style.display="block"; }
    
    varsList.innerHTML = "";
    let shown = 0;
    for(const it of (cfg.items||[])){
      if(!ok(it.when || "", st, id)) continue;
      const row = document.createElement("div");
      row.className = "row";
      const lab = document.createElement("div");
      lab.className = "lab";
      lab.textContent = it.label ?? it.key;
      const val = document.createElement("div");
      val.className = "val";
      val.textContent = fmt(st[it.key], it.format);
      row.append(lab, val);
      varsList.append(row);
      shown++;
    }
    varsEmpty.style.display = shown ? "none" : "block";
  }

  // Save/Load functionality
  let saveManager = null;
  
  // Try to import SaveManager
  (async () => {
    try {
      const mod = await import("./save-manager.js");
      saveManager = new mod.SaveManager(engine, {
        storagePrefix: 'if-save',
        maxSlots: 10,
        maxAutoSaves: 3,
        autoSave: true
      });
      await renderSaves();
    } catch (e) {
      console.warn("[sidebar] SaveManager not available:", e);
      savesEmpty.textContent = "Save system not available";
    }
  })();

  function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    }
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  async function renderSaves() {
    if (!saveManager) return;
    
    const saves = await saveManager.getAllSaves();
    const autoSaves = await saveManager.getAutoSaves();
    
    // Update counts
    savesCount.textContent = saves.length;
    autoSavesCount.textContent = autoSaves.length;
    
    // Render manual saves
    savesList.innerHTML = "";
    if (saves.length === 0) {
      savesEmpty.style.display = "block";
      savesList.style.display = "none";
    } else {
      savesEmpty.style.display = "none";
      savesList.style.display = "block";
      
      saves.forEach(save => {
        const slot = document.createElement("div");
        slot.className = "save-slot";
        slot.innerHTML = `
          <div class="save-slot-header">
            <div class="save-name">${save.slot}</div>
            <div class="save-time">${formatTimestamp(save.timestamp)}</div>
          </div>
          <div class="save-passage">@ ${save.passage}</div>
          <div class="save-actions">
            <button class="btn" data-action="load" data-slot="${save.slot}">Load</button>
            <button class="btn" data-action="delete" data-slot="${save.slot}">Delete</button>
          </div>
        `;
        savesList.appendChild(slot);
      });
    }
    
    // Render auto-saves
    autoSavesList.innerHTML = "";
    if (autoSaves.length === 0) {
      autoSavesEmpty.style.display = "block";
      autoSavesList.style.display = "none";
    } else {
      autoSavesEmpty.style.display = "none";
      autoSavesList.style.display = "block";
      
      autoSaves.forEach(save => {
        const slot = document.createElement("div");
        slot.className = "save-slot";
        slot.innerHTML = `
          <div class="save-slot-header">
            <div class="save-name">${save.slot}</div>
            <div class="save-time">${formatTimestamp(save.timestamp)}</div>
          </div>
          <div class="save-passage">@ ${save.passage}</div>
          <div class="save-actions">
            <button class="btn" data-action="load" data-slot="${save.slot}">Load</button>
          </div>
        `;
        autoSavesList.appendChild(slot);
      });
    }
  }

  // Save button
  quickSaveBtn.addEventListener("click", async () => {
    if (!saveManager) return;
    const name = saveNameInput.value.trim() || `save-${Date.now()}`;
    const result = await saveManager.save(name);
    if (result.success) {
      saveNameInput.value = "";
      await renderSaves();
      liveRegion.textContent = `Saved to ${name}`;
    } else {
      alert(`Save failed: ${result.error}`);
    }
  });

  // Save actions delegation
  savesList.addEventListener("click", async (e) => {
    if (!saveManager) return;
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    
    const action = btn.getAttribute("data-action");
    const slot = btn.getAttribute("data-slot");
    
    if (action === "load") {
      if (confirm(`Load save "${slot}"? Current progress will be lost.`)) {
        const result = await saveManager.load(slot);
        if (result.success) {
          liveRegion.textContent = `Loaded ${slot}`;
        } else {
          alert(`Load failed: ${result.error}`);
        }
      }
    } else if (action === "delete") {
      if (confirm(`Delete save "${slot}"?`)) {
        saveManager.delete(slot);
        await renderSaves();
        liveRegion.textContent = `Deleted ${slot}`;
      }
    }
  });

  autoSavesList.addEventListener("click", async (e) => {
    if (!saveManager) return;
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    
    const action = btn.getAttribute("data-action");
    const slot = btn.getAttribute("data-slot");
    
    if (action === "load") {
      if (confirm(`Load auto-save "${slot}"? Current progress will be lost.`)) {
        const result = await saveManager.load(slot);
        if (result.success) {
          liveRegion.textContent = `Loaded ${slot}`;
        } else {
          alert(`Load failed: ${result.error}`);
        }
      }
    }
  });

  // History controls
  function updateHistoryUI() {
    const canUndoNow = engine.canUndo();
    const canRedoNow = engine.canRedo();
    
    undoBtn.disabled = !canUndoNow;
    redoBtn.disabled = !canRedoNow;
    undoCount.textContent = engine.historyLength || 0;
    redoCount.textContent = engine.redoLength || 0;
  }

  undoBtn.addEventListener("click", () => {
    if (engine.undo()) {
      liveRegion.textContent = "Undone";
    }
  });

  redoBtn.addEventListener("click", () => {
    if (engine.redo()) {
      liveRegion.textContent = "Redone";
    }
  });

  clearHistoryBtn.addEventListener("click", () => {
    if (confirm("Clear all undo/redo history?")) {
      engine.clearHistory();
      liveRegion.textContent = "History cleared";
    }
  });

  // Listen to engine events
  engine.on("render", () => {
    renderVars();
  });
  
  engine.on("stateChange", () => {
    renderVars();
  });
  
  engine.on("historyChange", () => {
    updateHistoryUI();
  });
  
  engine.on("undo", updateHistoryUI);
  engine.on("redo", updateHistoryUI);

  // Keyboard shortcuts for undo/redo
  window.addEventListener("keydown", (e) => {
    // Ctrl+Z / Cmd+Z for undo
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      if (engine.canUndo()) {
        engine.undo();
      }
    }
    // Ctrl+Shift+Z / Cmd+Shift+Z for redo
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
      e.preventDefault();
      if (engine.canRedo()) {
        engine.redo();
      }
    }
    // Ctrl+Y / Cmd+Y for redo (alternative)
    if ((e.ctrlKey || e.metaKey) && e.key === "y") {
      e.preventDefault();
      if (engine.canRedo()) {
        engine.redo();
      }
    }
  });

  // Init
  applyTheme(theme);
  applyFont(font);
  applySkin(skin);
  setCollapsed(collapsed);
  setTimeout(() => {
    renderVars();
    updateHistoryUI();
  }, 0);
}
