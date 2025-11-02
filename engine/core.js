// engine/core.js
// Main engine factory - ties all modules together

import { createEventBus } from "./events.js";
import { createStateManager } from "./state.js";
import { createInterpolator } from "./interpolation.js";
import { createRouter } from "./routing.js";
import { createRenderer } from "./rendering.js";
import { createTimerManager } from "./timers.js";
import { defaultHelpers } from "./expressions.js";
import { createSmartCache } from "./cache.js";
import { DEV } from "./utils.js";

/**
 * @typedef {Object} EngineOptions
 * @property {string} [appSelector="#app"] - CSS selector for container
 * @property {number} [cacheSize=200] - Max cached passages
 * @property {boolean} [useHashRouting=true] - Enable URL hash routing
 * @property {boolean} [displayHashInURL=false] - Display passage name in URL hash (NEW)
 * @property {number} [maxHistory=50] - Max undo/redo steps
 * 
 * Hash Routing Modes:
 * 
 * 1. Silent Mode (default): displayHashInURL=false
 *    - Passages navigate without updating URL hash
 *    - Browser back/forward buttons don't change passages
 *    - Direct hash URLs still work (e.g., example.com#chapter1)
 *    - Internal undo/redo buttons work normally
 *    - Clean URLs for readers
 * 
 * 2. Hash Display Mode: displayHashInURL=true
 *    - Traditional behavior: hash updates on navigation
 *    - Browser back/forward triggers passage changes
 *    - Full URL-based navigation
 *    - Shareable passage URLs
 */

/**
 * Create an interactive fiction engine instance
 * @param {EngineOptions} [options] - Configuration options
 * @returns {Object} Engine API
 */
export function createEngine(options = {}) {
  const {
    appSelector = "#app",
    cacheSize = 200,
    useHashRouting = true,
    displayHashInURL = false,  // NEW: Silent mode by default
    maxHistory = 50
  } = options;

  const app = document.querySelector(appSelector);
  if (!app) throw new Error(`No element matches ${appSelector}`);

  // ==========================================================================
  // INITIALIZE MODULES
  // ==========================================================================
  
  const events = createEventBus();
  const timers = createTimerManager();
  const passageCache = createSmartCache(cacheSize);
  const interpolator = createInterpolator({ maxCacheSize: 100 });
  
  // State manager with callbacks
  const stateManager = createStateManager({
    maxHistory,
    onHistoryChange: (payload) => events.emit("historyChange", payload),
    onStateChange: (payload) => {
      // Invalidate caches based on what changed
      const { changedPaths } = payload;
      interpolator.invalidate(changedPaths);
      events.emit("stateChange", payload);
    }
  });
  
  // Router with navigation callback and hash display option
  const router = createRouter({
    enabled: useHashRouting,
    displayHashInURL,          // NEW: Pass display option
    onNavigate: (payload) => events.emit("navigate", payload)
  });
  
  // Renderer with render callback
  const renderer = createRenderer(app, {
    onRender: (payload) => events.emit("render", payload)
  });

  // ==========================================================================
  // CONTENT PROVIDER
  // ==========================================================================
  
  let provider = null;
  
  function useContentProvider(p) {
    provider = p;
    passageCache.clear();
    interpolator.clear();
  }
  
  function register(passages) {
    useContentProvider(createMemoryProvider(passages));
  }
  
  async function preload(ids = []) {
    if (!provider) return;
    for (const id of ids) {
      if (!passageCache.has(id)) {
        try {
          const html = await provider.get(id);
          if (html) passageCache.set(id, html);
        } catch (e) {
          console.error("[engine] Preload error:", id, e);
        }
      }
    }
  }

  // ==========================================================================
  // RENDERING & NAVIGATION
  // ==========================================================================
  
  /**
   * Ensure HTML for passage is loaded
   */
  async function ensureHtml(id) {
    let html = passageCache.get(id);
    
    if (!html) {
      if (!provider) {
        throw new Error("No content provider. Use useContentProvider() or register().");
      }
      
      html = await provider.get(id);
      
      if (!html) {
        return null;
      }
      
      passageCache.set(id, html);
    }
    
    return html;
  }
  
  /**
   * Render a passage by ID
   * Optimized with dependency-tracked caching
   */
  async function render(passageId) {
    try {
      // Clear timers from previous passage
      timers.clearAll();
      
      const raw = await ensureHtml(passageId);
      
      if (!raw) {
        renderer.renderMissing(passageId);
        return;
      }
      
      // Mark as visited
      stateManager.markVisited(passageId);
      
      // Get current state for interpolation
      const state = stateManager.getRawState();
      
      // Interpolate (cached with dependency tracking)
      const processed = interpolator.interpolate(raw, passageId, state, defaultHelpers);
      
      // Update router state
      router.setCurrent(passageId);
      
      // Render to DOM
      renderer.render(processed, state, passageId);
      
    } catch (e) {
      console.error("[engine] Render error:", e);
      renderer.renderError(passageId, e);
    }
  }
  
  /**
   * Navigate to a passage
   */
  async function goto(passageId) {
    await router.goto(passageId, render);
  }
  
  /**
   * Start the engine
   */
  async function start(startId) {
    // Wire up link delegation
    renderer.wireLinkDelegation(async ({ setStr, target }) => {
      const currentId = router.getCurrent();
      
      // Handle data-set
      if (setStr) {
        const result = stateManager.applySetStatements(setStr, currentId);
        // Cache invalidation handled by state manager callback
      }
      
      // Handle navigation
      if (target && target.trim()) {
        // Save state before navigation (for undo)
        stateManager.setHistoryPassage(currentId);
        
        // Increment turn counter
        stateManager.incrementTurn();
        
        events.emit("navigate", { to: target, from: currentId });
        await goto(target);
      } else if (setStr) {
        // Re-render if only data-set (no navigation)
        await render(currentId);
      }
    });
    
    // Save initial state
    stateManager.setHistoryPassage(null);
    
    // Start listening to hash changes
    router.listen(render);
    
    // Render initial passage
    await router.start(startId, render);
  }

  // ==========================================================================
  // STATE API (delegated to state manager)
  // ==========================================================================
  
  function getState() {
    return stateManager.getState();
  }
  
  function setState(patch, opts) {
    const result = stateManager.setState(patch, opts);
    // Re-render if state changed
    if (result.changed && opts?.reRender !== false) {
      const currentId = router.getCurrent();
      if (currentId) {
        render(currentId);
      }
    }
    return result.changed;
  }
  
  function set(key, value, opts) {
    return setState({ [key]: value }, opts);
  }

  // ==========================================================================
  // HISTORY API (delegated to state manager)
  // ==========================================================================
  
  async function undo() {
    const snapshot = stateManager.undo();
    if (!snapshot) return false;
    
    const currentId = router.getCurrent();
    
    if (snapshot.passage && snapshot.passage !== currentId) {
      await goto(snapshot.passage);
    } else {
      await render(currentId);
    }
    
    events.emit("undo", { state: getState(), passage: snapshot.passage });
    return true;
  }
  
  async function redo() {
    const snapshot = stateManager.redo();
    if (!snapshot) return false;
    
    const currentId = router.getCurrent();
    
    if (snapshot.passage && snapshot.passage !== currentId) {
      await goto(snapshot.passage);
    } else {
      await render(currentId);
    }
    
    events.emit("redo", { state: getState(), passage: snapshot.passage });
    return true;
  }
  
  function canUndo() {
    return stateManager.canUndo();
  }
  
  function canRedo() {
    return stateManager.canRedo();
  }
  
  function clearHistory() {
    stateManager.clearHistory();
  }

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================
  
  function setHashRouting(enabled) {
    router.setEnabled(enabled);
  }
  
  /**
   * NEW: Toggle hash display in URL at runtime
   * Allows authors to switch modes dynamically
   * 
   * @param {boolean} display - Whether to display passage hash in URL
   */
  function setDisplayHashInURL(display) {
    router.setDisplayHash(display);
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================
  
  return {
    // Core
    start,
    goto,
    
    // Content
    useContentProvider,
    register,
    preload,
    
    // State
    getState,
    setState,
    set,
    
    // History
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    
    // Events
    on: events.on,
    off: events.off,
    
    // Timers
    after: timers.after,
    every: timers.every,
    clearTimer: timers.clearTimer,
    
    // Configuration
    setHashRouting,
    setDisplayHashInURL,  // NEW: Runtime toggle for hash display
    
    // Info
    get current() { return router.getCurrent(); },
    get cacheSize() { return passageCache.size(); },
    get historyLength() { return stateManager.historyLength; },
    get redoLength() { return stateManager.redoLength; },
    get timerCount() { return timers.count(); },
    get displayHashInURL() { return router.displayHashInURL; },  // NEW: Check current mode
    
    // Debug info (DEV mode only)
    ...(DEV ? {
      _debug: {
        getCacheStats: () => ({
          passages: passageCache.getStats(),
          interpolation: interpolator.getStats()
        }),
        getEventStats: () => ({
          totalListeners: events.getListenerCount()
        })
      }
    } : {})
  };
}

// ============================================================================
// MEMORY PROVIDER
// ============================================================================

/**
 * Create a simple in-memory content provider
 * @param {Object|Function} map - Passage map or function returning map
 * @returns {Object} Provider with get() method
 */
export function createMemoryProvider(map) {
  const resolveMap = () => (typeof map === "function" ? map() : map);
  
  return {
    async get(id) {
      const m = resolveMap();
      return m[id] ?? null;
    }
  };
}
