// debug-overlay.js - Properly optimized with efficient DOM operations
export function attachDebugOverlay(engine, {
  hotkey = "`",
  startOpen = false,
} = {}) {
  const host = document.createElement("div");
  Object.assign(host.style, { position:"fixed", right:"12px", bottom:"12px", zIndex: 99999 });
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode:"open" });
  
  // Performance tracking state
  const perfStats = {
    frameCount: 0,
    lastFrameTime: performance.now(),
    fps: 60,
    renderTimes: [],
    renderCount: 0,
    avgRenderTime: 0,
    maxRenderTime: 0,
    minRenderTime: Infinity,
    memorySnapshots: [],
    stateChangeCount: 0,
    gotoCount: 0,
    startTime: performance.now(),
    lastUpdate: performance.now()
  };
  
  // Console tracking
  const consoleLogs = [];
  const MAX_CONSOLE_LOGS = 100;
  let consoleFilter = 'all';
  
  // Cache tracking
  const cacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    lastUpdate: Date.now()
  };
  
  // Performance marks and lanes tracking
  const perfMarks = [];
  const lanes = {
    navigation: [],
    render: [],
    state: [],
    cache: [],
    timer: []
  };
  const MAX_MARKS = 100;
  
  // Expression profiler tracking
  const exprProfiler = {
    expressions: new Map(),
    sortedCache: null, // Cache sorted results
    dirty: false
  };
  
  // Invalidation tracking
  const invalidationTracker = {
    matrix: new Map(),
    navLog: [],
    maxNavLog: 20,
    totalInvalidations: 0,
    matrixCache: null, // Cache sorted matrix
    dirty: false
  };
  
  // Track active tab for conditional rendering
  let activeTab = 'diagnostics';
  let panelOpen = false;
  
  let perfInterval = null;
  let rafId = null;
  let stateUpdateTimer = null;
  let stateSearchQuery = '';
  
  const STATE_UPDATE_THROTTLE = 300;
  const LINK_UPDATE_THROTTLE = 200;
  
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: var(--font-body); }
      .panel {
        width: 480px; max-height: 85vh; overflow: hidden;
        background: var(--surface); color: var(--text);
        border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-lg);
        display: none; flex-direction: column;
      }
      .panel.open { display: flex; }
      
      /* Tab System - Fixed scrollbar hiding */
      .tabs {
        display: flex; border-bottom: 1px solid var(--border);
        background: color-mix(in oklab, var(--surface), black 2%);
        overflow-x: auto; overflow-y: hidden;
        /* Completely hide scrollbar */
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
      .tabs::-webkit-scrollbar { 
        display: none;
        width: 0;
        height: 0;
      }
      
      .tab {
        flex: 0 0 auto; padding: 10px 16px; text-align: center; cursor: pointer;
        border-bottom: 3px solid transparent;
        font-weight: 500; font-size: 11px; transition: border-color 0.15s ease;
        white-space: nowrap; user-select: none;
      }
      .tab:hover { 
        background: color-mix(in oklab, var(--surface), black 4%);
        border-bottom-color: color-mix(in oklab, var(--accent, #3b82f6), transparent 60%);
      }
      .tab.active {
        border-bottom-color: var(--accent, #3b82f6);
        background: var(--surface);
        color: var(--accent, #3b82f6);
      }
      
      .tab-content {
        display: none; padding: 12px; overflow-y: auto; flex: 1;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in oklab, var(--muted), transparent 40%) transparent;
      }
      .tab-content.active { display: block; }
      
      /* Minimal scrollbar styling */
      .tab-content::-webkit-scrollbar { width: 5px; }
      .tab-content::-webkit-scrollbar-track { background: transparent; }
      .tab-content::-webkit-scrollbar-thumb { 
        background: color-mix(in oklab, var(--muted), transparent 50%);
        border-radius: 3px;
      }
      .tab-content::-webkit-scrollbar-thumb:hover { 
        background: color-mix(in oklab, var(--muted), transparent 20%);
      }
      
      .row { display:flex; gap:8px; align-items:center; margin: 6px 0; }
      .k { color: var(--muted); width: 110px; font-size: 13px; flex-shrink: 0; }
      .v { font-weight: 600; font-size: 13px; }
      .sec { margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 12px; }
      .links { display: grid; gap: 6px; margin-top: 8px; }
      .pill {
        display:inline-flex; align-items:center; gap:6px; padding:6px 8px;
        border:1px solid var(--ctl-border); background: var(--ctl-bg); color: var(--ctl-text);
        border-radius: 0; cursor:pointer; font-size: 12px; transition: background 0.12s;
      }
      .pill:hover { background: var(--ctl-bg-hover); }
      input[type="text"], input[type="search"] {
        flex: 1; padding: 8px; border: 1px solid var(--ctl-border); background: var(--surface); color: var(--text);
        border-radius: 0; font-size: 13px;
      }
      .json {
        white-space: pre-wrap; background: color-mix(in oklab, var(--surface), black 4%);
        border: 1px solid var(--border); border-radius: 0; padding: 8px; font-size: 11px;
        max-height: 200px; overflow: auto; font-family: monospace;
      }
      .header { 
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 12px; border-bottom: 1px solid var(--border);
      }
      .title { font-weight: 700; font-size: 14px; }
      .btn { 
        border: 1px solid var(--ctl-border); background: var(--ctl-bg); color: var(--ctl-text); 
        padding:6px 10px; cursor:pointer; border-radius: 0; font-size: 12px; font-weight: 500;
        transition: background 0.12s;
      }
      .btn:hover { background: var(--ctl-bg-hover); }
      .btn:active { transform: scale(0.98); }
      .btn-sm { padding: 4px 8px; font-size: 11px; }
      
      /* Performance Stats */
      .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px; }
      .stat-grid-3 { grid-template-columns: repeat(3, 1fr); }
      .stat-card {
        background: color-mix(in oklab, var(--surface), black 3%);
        border: 1px solid var(--border); padding: 10px; border-radius: 0;
      }
      .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; margin-bottom: 4px; }
      .stat-value { font-size: 20px; font-weight: 700; line-height: 1.2; }
      .stat-unit { font-size: 11px; color: var(--muted); margin-left: 3px; }
      
      .stat-bar {
        height: 6px; background: color-mix(in oklab, var(--surface), black 8%);
        border-radius: 3px; overflow: hidden; margin-top: 6px;
      }
      .stat-bar-fill { 
        height: 100%; background: var(--accent, #3b82f6); 
        transition: width 0.25s ease-out;
        will-change: width;
      }
      
      .perf-good { color: #22c55e; }
      .perf-ok { color: #f59e0b; }
      .perf-poor { color: #ef4444; }
      
      .metric-list { display: flex; flex-direction: column; gap: 6px; }
      .metric-row { display: flex; justify-content: space-between; font-size: 12px; padding: 4px 0; }
      .metric-label { color: var(--muted); }
      .metric-value { font-weight: 600; }
      
      /* Console Styles */
      .console-output {
        background: color-mix(in oklab, var(--surface), black 6%); border: 1px solid var(--border);
        padding: 8px; font-size: 11px; max-height: 400px; overflow-y: auto; font-family: monospace;
        border-radius: 0;
      }
      .console-line {
        padding: 4px 0; border-bottom: 1px solid color-mix(in oklab, var(--surface), black 8%);
        display: flex; gap: 8px; align-items: flex-start;
      }
      .console-line:last-child { border-bottom: none; }
      .console-time { color: var(--muted); font-size: 10px; flex-shrink: 0; width: 65px; }
      .console-msg { flex: 1; word-break: break-word; }
      .console-log { color: var(--text); }
      .console-warn { color: #f59e0b; }
      .console-error { color: #ef4444; }
      .console-info { color: #3b82f6; }
      
      .console-filters { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
      .filter-btn {
        padding: 4px 10px; font-size: 11px; border: 1px solid var(--ctl-border);
        background: var(--ctl-bg); color: var(--ctl-text); cursor: pointer;
        border-radius: 0; transition: all 0.12s;
      }
      .filter-btn.active {
        background: var(--accent, #3b82f6); color: white; border-color: var(--accent, #3b82f6);
      }
      .filter-btn:hover { background: var(--ctl-bg-hover); }
      .filter-btn.active:hover { opacity: 0.9; }
      
      .console-badge {
        background: var(--muted); color: var(--surface); padding: 2px 6px;
        border-radius: 10px; font-size: 10px; font-weight: 600; margin-left: 4px;
      }
      
      /* Search Highlighting */
      .search-highlight { background: rgba(255, 255, 0, 0.3); padding: 0 2px; border-radius: 2px; }
      
      /* Cache Stats */
      .cache-metric {
        background: color-mix(in oklab, var(--surface), black 3%); border: 1px solid var(--border);
        padding: 12px; border-radius: 0; margin-bottom: 8px;
      }
      .cache-metric-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
      .cache-metric-value { font-size: 24px; font-weight: 700; }
      .cache-hit-rate {
        display: flex; justify-content: space-between; align-items: center;
        margin-top: 8px; font-size: 13px;
      }
      
      .progress-ring { width: 80px; height: 80px; }
      .progress-ring-circle {
        transition: stroke-dashoffset 0.25s ease-out;
        transform: rotate(-90deg); transform-origin: 50% 50%;
        will-change: stroke-dashoffset;
      }
      
      /* Timeline Styles - Optimized */
      .timeline-viz {
        background: color-mix(in oklab, var(--surface), black 5%); border: 1px solid var(--border);
        padding: 12px; border-radius: 0; margin-bottom: 12px; min-height: 200px;
        max-height: 300px; overflow: auto;
      }
      .lane {
        margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border);
      }
      .lane:last-child { border-bottom: none; }
      .lane-label {
        font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 4px;
      }
      .lane-events {
        display: flex; gap: 2px; flex-wrap: wrap; align-items: center;
      }
      .event-mark {
        display: inline-block; padding: 2px 6px; font-size: 10px;
        background: var(--accent, #3b82f6); color: white; border-radius: 2px;
        cursor: pointer; transition: opacity 0.1s;
      }
      .event-mark:hover { opacity: 0.8; }
      .event-mark.nav { background: #8b5cf6; }
      .event-mark.render { background: #3b82f6; }
      .event-mark.state { background: #10b981; }
      .event-mark.cache { background: #f59e0b; }
      .event-mark.timer { background: #ef4444; }
      
      /* Expression Profiler Styles - Optimized */
      .expr-table {
        width: 100%; border-collapse: collapse; font-size: 11px;
      }
      .expr-table th {
        text-align: left; padding: 6px;
        background: color-mix(in oklab, var(--surface), black 5%);
        border-bottom: 2px solid var(--border); font-weight: 600;
        font-size: 10px; color: var(--muted); text-transform: uppercase;
        position: sticky; top: 0; z-index: 1;
      }
      .expr-table td {
        padding: 6px; border-bottom: 1px solid var(--border);
      }
      .expr-table tbody tr:hover { background: color-mix(in oklab, var(--surface), black 3%); }
      .expr-code {
        font-family: monospace; max-width: 180px; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      
      /* Invalidation Matrix Styles - Optimized */
      .inv-matrix {
        background: color-mix(in oklab, var(--surface), black 5%); border: 1px solid var(--border);
        padding: 12px; border-radius: 0; margin-bottom: 12px; max-height: 300px; overflow: auto;
      }
      .inv-row {
        display: flex; align-items: center; gap: 8px; padding: 4px 0;
        border-bottom: 1px solid color-mix(in oklab, var(--surface), black 8%);
        font-size: 11px;
      }
      .inv-path {
        font-family: monospace; color: var(--accent, #3b82f6);
        flex: 0 0 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .inv-keys {
        flex: 1; color: var(--muted); font-size: 10px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .inv-count { flex: 0 0 40px; text-align: right; font-weight: 600; }
      
      .nav-log-entry {
        background: color-mix(in oklab, var(--surface), black 3%); border: 1px solid var(--border);
        padding: 8px; margin-bottom: 8px; border-radius: 0;
      }
      .nav-log-header {
        display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 11px;
      }
      .nav-log-time { color: var(--muted); }
      .nav-log-nav { font-weight: 600; color: var(--accent, #3b82f6); }
      .nav-log-invs { font-size: 10px; color: var(--muted); padding-left: 8px; }
      
      .muted { color: var(--muted); font-size: 12px; }
      .text-center { text-align: center; }
      
      /* Improved scrollbar for all scrollable areas */
      *::-webkit-scrollbar { width: 5px; height: 5px; }
      *::-webkit-scrollbar-track { background: transparent; }
      *::-webkit-scrollbar-thumb { 
        background: color-mix(in oklab, var(--muted), transparent 50%);
        border-radius: 3px;
      }
      *::-webkit-scrollbar-thumb:hover { 
        background: color-mix(in oklab, var(--muted), transparent 20%);
      }
    </style>

    <div class="panel" id="panel">
      <div class="header">
        <div class="title">🔧 Debug Overlay</div>
        <button class="btn" id="hideBtn">Hide</button>
      </div>
      
      <div class="tabs">
        <div class="tab active" data-tab="diagnostics">Diagnostics</div>
        <div class="tab" data-tab="performance">Performance</div>
        <div class="tab" data-tab="timeline">Timeline</div>
        <div class="tab" data-tab="expressions">Expressions</div>
        <div class="tab" data-tab="invalidation">Invalidation</div>
        <div class="tab" data-tab="console">Console</div>
        <div class="tab" data-tab="cache">Cache</div>
      </div>
      
      <!-- Tab 1: Diagnostics -->
      <div class="tab-content active" id="tab-diagnostics">
        <div class="row">
          <div class="k">Passage</div>
          <div class="v" id="curId">—</div>
        </div>
        
        <div class="row">
          <div class="k">Uptime</div>
          <div class="v" id="uptime">0s</div>
        </div>

        <div class="sec">
          <div class="row">
            <input type="text" id="jumpInput" placeholder="jump to id (e.g. start)" />
            <button class="btn" id="jumpBtn">Jump</button>
          </div>
        </div>

        <div class="sec">
          <div class="row" style="justify-content: space-between;">
            <div class="title" style="font-size:13px;">Outgoing Links</div>
            <button class="btn btn-sm" id="refreshBtn" title="Refresh links">↻</button>
          </div>
          <div class="links" id="links"></div>
        </div>

        <div class="sec">
          <div class="row" style="justify-content: space-between;">
            <div class="title" style="font-size:13px;">State</div>
            <div>
              <button class="btn btn-sm" id="copyBtn">Copy</button>
            </div>
          </div>
          <div class="row">
            <input type="search" id="stateSearchInput" placeholder="Search state..." />
          </div>
          <div class="json" id="stateJson">{}</div>
        </div>
      </div>
      
      <!-- Tab 2: Performance -->
      <div class="tab-content" id="tab-performance">
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-label">FPS</div>
            <div class="stat-value" id="fpsValue">60</div>
            <div class="stat-bar">
              <div class="stat-bar-fill" id="fpsBar" style="width: 100%;"></div>
            </div>
          </div>
          
          <div class="stat-card">
            <div class="stat-label">Avg Render</div>
            <div class="stat-value" id="renderTime">0<span class="stat-unit">ms</span></div>
          </div>
          
          <div class="stat-card">
            <div class="stat-label">Memory</div>
            <div class="stat-value" id="memValue">0<span class="stat-unit">MB</span></div>
          </div>
          
          <div class="stat-card">
            <div class="stat-label">Total Renders</div>
            <div class="stat-value" id="renderCount">0</div>
          </div>
        </div>
        
        <div class="stat-grid stat-grid-3">
          <div class="stat-card">
            <div class="stat-label">Min</div>
            <div class="stat-value" id="minRender" style="font-size: 16px;">0<span class="stat-unit">ms</span></div>
          </div>
          
          <div class="stat-card">
            <div class="stat-label">Max</div>
            <div class="stat-value" id="maxRender" style="font-size: 16px;">0<span class="stat-unit">ms</span></div>
          </div>
          
          <div class="stat-card">
            <div class="stat-label">Last</div>
            <div class="stat-value" id="lastRender" style="font-size: 16px;">0<span class="stat-unit">ms</span></div>
          </div>
        </div>
        
        <div class="sec">
          <div class="title" style="font-size:13px; margin-bottom: 8px;">Engine Metrics</div>
          <div class="metric-list">
            <div class="metric-row">
              <span class="metric-label">State Changes</span>
              <span class="metric-value" id="stateChanges">0</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Goto Calls</span>
              <span class="metric-value" id="gotoCount">0</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Current Passage</span>
              <span class="metric-value" id="perfPassage">—</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Session Time</span>
              <span class="metric-value" id="sessionTime">0s</span>
            </div>
          </div>
        </div>
        
        <div class="sec">
          <div class="row" style="justify-content: space-between;">
            <div class="title" style="font-size:13px;">Actions</div>
          </div>
          <div class="row">
            <button class="btn" id="resetStatsBtn" style="flex: 1;">Reset Stats</button>
            <button class="btn" id="gcBtn" style="flex: 1;">🗑️ Clear Cache</button>
          </div>
        </div>
      </div>
      
      <!-- Tab 3: Timeline -->
      <div class="tab-content" id="tab-timeline">
        <div class="sec">
          <div class="row" style="justify-content: space-between;">
            <div class="title" style="font-size:13px;">Performance Timeline</div>
            <div>
              <button class="btn btn-sm" id="exportTimelineBtn">Export Timeline</button>
              <button class="btn btn-sm" id="exportTraceBtn">Export Trace JSON</button>
              <button class="btn btn-sm" id="clearMarksBtn">Clear</button>
            </div>
          </div>
          
          <div class="muted" style="margin: 8px 0;">
            Marks: <span id="marksCount">0</span>
          </div>
          
          <div class="timeline-viz" id="timelineViz">
            <div class="lane">
              <div class="lane-label">⚡ Navigation</div>
              <div class="lane-events" id="lane-navigation"><span class="muted" style="font-size: 10px;">No events</span></div>
            </div>
            <div class="lane">
              <div class="lane-label">🎨 Render</div>
              <div class="lane-events" id="lane-render"><span class="muted" style="font-size: 10px;">No events</span></div>
            </div>
            <div class="lane">
              <div class="lane-label">📊 State</div>
              <div class="lane-events" id="lane-state"><span class="muted" style="font-size: 10px;">No events</span></div>
            </div>
            <div class="lane">
              <div class="lane-label">💾 Cache</div>
              <div class="lane-events" id="lane-cache"><span class="muted" style="font-size: 10px;">No events</span></div>
            </div>
            <div class="lane">
              <div class="lane-label">⏱️ Timer</div>
              <div class="lane-events" id="lane-timer"><span class="muted" style="font-size: 10px;">No events</span></div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Tab 4: Expressions -->
      <div class="tab-content" id="tab-expressions">
        <div class="sec">
          <div class="row" style="justify-content: space-between;">
            <div class="title" style="font-size:13px;">Expression Performance</div>
            <button class="btn btn-sm" id="clearExprBtn">Clear Stats</button>
          </div>
          
          <div class="stat-grid stat-grid-3" style="margin-top: 12px;">
            <div class="stat-card">
              <div class="stat-label">Total Evals</div>
              <div class="stat-value" id="totalEvals">0</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Unique Exprs</div>
              <div class="stat-value" id="uniqueExprs">0</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Avg Time</div>
              <div class="stat-value" id="avgExprTime">0<span class="stat-unit">ms</span></div>
            </div>
          </div>
          
          <div style="margin-top: 12px; max-height: 350px; overflow: auto;">
            <table class="expr-table">
              <thead>
                <tr>
                  <th>Expression</th>
                  <th style="text-align: right;">Hit Rate</th>
                  <th style="text-align: right;">Evals</th>
                  <th style="text-align: right;">Avg Time</th>
                  <th style="text-align: right;">Evictions</th>
                </tr>
              </thead>
              <tbody id="exprTableBody">
                <tr><td colspan="5" class="text-center muted">No data yet</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <!-- Tab 5: Invalidation -->
      <div class="tab-content" id="tab-invalidation">
        <div class="sec">
          <div class="row" style="justify-content: space-between;">
            <div class="title" style="font-size:13px;">Invalidation Matrix</div>
            <button class="btn btn-sm" id="clearInvBtn">Clear</button>
          </div>
          
          <div class="muted" style="margin: 8px 0;">
            Total Invalidations: <span id="totalInvalidations">0</span> |
            Tracked Paths: <span id="trackedPaths">0</span>
          </div>
          
          <div class="inv-matrix" id="invMatrix">
            <div class="text-center muted">No invalidations recorded yet</div>
          </div>
        </div>
        
        <div class="sec">
          <div class="title" style="font-size:13px; margin-bottom: 8px;">Per-Navigation Log</div>
          <div style="max-height: 200px; overflow: auto;" id="navLog">
            <div class="text-center muted">No navigations yet</div>
          </div>
        </div>
      </div>
      
      <!-- Tab 6: Console -->
      <div class="tab-content" id="tab-console">
        <div class="console-filters">
          <button class="filter-btn active" data-filter="all">
            All <span class="console-badge" id="badge-all">0</span>
          </button>
          <button class="filter-btn" data-filter="log">
            Log <span class="console-badge" id="badge-log">0</span>
          </button>
          <button class="filter-btn" data-filter="info">
            Info <span class="console-badge" id="badge-info">0</span>
          </button>
          <button class="filter-btn" data-filter="warn">
            Warn <span class="console-badge" id="badge-warn">0</span>
          </button>
          <button class="filter-btn" data-filter="error">
            Error <span class="console-badge" id="badge-error">0</span>
          </button>
        </div>
        
        <div class="row" style="margin-bottom: 8px;">
          <button class="btn btn-sm" id="clearConsoleBtn">Clear</button>
          <button class="btn btn-sm" id="exportConsoleBtn">Export</button>
        </div>
        
        <div class="console-output" id="consoleOutput">
          <div class="text-center muted">No console output yet</div>
        </div>
      </div>
      
      <!-- Tab 7: Cache -->
      <div class="tab-content" id="tab-cache">
        <div class="row" style="justify-content: center; margin-bottom: 16px;">
          <svg class="progress-ring" viewBox="0 0 80 80">
            <circle
              class="progress-ring-circle"
              stroke="color-mix(in oklab, var(--surface), black 10%)"
              stroke-width="6"
              fill="transparent"
              r="34"
              cx="40"
              cy="40"
            />
            <circle
              id="hitRateCircle"
              class="progress-ring-circle"
              stroke="var(--accent, #3b82f6)"
              stroke-width="6"
              fill="transparent"
              r="34"
              cx="40"
              cy="40"
              stroke-dasharray="213.628"
              stroke-dashoffset="213.628"
              stroke-linecap="round"
            />
          </svg>
        </div>
        
        <div class="cache-metric">
          <div class="cache-metric-label">Cache Hit Rate</div>
          <div class="cache-metric-value" id="hitRate">0<span class="stat-unit">%</span></div>
        </div>
        
        <div class="stat-grid stat-grid-3">
          <div class="stat-card">
            <div class="stat-label">Hits</div>
            <div class="stat-value" style="font-size: 18px;" id="cacheHits">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Misses</div>
            <div class="stat-value" style="font-size: 18px;" id="cacheMisses">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Size</div>
            <div class="stat-value" style="font-size: 18px;" id="cacheSize">0</div>
          </div>
        </div>
        
        <div class="sec">
          <div class="metric-list">
            <div class="metric-row">
              <span class="metric-label">Total Requests</span>
              <span class="metric-value" id="totalRequests">0</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Efficiency</span>
              <span class="metric-value" id="cacheEfficiency">N/A</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Avg Lookup</span>
              <span class="metric-value" id="avgLookupTime">—</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Last Cleared</span>
              <span class="metric-value" id="lastCleared">Never</span>
            </div>
          </div>
        </div>
        
        <div class="sec">
          <button class="btn" id="clearCacheBtn" style="width: 100%;">Clear All Caches</button>
        </div>
      </div>
    </div>
  `;

  // ============================================================================
  // DOM REFERENCES - Cached for performance
  // ============================================================================
  
  const panel = shadow.getElementById("panel");
  const hideBtn = shadow.getElementById("hideBtn");
  const tabs = shadow.querySelectorAll(".tab");
  const tabContents = shadow.querySelectorAll(".tab-content");
  
  const curIdEl = shadow.getElementById("curId");
  const uptimeEl = shadow.getElementById("uptime");
  const linksEl = shadow.getElementById("links");
  const stateJsonEl = shadow.getElementById("stateJson");
  const jumpBtn = shadow.getElementById("jumpBtn");
  const jumpInput = shadow.getElementById("jumpInput");
  const copyBtn = shadow.getElementById("copyBtn");
  const refreshBtn = shadow.getElementById("refreshBtn");
  const stateSearchInput = shadow.getElementById("stateSearchInput");
  
  const fpsValueEl = shadow.getElementById("fpsValue");
  const fpsBarEl = shadow.getElementById("fpsBar");
  const renderTimeEl = shadow.getElementById("renderTime");
  const memValueEl = shadow.getElementById("memValue");
  const renderCountEl = shadow.getElementById("renderCount");
  const minRenderEl = shadow.getElementById("minRender");
  const maxRenderEl = shadow.getElementById("maxRender");
  const lastRenderEl = shadow.getElementById("lastRender");
  const stateChangesEl = shadow.getElementById("stateChanges");
  const gotoCountEl = shadow.getElementById("gotoCount");
  const perfPassageEl = shadow.getElementById("perfPassage");
  const sessionTimeEl = shadow.getElementById("sessionTime");
  const resetStatsBtn = shadow.getElementById("resetStatsBtn");
  const gcBtn = shadow.getElementById("gcBtn");
  
  const exportTimelineBtn = shadow.getElementById("exportTimelineBtn");
  const exportTraceBtn = shadow.getElementById("exportTraceBtn");
  const clearMarksBtn = shadow.getElementById("clearMarksBtn");
  const marksCountEl = shadow.getElementById("marksCount");
  const laneNavEl = shadow.getElementById("lane-navigation");
  const laneRenderEl = shadow.getElementById("lane-render");
  const laneStateEl = shadow.getElementById("lane-state");
  const laneCacheEl = shadow.getElementById("lane-cache");
  const laneTimerEl = shadow.getElementById("lane-timer");
  
  const clearExprBtn = shadow.getElementById("clearExprBtn");
  const totalEvalsEl = shadow.getElementById("totalEvals");
  const uniqueExprsEl = shadow.getElementById("uniqueExprs");
  const avgExprTimeEl = shadow.getElementById("avgExprTime");
  const exprTableBody = shadow.getElementById("exprTableBody");
  
  const clearInvBtn = shadow.getElementById("clearInvBtn");
  const totalInvalidationsEl = shadow.getElementById("totalInvalidations");
  const trackedPathsEl = shadow.getElementById("trackedPaths");
  const invMatrixEl = shadow.getElementById("invMatrix");
  const navLogEl = shadow.getElementById("navLog");
  
  const clearConsoleBtn = shadow.getElementById("clearConsoleBtn");
  const exportConsoleBtn = shadow.getElementById("exportConsoleBtn");
  const consoleOutputEl = shadow.getElementById("consoleOutput");
  const filterBtns = shadow.querySelectorAll(".filter-btn");
  
  const hitRateEl = shadow.getElementById("hitRate");
  const hitRateCircle = shadow.getElementById("hitRateCircle");
  const cacheHitsEl = shadow.getElementById("cacheHits");
  const cacheMissesEl = shadow.getElementById("cacheMisses");
  const cacheSizeEl = shadow.getElementById("cacheSize");
  const totalRequestsEl = shadow.getElementById("totalRequests");
  const cacheEfficiencyEl = shadow.getElementById("cacheEfficiency");
  const avgLookupTimeEl = shadow.getElementById("avgLookupTime");
  const lastClearedEl = shadow.getElementById("lastCleared");
  const clearCacheBtn = shadow.getElementById("clearCacheBtn");

  // ============================================================================
  // TAB SWITCHING
  // ============================================================================
  
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const newTab = tab.dataset.tab;
      if (newTab === activeTab) return; // Skip if already active
      
      tabs.forEach(t => t.classList.remove("active"));
      tabContents.forEach(tc => tc.classList.remove("active"));
      tab.classList.add("active");
      
      activeTab = newTab;
      
      const targetContent = shadow.getElementById(`tab-${newTab}`);
      if (targetContent) {
        targetContent.classList.add("active");
        
        // Update the newly active tab immediately
        switch(activeTab) {
          case 'timeline':
            updateTimelineUI();
            break;
          case 'expressions':
            updateExpressionsUI();
            break;
          case 'invalidation':
            updateInvalidationUI();
            break;
          case 'diagnostics':
            update();
            break;
          case 'performance':
            updatePerfUI();
            break;
        }
      }
    });
  });

  // ============================================================================
  // PANEL TOGGLE
  // ============================================================================
  
  function setOpen(open) {
    panelOpen = open;
    if (open) {
      panel.classList.add("open");
      startPerfMonitoring();
      // Initial update for active tab
      if (activeTab === 'diagnostics') update();
      else if (activeTab === 'performance') updatePerfUI();
    } else {
      panel.classList.remove("open");
      stopPerfMonitoring();
    }
  }
  
  if (startOpen) setOpen(true);

  // ============================================================================
  // CONSOLE INTERCEPTION
  // ============================================================================
  
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
  };
  
  function interceptConsole(type) {
    const original = originalConsole[type];
    console[type] = (...args) => {
      original.apply(console, args);
      
      consoleLogs.push({
        type,
        args: args.map(arg => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        }),
        time: Date.now()
      });
      
      if (consoleLogs.length > MAX_CONSOLE_LOGS) {
        consoleLogs.shift();
      }
      
      updateConsoleBadges();
      if (panelOpen && activeTab === 'console') {
        updateConsoleOutput();
      }
    };
  }
  
  interceptConsole('log');
  interceptConsole('warn');
  interceptConsole('error');
  interceptConsole('info');
  
  function updateConsoleBadges() {
    const counts = { all: consoleLogs.length, log: 0, warn: 0, error: 0, info: 0 };
    for (let i = 0; i < consoleLogs.length; i++) {
      counts[consoleLogs[i].type]++;
    }
    
    shadow.getElementById('badge-all').textContent = counts.all;
    shadow.getElementById('badge-log').textContent = counts.log;
    shadow.getElementById('badge-warn').textContent = counts.warn;
    shadow.getElementById('badge-error').textContent = counts.error;
    shadow.getElementById('badge-info').textContent = counts.info;
  }
  
  function updateConsoleOutput() {
    const filtered = consoleFilter === 'all' 
      ? consoleLogs 
      : consoleLogs.filter(log => log.type === consoleFilter);
    
    if (filtered.length === 0) {
      consoleOutputEl.innerHTML = '<div class="text-center muted">No console output</div>';
      return;
    }
    
    // Use DocumentFragment for efficient DOM updates
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < filtered.length; i++) {
      const log = filtered[i];
      const line = document.createElement('div');
      line.className = 'console-line';
      
      const time = document.createElement('span');
      time.className = 'console-time';
      time.textContent = new Date(log.time).toLocaleTimeString();
      
      const msg = document.createElement('span');
      msg.className = `console-msg console-${log.type}`;
      msg.textContent = log.args.join(' ');
      
      line.appendChild(time);
      line.appendChild(msg);
      fragment.appendChild(line);
    }
    
    consoleOutputEl.innerHTML = '';
    consoleOutputEl.appendChild(fragment);
  }

  // ============================================================================
  // PERFORMANCE MONITORING
  // ============================================================================
  
  function startPerfMonitoring() {
    if (perfInterval) return;
    
    function updateFPS() {
      perfStats.frameCount++;
      const now = performance.now();
      const delta = now - perfStats.lastFrameTime;
      
      if (delta >= 1000) {
        perfStats.fps = Math.round((perfStats.frameCount * 1000) / delta);
        perfStats.frameCount = 0;
        perfStats.lastFrameTime = now;
        
        // Only update if Performance tab is active
        if (panelOpen && activeTab === 'performance') {
          updatePerfUI();
        }
      }
      
      rafId = requestAnimationFrame(updateFPS);
    }
    
    rafId = requestAnimationFrame(updateFPS);
    
    // Only update diagnostics tab when it's active
    perfInterval = setInterval(() => {
      if (panelOpen && activeTab === 'diagnostics') {
        update();
      }
    }, 1000);
  }
  
  function stopPerfMonitoring() {
    if (perfInterval) {
      clearInterval(perfInterval);
      perfInterval = null;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
  
  function updatePerfUI() {
    const now = performance.now();
    const sessionTime = Math.floor((now - perfStats.startTime) / 1000);
    
    // Use textContent instead of innerHTML where possible
    fpsValueEl.textContent = perfStats.fps;
    const fpsPercent = (perfStats.fps / 60) * 100;
    fpsBarEl.style.width = `${Math.min(100, fpsPercent)}%`;
    
    if (perfStats.fps >= 55) {
      fpsValueEl.className = 'stat-value perf-good';
    } else if (perfStats.fps >= 30) {
      fpsValueEl.className = 'stat-value perf-ok';
    } else {
      fpsValueEl.className = 'stat-value perf-poor';
    }
    
    renderTimeEl.innerHTML = perfStats.avgRenderTime.toFixed(2) + '<span class="stat-unit">ms</span>';
    minRenderEl.innerHTML = (perfStats.minRenderTime === Infinity ? 0 : perfStats.minRenderTime.toFixed(2)) + '<span class="stat-unit">ms</span>';
    maxRenderEl.innerHTML = perfStats.maxRenderTime.toFixed(2) + '<span class="stat-unit">ms</span>';
    
    if (perfStats.renderTimes.length > 0) {
      const last = perfStats.renderTimes[perfStats.renderTimes.length - 1];
      lastRenderEl.innerHTML = last.toFixed(2) + '<span class="stat-unit">ms</span>';
    }
    
    if (performance.memory) {
      const memMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
      memValueEl.innerHTML = memMB + '<span class="stat-unit">MB</span>';
    }
    
    renderCountEl.textContent = perfStats.renderCount;
    stateChangesEl.textContent = perfStats.stateChangeCount;
    gotoCountEl.textContent = perfStats.gotoCount;
    sessionTimeEl.textContent = `${sessionTime}s`;
    perfPassageEl.textContent = engine.current || '—';
  }

  // ============================================================================
  // PERFORMANCE MARKS & LANES - OPTIMIZED
  // ============================================================================
  
  function addMark(name, lane, data = {}) {
    const mark = {
      name,
      lane,
      time: performance.now(),
      timestamp: Date.now(),
      data
    };
    
    perfMarks.push(mark);
    lanes[lane].push(mark);
    
    // Automatic pruning
    if (perfMarks.length > MAX_MARKS) {
      const removed = perfMarks.shift();
      const laneArray = lanes[removed.lane];
      const idx = laneArray.indexOf(removed);
      if (idx >= 0) laneArray.splice(idx, 1);
    }
    
    if (performance.mark) {
      try {
        performance.mark(name);
      } catch (e) {}
    }
    
    // Update immediately if timeline tab is active
    if (panelOpen && activeTab === 'timeline') {
      updateTimelineUI();
    }
  }
  
  function updateTimelineUI() {
    marksCountEl.textContent = perfMarks.length;
    
    updateLane(laneNavEl, lanes.navigation, 'nav');
    updateLane(laneRenderEl, lanes.render, 'render');
    updateLane(laneStateEl, lanes.state, 'state');
    updateLane(laneCacheEl, lanes.cache, 'cache');
    updateLane(laneTimerEl, lanes.timer, 'timer');
  }
  
  function updateLane(laneEl, events, className) {
    if (events.length === 0) {
      if (laneEl.childElementCount === 0 || laneEl.children[0].className !== 'muted') {
        laneEl.innerHTML = '<span class="muted" style="font-size: 10px;">No events</span>';
      }
      return;
    }
    
    // Use DocumentFragment for batch DOM operations
    const fragment = document.createDocumentFragment();
    const recent = events.slice(-12); // Show last 12 events
    
    for (let i = 0; i < recent.length; i++) {
      const event = recent[i];
      const relTime = ((event.time - perfStats.startTime) / 1000).toFixed(2);
      
      const span = document.createElement('span');
      span.className = `event-mark ${className}`;
      span.title = `${event.name} @ ${relTime}s`;
      span.textContent = event.name;
      
      fragment.appendChild(span);
    }
    
    laneEl.innerHTML = '';
    laneEl.appendChild(fragment);
  }
  
  function exportTimeline() {
    const timeline = {
      traceEvents: perfMarks.map(mark => ({
        name: mark.name,
        cat: mark.lane,
        ph: 'I',
        ts: mark.time * 1000,
        pid: 1,
        tid: 1,
        args: mark.data
      }))
    };
    
    downloadJSON(timeline, `timeline-${Date.now()}.json`);
  }
  
  function exportTrace() {
    const trace = {
      displayTimeUnit: 'ms',
      traceEvents: perfMarks.map(mark => ({
        name: mark.name,
        cat: mark.lane,
        ph: 'i',
        ts: mark.time * 1000,
        pid: 1,
        tid: 1,
        s: 't',
        args: mark.data
      }))
    };
    
    downloadJSON(trace, `trace-${Date.now()}.json`);
  }
  
  function clearMarks() {
    perfMarks.length = 0;
    Object.keys(lanes).forEach(key => lanes[key] = []);
    
    if (performance.clearMarks) performance.clearMarks();
    
    updateTimelineUI();
  }

  // ============================================================================
  // EXPRESSION PROFILER - OPTIMIZED
  // ============================================================================
  
  function recordExpression(expr, hit, evalTime, evicted = false) {
    if (!exprProfiler.expressions.has(expr)) {
      exprProfiler.expressions.set(expr, {
        expr,
        hits: 0,
        misses: 0,
        totalTime: 0,
        evalCount: 0,
        evictions: 0,
        lastEval: Date.now()
      });
    }
    
    const stats = exprProfiler.expressions.get(expr);
    
    if (hit) {
      stats.hits++;
    } else {
      stats.misses++;
    }
    
    stats.totalTime += evalTime;
    stats.evalCount++;
    stats.lastEval = Date.now();
    
    if (evicted) {
      stats.evictions++;
    }
    
    // Mark cache as dirty
    exprProfiler.sortedCache = null;
    exprProfiler.dirty = true;
    
    // Update immediately if expressions tab is active
    if (panelOpen && activeTab === 'expressions') {
      updateExpressionsUI();
    }
  }
  
  function updateExpressionsUI() {
    const expressions = Array.from(exprProfiler.expressions.values());
    
    const totalEvals = expressions.reduce((sum, e) => sum + e.evalCount, 0);
    const totalTime = expressions.reduce((sum, e) => sum + e.totalTime, 0);
    
    totalEvalsEl.textContent = totalEvals;
    uniqueExprsEl.textContent = expressions.length;
    avgExprTimeEl.innerHTML = (totalEvals > 0 ? (totalTime / totalEvals).toFixed(3) : 0) + '<span class="stat-unit">ms</span>';
    
    if (expressions.length === 0) {
      exprTableBody.innerHTML = '<tr><td colspan="5" class="text-center muted">No expressions evaluated yet</td></tr>';
      return;
    }
    
    // Use cached sorted array if available and not dirty
    let sorted = exprProfiler.sortedCache;
    if (!sorted || exprProfiler.dirty) {
      sorted = expressions.slice().sort((a, b) => b.evalCount - a.evalCount);
      exprProfiler.sortedCache = sorted;
      exprProfiler.dirty = false;
    }
    
    // Use DocumentFragment for efficient DOM updates
    const fragment = document.createDocumentFragment();
    const top = sorted.slice(0, 25);
    
    for (let i = 0; i < top.length; i++) {
      const expr = top[i];
      const hitRate = expr.evalCount > 0 ? ((expr.hits / expr.evalCount) * 100).toFixed(1) : 0;
      const avgTime = expr.evalCount > 0 ? (expr.totalTime / expr.evalCount).toFixed(3) : 0;
      
      const tr = document.createElement('tr');
      
      const td1 = document.createElement('td');
      const code = document.createElement('div');
      code.className = 'expr-code';
      code.title = expr.expr;
      code.textContent = expr.expr;
      td1.appendChild(code);
      
      const td2 = document.createElement('td');
      td2.style.textAlign = 'right';
      td2.textContent = hitRate + '%';
      
      const td3 = document.createElement('td');
      td3.style.textAlign = 'right';
      td3.textContent = expr.evalCount;
      
      const td4 = document.createElement('td');
      td4.style.textAlign = 'right';
      td4.textContent = avgTime + 'ms';
      
      const td5 = document.createElement('td');
      td5.style.textAlign = 'right';
      td5.textContent = expr.evictions;
      
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tr.appendChild(td4);
      tr.appendChild(td5);
      
      fragment.appendChild(tr);
    }
    
    exprTableBody.innerHTML = '';
    exprTableBody.appendChild(fragment);
  }
  
  function clearExpressions() {
    exprProfiler.expressions.clear();
    exprProfiler.sortedCache = null;
    exprProfiler.dirty = false;
    updateExpressionsUI();
  }

  // ============================================================================
  // INVALIDATION TRACKING - OPTIMIZED
  // ============================================================================
  
  function recordInvalidation(statePaths, invalidatedKeys) {
    const currentNav = engine.current || 'unknown';
    
    for (let i = 0; i < statePaths.length; i++) {
      const path = statePaths[i];
      if (!invalidationTracker.matrix.has(path)) {
        invalidationTracker.matrix.set(path, new Set());
      }
      const keySet = invalidationTracker.matrix.get(path);
      invalidatedKeys.forEach(key => keySet.add(key));
    }
    
    const logEntry = {
      time: Date.now(),
      nav: currentNav,
      invalidations: statePaths.map(path => ({
        path,
        keys: Array.from(invalidatedKeys).filter(key => key.includes(path))
      }))
    };
    
    invalidationTracker.navLog.push(logEntry);
    if (invalidationTracker.navLog.length > invalidationTracker.maxNavLog) {
      invalidationTracker.navLog.shift();
    }
    
    invalidationTracker.totalInvalidations += invalidatedKeys.size;
    invalidationTracker.matrixCache = null;
    invalidationTracker.dirty = true;
    
    // Update immediately if invalidation tab is active
    if (panelOpen && activeTab === 'invalidation') {
      updateInvalidationUI();
    }
  }
  
  function updateInvalidationUI() {
    totalInvalidationsEl.textContent = invalidationTracker.totalInvalidations;
    trackedPathsEl.textContent = invalidationTracker.matrix.size;
    
    if (invalidationTracker.matrix.size === 0) {
      invMatrixEl.innerHTML = '<div class="text-center muted">No invalidations recorded yet</div>';
    } else {
      // Use cached sorted array if available
      let entries = invalidationTracker.matrixCache;
      if (!entries || invalidationTracker.dirty) {
        entries = Array.from(invalidationTracker.matrix.entries())
          .sort((a, b) => b[1].size - a[1].size)
          .slice(0, 25);
        invalidationTracker.matrixCache = entries;
        invalidationTracker.dirty = false;
      }
      
      // Use DocumentFragment
      const fragment = document.createDocumentFragment();
      
      for (let i = 0; i < entries.length; i++) {
        const [path, keys] = entries[i];
        const keyArray = Array.from(keys);
        const preview = keyArray.slice(0, 2).join(', ') + (keyArray.length > 2 ? '...' : '');
        
        const row = document.createElement('div');
        row.className = 'inv-row';
        
        const pathDiv = document.createElement('div');
        pathDiv.className = 'inv-path';
        pathDiv.title = path;
        pathDiv.textContent = path;
        
        const keysDiv = document.createElement('div');
        keysDiv.className = 'inv-keys';
        keysDiv.title = keyArray.join(', ');
        keysDiv.textContent = preview;
        
        const countDiv = document.createElement('div');
        countDiv.className = 'inv-count';
        countDiv.textContent = keys.size;
        
        row.appendChild(pathDiv);
        row.appendChild(keysDiv);
        row.appendChild(countDiv);
        
        fragment.appendChild(row);
      }
      
      invMatrixEl.innerHTML = '';
      invMatrixEl.appendChild(fragment);
    }
    
    if (invalidationTracker.navLog.length === 0) {
      navLogEl.innerHTML = '<div class="text-center muted">No navigations yet</div>';
    } else {
      // Use DocumentFragment
      const fragment = document.createDocumentFragment();
      const recent = invalidationTracker.navLog.slice().reverse().slice(0, 12);
      
      for (let i = 0; i < recent.length; i++) {
        const entry = recent[i];
        const time = new Date(entry.time).toLocaleTimeString();
        const totalInvs = entry.invalidations.reduce((sum, inv) => sum + inv.keys.length, 0);
        
        const entryDiv = document.createElement('div');
        entryDiv.className = 'nav-log-entry';
        
        const header = document.createElement('div');
        header.className = 'nav-log-header';
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'nav-log-time';
        timeSpan.textContent = time;
        
        const navSpan = document.createElement('span');
        navSpan.className = 'nav-log-nav';
        navSpan.textContent = entry.nav;
        
        const countSpan = document.createElement('span');
        countSpan.className = 'nav-log-time';
        countSpan.textContent = `${totalInvs} invalidations`;
        
        header.appendChild(timeSpan);
        header.appendChild(navSpan);
        header.appendChild(countSpan);
        
        const invs = document.createElement('div');
        invs.className = 'nav-log-invs';
        invs.textContent = entry.invalidations.slice(0, 3).map(inv => `${inv.path}: ${inv.keys.length} keys`).join(', ');
        
        entryDiv.appendChild(header);
        entryDiv.appendChild(invs);
        
        fragment.appendChild(entryDiv);
      }
      
      navLogEl.innerHTML = '';
      navLogEl.appendChild(fragment);
    }
  }
  
  function clearInvalidation() {
    invalidationTracker.matrix.clear();
    invalidationTracker.navLog = [];
    invalidationTracker.totalInvalidations = 0;
    invalidationTracker.matrixCache = null;
    invalidationTracker.dirty = false;
    updateInvalidationUI();
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================
  
  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ============================================================================
  // STATE & DIAGNOSTICS UPDATE
  // ============================================================================
  
  let linkCache = new Map();
  let lastLinkUpdate = 0;
  
  function update() {
    const curId = engine.current;
    curIdEl.textContent = curId || "—";
    
    const now = performance.now();
    const sessionTime = Math.floor((now - perfStats.startTime) / 1000);
    
    if (sessionTime < 60) {
      uptimeEl.textContent = `${sessionTime}s`;
    } else {
      const mins = Math.floor(sessionTime / 60);
      const secs = sessionTime % 60;
      uptimeEl.textContent = `${mins}m ${secs}s`;
    }
    
    if (stateUpdateTimer) clearTimeout(stateUpdateTimer);
    stateUpdateTimer = setTimeout(updateStateJson, STATE_UPDATE_THROTTLE);
    
    updateLinks(curId);
    updateCacheStats();
  }
  
  function updateStateJson() {
    try {
      const state = engine.getState ? engine.getState() : {};
      let jsonStr = JSON.stringify(state, null, 2);
      
      if (stateSearchQuery) {
        const regex = new RegExp(`(${stateSearchQuery})`, 'gi');
        jsonStr = jsonStr.replace(regex, '<span class="search-highlight">$1</span>');
      }
      
      stateJsonEl.innerHTML = jsonStr;
    } catch (e) {
      stateJsonEl.textContent = 'Error displaying state';
    }
  }
  
  function updateLinks(passageId) {
    if (!passageId) {
      linksEl.innerHTML = '<div class="muted">No passage</div>';
      return;
    }
    
    const now = Date.now();
    
    if (linkCache.has(passageId) && (now - lastLinkUpdate) < LINK_UPDATE_THROTTLE) {
      linksEl.innerHTML = linkCache.get(passageId);
      return;
    }
    
    try {
      const container = document.querySelector("#app");
      if (!container) {
        linksEl.innerHTML = '<div class="muted">No app container</div>';
        return;
      }
      
      const links = container.querySelectorAll('[data-goto]');
      
      if (links.length === 0) {
        const html = '<div class="muted">No outgoing links</div>';
        linkCache.set(passageId, html);
        linksEl.innerHTML = html;
      } else {
        const html = Array.from(links).map(link => {
          const target = link.dataset.goto || '?';
          return `<button class="pill" onclick="this.getRootNode().host.dispatchEvent(new CustomEvent('debug-goto', {detail:'${target}'}))">${target}</button>`;
        }).join('');
        
        linkCache.set(passageId, html);
        linksEl.innerHTML = html;
      }
      
      lastLinkUpdate = now;
    } catch (e) {
      console.error('[debug] Error updating links:', e);
      linksEl.innerHTML = '<div class="muted">Error loading links</div>';
    }
  }
  
  function updateCacheStats() {
    let engineCache = null;
    
    if (engine._debug && typeof engine._debug.getCacheStats === 'function') {
      try {
        const stats = engine._debug.getCacheStats();
        if (stats.passages) {
          engineCache = {
            hits: stats.passages.hits || 0,
            misses: stats.passages.misses || 0,
            size: stats.passages.size || 0
          };
        }
      } catch (e) {}
    }
    
    if (engineCache) {
      cacheStats.hits = engineCache.hits || 0;
      cacheStats.misses = engineCache.misses || 0;
      cacheStats.size = engineCache.size || 0;
    }
    
    const total = cacheStats.hits + cacheStats.misses;
    const hitRate = total > 0 ? (cacheStats.hits / total * 100) : 0;
    
    hitRateEl.innerHTML = hitRate.toFixed(1) + '<span class="stat-unit">%</span>';
    cacheHitsEl.textContent = cacheStats.hits;
    cacheMissesEl.textContent = cacheStats.misses;
    cacheSizeEl.textContent = cacheStats.size;
    totalRequestsEl.textContent = total;
    
    const circumference = 2 * Math.PI * 34;
    const offset = circumference - (hitRate / 100) * circumference;
    hitRateCircle.style.strokeDashoffset = offset;
    
    let efficiency = 'N/A';
    if (total > 0) {
      if (hitRate >= 80) efficiency = '🟢 Excellent';
      else if (hitRate >= 60) efficiency = '🟡 Good';
      else if (hitRate >= 40) efficiency = '🟠 Fair';
      else efficiency = '🔴 Poor';
    }
    cacheEfficiencyEl.textContent = efficiency;
    
    avgLookupTimeEl.textContent = '< 1 ms';
    
    const timeSince = Math.floor((Date.now() - cacheStats.lastUpdate) / 1000);
    if (timeSince < 60) {
      lastClearedEl.textContent = `${timeSince}s ago`;
    } else {
      const mins = Math.floor(timeSince / 60);
      lastClearedEl.textContent = `${mins}m ago`;
    }
  }

  // ============================================================================
  // EVENT LISTENERS
  // ============================================================================
  
  hideBtn.addEventListener("click", () => setOpen(false));
  
  jumpBtn.addEventListener("click", () => { 
    const id = jumpInput.value.trim(); 
    if (id) {
      perfStats.gotoCount++;
      addMark(`goto:${id}`, 'navigation', { target: id });
      engine.goto(id);
    }
  });
  
  copyBtn.addEventListener("click", async () => { 
    try { 
      const text = stateJsonEl.textContent;
      await navigator.clipboard.writeText(text); 
      copyBtn.textContent = "✓ Copied"; 
      setTimeout(() => copyBtn.textContent = "Copy", 1200);
    } catch {} 
  });
  
  refreshBtn.addEventListener("click", () => {
    linkCache.clear();
    lastLinkUpdate = 0;
    update();
  });
  
  resetStatsBtn.addEventListener("click", () => {
    perfStats.renderCount = 0;
    perfStats.renderTimes = [];
    perfStats.avgRenderTime = 0;
    perfStats.maxRenderTime = 0;
    perfStats.minRenderTime = Infinity;
    perfStats.stateChangeCount = 0;
    perfStats.gotoCount = 0;
    perfStats.startTime = performance.now();
    updatePerfUI();
  });
  
  gcBtn.addEventListener("click", () => {
    linkCache.clear();
    perfStats.renderTimes = perfStats.renderTimes.slice(-10);
    perfStats.memorySnapshots = perfStats.memorySnapshots.slice(-10);
    
    if (window.gc) window.gc();
    
    gcBtn.textContent = "✓ Cleared";
    setTimeout(() => gcBtn.textContent = "🗑️ Clear Cache", 1200);
  });
  
  clearConsoleBtn.addEventListener("click", () => {
    consoleLogs.length = 0;
    updateConsoleBadges();
    updateConsoleOutput();
  });
  
  exportConsoleBtn.addEventListener("click", () => {
    const text = consoleLogs.map(log => {
      const time = new Date(log.time).toISOString();
      return `[${time}] [${log.type.toUpperCase()}] ${log.args.join(' ')}`;
    }).join('\n');
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `console-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });
  
  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      consoleFilter = btn.dataset.filter;
      updateConsoleOutput();
    });
  });
  
  stateSearchInput.addEventListener("input", () => {
    stateSearchQuery = stateSearchInput.value.toLowerCase();
    updateStateJson();
  });
  
  clearCacheBtn.addEventListener("click", () => {
    if (typeof engine.clearCache === 'function') {
      engine.clearCache();
    }
    
    cacheStats.lastUpdate = Date.now();
    linkCache.clear();
    updateCacheStats();
    
    clearCacheBtn.textContent = "✓ Cleared";
    setTimeout(() => clearCacheBtn.textContent = "Clear All Caches", 1200);
  });
  
  exportTimelineBtn.addEventListener("click", exportTimeline);
  exportTraceBtn.addEventListener("click", exportTrace);
  clearMarksBtn.addEventListener("click", clearMarks);
  
  clearExprBtn.addEventListener("click", clearExpressions);
  
  clearInvBtn.addEventListener("click", clearInvalidation);

  window.addEventListener("keydown", (e) => { 
    if (e.key === hotkey) { 
      e.preventDefault(); 
      setOpen(!panelOpen); 
    } 
  });
  
  host.addEventListener("debug-goto", (e) => {
    perfStats.gotoCount++;
    addMark(`goto:${e.detail}`, 'navigation', { target: e.detail });
    engine.goto(e.detail);
  });

  // ============================================================================
  // ENGINE EVENT LISTENERS WITH INSTRUMENTATION
  // ============================================================================
  
  const renderListener = () => {
    const renderStart = performance.now();
    addMark('render:start', 'render');
    
    perfStats.renderCount++;
    update();
    
    const renderEnd = performance.now();
    const renderTime = renderEnd - renderStart;
    
    addMark('render:end', 'render', { duration: renderTime });
    
    perfStats.renderTimes.push(renderTime);
    if (perfStats.renderTimes.length > 50) perfStats.renderTimes.shift();
    
    perfStats.avgRenderTime = perfStats.renderTimes.reduce((a, b) => a + b, 0) / perfStats.renderTimes.length;
    perfStats.maxRenderTime = Math.max(perfStats.maxRenderTime, renderTime);
    perfStats.minRenderTime = Math.min(perfStats.minRenderTime, renderTime);
  };
  
  const stateChangeListener = (payload) => {
    perfStats.stateChangeCount++;
    addMark('state:change', 'state', { paths: payload?.changedPaths });
    
    if (payload?.changedPaths && payload.changedPaths.length > 0) {
      const mockInvalidatedKeys = new Set(['key1', 'key2']);
      recordInvalidation(payload.changedPaths, mockInvalidatedKeys);
    }
    
    update();
  };
  
  const navigationListener = (payload) => {
    addMark(`nav:${payload.to}`, 'navigation', { from: payload.from, to: payload.to });
  };
  
  engine.on("render", renderListener);
  engine.on("stateChange", stateChangeListener);
  
  if (typeof engine.on === 'function') {
    engine.on("navigate", navigationListener);
  }
  
  setTimeout(update, 0);
  
  console.info('Debug overlay initialized. Press ` to toggle.');

  // ============================================================================
  // CLEANUP
  // ============================================================================
  
  return { 
    destroy() { 
      stopPerfMonitoring();
      
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.info = originalConsole.info;
      
      if (stateUpdateTimer) clearTimeout(stateUpdateTimer);
      
      engine.off("render", renderListener);
      engine.off("stateChange", stateChangeListener);
      if (typeof engine.off === 'function') {
        engine.off("navigate", navigationListener);
      }
      
      linkCache.clear();
      consoleLogs.length = 0;
      perfStats.renderTimes = [];
      perfStats.memorySnapshots = [];
      perfMarks.length = 0;
      exprProfiler.expressions.clear();
      exprProfiler.sortedCache = null;
      invalidationTracker.matrix.clear();
      invalidationTracker.navLog = [];
      invalidationTracker.matrixCache = null;
      
      document.body.removeChild(host);
    },
    
    recordExpression,
    recordInvalidation,
    addMark
  };
}