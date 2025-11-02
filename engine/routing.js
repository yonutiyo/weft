// engine/routing.js
// Optimized hash-based routing with silent mode support
// Big O optimizations: O(1) hash operations, efficient event handling

/**
 * Create an optimized router with silent mode support
 * 
 * @param {Object} options - Router configuration
 * @param {boolean} [options.enabled=true] - Enable hash routing
 * @param {boolean} [options.displayHashInURL=false] - Display passage name in URL hash
 * @param {Function} [options.onNavigate] - Navigation callback
 * 
 * Performance characteristics:
 * - goto(): O(1) - direct hash update or render
 * - listen(): O(1) - single event listener
 * - Browser back/forward: O(1) - ignored in silent mode
 * - Direct hash navigation: O(1) - hash read and render
 * 
 * Silent Mode (displayHashInURL=false):
 * - Engine navigations don't update URL hash
 * - Browser back/forward buttons ignored
 * - Direct hash URLs still work (e.g., #chapter1)
 * - Internal undo/redo unaffected
 * 
 * Hash Mode (displayHashInURL=true):
 * - Traditional behavior: hash updates on navigation
 * - Browser back/forward triggers navigation
 * - Full URL-based navigation
 */
export function createRouter(options = {}) {
  const { 
    enabled = true, 
    displayHashInURL = false,  // NEW: Silent mode by default
    onNavigate 
  } = options;
  
  let routingEnabled = enabled;
  let displayHash = displayHashInURL;
  let currentId = null;
  let hashChangeListener = null;
  let isInternalNavigation = false;  // Track engine-initiated navigation
  
  // Optimization: Cache encoded IDs to avoid repeated encoding
  const encodeCache = new Map();
  const MAX_ENCODE_CACHE = 200;  // O(1) lookups
  
  /**
   * Encode passage ID for URL - O(1) with cache
   */
  function encodeId(id) {
    if (encodeCache.has(id)) {
      return encodeCache.get(id);
    }
    
    const encoded = encodeURIComponent(id);
    
    // Maintain cache size limit
    if (encodeCache.size >= MAX_ENCODE_CACHE) {
      // Remove oldest entry (first key)
      const firstKey = encodeCache.keys().next().value;
      encodeCache.delete(firstKey);
    }
    
    encodeCache.set(id, encoded);
    return encoded;
  }
  
  /**
   * Decode passage ID from hash - O(1)
   */
  function decodeId(hash) {
    if (!hash || hash.length <= 1) return "";
    try {
      return decodeURIComponent(hash.slice(1));
    } catch {
      return hash.slice(1);
    }
  }
  
  /**
   * Get passage ID from current hash - O(1)
   */
  function getIdFromHash() {
    return decodeId(location.hash);
  }
  
  /**
   * Set hash silently without triggering hashchange - O(1)
   * Uses replaceState to avoid adding to browser history
   */
  function setHashSilent(id) {
    const desired = "#" + encodeId(id);
    
    // Use replaceState to avoid browser history pollution
    if (history.replaceState) {
      history.replaceState(null, null, desired);
    } else {
      // Fallback for old browsers
      const scrollPos = { x: window.scrollX, y: window.scrollY };
      location.replace(desired);
      window.scrollTo(scrollPos.x, scrollPos.y);
    }
  }
  
  /**
   * Set hash normally (triggers hashchange) - O(1)
   */
  function setHashNormal(id) {
    const desired = "#" + encodeId(id);
    if (location.hash !== desired) {
      location.hash = desired;
    }
  }
  
  /**
   * Navigate to a passage - O(1)
   * 
   * Silent mode: Render directly without updating hash
   * Hash mode: Update hash which triggers render
   */
  async function goto(passageId, render) {
    if (!routingEnabled) {
      // Routing disabled: direct render
      currentId = passageId;
      await render(passageId);
      return;
    }
    
    isInternalNavigation = true;
    
    if (displayHash) {
      // Hash display mode: traditional behavior
      const expected = "#" + encodeId(passageId);
      if (location.hash === expected) {
        // Hash already correct, just render
        currentId = passageId;
        await render(passageId);
      } else {
        // Set hash, which will trigger hashchange and render
        currentId = passageId;
        setHashNormal(passageId);
      }
    } else {
      // Silent mode: render without hash update
      currentId = passageId;
      await render(passageId);
    }
    
    // Reset flag after microtask to avoid race conditions
    Promise.resolve().then(() => {
      isInternalNavigation = false;
    });
  }
  
  /**
   * Start listening to hash changes - O(1)
   * 
   * Silent mode: Ignores browser back/forward, but allows direct hash URLs
   * Hash mode: Responds to all hash changes
   */
  function listen(render) {
    if (!routingEnabled) return;
    
    hashChangeListener = async () => {
      // In silent mode, ignore browser-initiated navigation
      if (!displayHash && !isInternalNavigation) {
        // Check if this is a direct hash URL (initial load or manual entry)
        const hashId = getIdFromHash();
        
        // Only respond if hash is non-empty and different from current
        // This handles direct URLs like example.com#chapter1
        if (hashId && hashId !== currentId) {
          currentId = hashId;
          await render(hashId);
        }
        return;
      }
      
      // Hash display mode: respond to all hash changes
      const id = getIdFromHash();
      if (id && id !== currentId) {
        currentId = id;
        await render(id);
        
        if (onNavigate) {
          onNavigate({ to: id, from: currentId });
        }
      }
    };
    
    window.addEventListener("hashchange", hashChangeListener, { passive: true });
  }
  
  /**
   * Stop listening to hash changes - O(1)
   */
  function unlisten() {
    if (hashChangeListener) {
      window.removeEventListener("hashchange", hashChangeListener);
      hashChangeListener = null;
    }
  }
  
  /**
   * Start the engine with routing - O(1)
   * 
   * Checks for hash in URL first (for direct links)
   * Falls back to startId if no hash present
   */
  async function start(startId, render) {
    if (!routingEnabled) {
      currentId = startId;
      await render(startId);
      return;
    }
    
    // Check for hash in URL (direct link support)
    const hashId = getIdFromHash();
    const initial = hashId || startId;
    currentId = initial;
    
    if (displayHash) {
      // Hash display mode: ensure hash matches passage
      const expected = "#" + encodeId(initial);
      
      if (location.hash === expected) {
        await render(initial);
      } else {
        setHashNormal(initial);
      }
    } else {
      // Silent mode: render without updating hash
      // If hash exists in URL (direct link), keep it but don't require it
      await render(initial);
    }
  }
  
  /**
   * Enable or disable routing - O(1)
   */
  function setEnabled(enabled) {
    routingEnabled = !!enabled;
    
    if (!enabled && hashChangeListener) {
      unlisten();
    }
  }
  
  /**
   * Enable or disable hash display in URL - O(1)
   * 
   * Can be toggled at runtime for author preference
   */
  function setDisplayHash(display) {
    displayHash = !!display;
    
    if (displayHash && currentId) {
      // Switching to hash display mode: update hash to current passage
      setHashNormal(currentId);
    }
  }
  
  /**
   * Get current passage ID - O(1)
   */
  function getCurrent() {
    return currentId;
  }
  
  /**
   * Set current passage ID (internal use) - O(1)
   */
  function setCurrent(id) {
    currentId = id;
  }
  
  /**
   * Clear encode cache (for memory management) - O(1)
   */
  function clearCache() {
    encodeCache.clear();
  }
  
  return {
    goto,
    listen,
    unlisten,
    start,
    setEnabled,
    setDisplayHash,      // NEW: Toggle hash display at runtime
    getCurrent,
    setCurrent,
    getIdFromHash,
    clearCache,          // NEW: Memory management
    
    // Getters
    get enabled() { return routingEnabled; },
    get displayHashInURL() { return displayHash; }  // NEW: Check current mode
  };
}
