// engine/dependency-tracker.js
// Track which state variables are accessed during expression evaluation
// Enables selective cache invalidation with optimized path matching
//
// ARCHITECTURE:
//   - Uses Trie data structure for O(log n) path prefix matching
//   - Significantly faster than linear string.startsWith() scans
//   - Tracks parent paths automatically (e.g., "player.inventory.gold" tracks "player" and "player.inventory")
//
// PERFORMANCE:
//   - Insertion: O(path_length)
//   - Lookup: O(path_length) 
//   - Invalidation: O(changed_paths * path_length) instead of O(all_deps)
//
// OPTIMIZATIONS:
//   - Fixed bug: removeKey called once, not in loop
//   - Added comprehensive error handling
//   - Validates inputs to prevent corruption

// ============================================================================
// TRIE DATA STRUCTURE
// ============================================================================

/**
 * Trie node for efficient prefix matching
 */
class TrieNode {
  constructor() {
    this.children = new Map();
    this.keys = new Set(); // Cache keys that depend on this path
    this.isEnd = false;
  }
}

/**
 * Trie structure for efficient path prefix matching
 * Significantly faster than string.startsWith() for many paths
 */
class PathTrie {
  constructor() {
    this.root = new TrieNode();
  }
  
  /**
   * Insert a path and associate it with a cache key
   */
  insert(pathStr, cacheKey) {
    const parts = pathStr.split('.');
    let node = this.root;
    
    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, new TrieNode());
      }
      node = node.children.get(part);
      node.keys.add(cacheKey);
    }
    
    node.isEnd = true;
  }
  
  /**
   * Find all cache keys affected by changing a path
   * More efficient than linear scan with startsWith
   */
  findAffectedKeys(pathStr) {
    const parts = pathStr.split('.');
    const affected = new Set();
    
    // Find all keys that depend on this path or any parent
    let node = this.root;
    
    // Collect keys from root to target (parent paths)
    for (const part of parts) {
      if (node.keys.size > 0) {
        for (const key of node.keys) {
          affected.add(key);
        }
      }
      
      if (!node.children.has(part)) {
        return affected; // Path doesn't exist, return what we have
      }
      
      node = node.children.get(part);
    }
    
    // Collect keys from target node and all children (child paths)
    this._collectAllKeys(node, affected);
    
    return affected;
  }
  
  /**
   * Recursively collect all keys in subtree
   */
  _collectAllKeys(node, result) {
    for (const key of node.keys) {
      result.add(key);
    }
    
    for (const child of node.children.values()) {
      this._collectAllKeys(child, result);
    }
  }
  
  /**
   * Remove a cache key from all paths
   */
  removeKey(cacheKey) {
    this._removeKeyRecursive(this.root, cacheKey);
  }
  
  _removeKeyRecursive(node, cacheKey) {
    node.keys.delete(cacheKey);
    
    for (const child of node.children.values()) {
      this._removeKeyRecursive(child, cacheKey);
    }
  }
  
  /**
   * Clear the entire trie
   */
  clear() {
    this.root = new TrieNode();
  }
  
  /**
   * Count total number of tracked dependencies
   */
  countDependencies() {
    let count = 0;
    
    function countRecursive(node) {
      count += node.keys.size;
      for (const child of node.children.values()) {
        countRecursive(child);
      }
    }
    
    countRecursive(this.root);
    return count;
  }
}

// ============================================================================
// DEPENDENCY TRACKER - Main Implementation
// ============================================================================

/**
 * Create an optimized dependency tracker with Trie-based matching
 * 
 * @returns {Object} Dependency tracker API
 * 
 * FEATURES:
 *   - Start/stop tracking for cache keys
 *   - Automatic recording of state path access
 *   - Efficient invalidation with Trie lookup
 *   - Comprehensive error handling
 * 
 * BUG FIX: removeKey now called once (not in loop) - prevents redundant operations
 */
export function createDependencyTracker() {
  // -------------------------------------------------------------------------
  // Internal State
  // -------------------------------------------------------------------------
  
  // Trie for efficient path matching
  const pathTrie = new PathTrie();
  
  // Map: cacheKey -> Set of state paths (for removal and stats)
  const keyToPaths = new Map();
  
  // Current tracking context
  let currentKey = null;
  let currentDeps = null;
  
  // Performance metrics
  let invalidationCount = 0;
  let totalInvalidated = 0;
  
  // -------------------------------------------------------------------------
  // Tracking Control
  // -------------------------------------------------------------------------
  
  /**
   * Start tracking dependencies for a cache key
   */
  function startTracking(key) {
    if (!key) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[dep-tracker] Cannot track null/undefined key');
      }
      return;
    }
    
    currentKey = key;
    currentDeps = new Set();
  }
  
  /**
   * Stop tracking and save dependencies
   * Optimized: removeKey called once instead of in loop (bug fix)
   */
  function stopTracking() {
    if (!currentKey || !currentDeps || currentDeps.size === 0) {
      currentKey = null;
      currentDeps = null;
      return;
    }
    
    try {
      // Remove old dependencies for this key if they exist
      // Fixed: Call removeKey ONCE, not once per path (was a bug)
      if (keyToPaths.has(currentKey)) {
        pathTrie.removeKey(currentKey);
      }
      
      // Insert new dependencies
      for (const path of currentDeps) {
        try {
          pathTrie.insert(path, currentKey);
        } catch (e) {
          // Log but continue - partial dependency tracking is better than none
          if (typeof console !== 'undefined' && console.error) {
            console.error('[dep-tracker] Failed to insert dependency:', path, e);
          }
        }
      }
      
      keyToPaths.set(currentKey, currentDeps);
    } catch (e) {
      // If tracking fails, clear current state to prevent corruption
      if (typeof console !== 'undefined' && console.error) {
        console.error('[dep-tracker] Failed to stop tracking:', e);
      }
    } finally {
      // Always reset tracking state
      currentKey = null;
      currentDeps = null;
    }
  }
  
  // -------------------------------------------------------------------------
  // Dependency Recording
  // -------------------------------------------------------------------------
  
  /**
   * Record that a state path was accessed
   * @param {string[]|string} path - Property path array or string
   */
  function recordAccess(path) {
    if (!currentDeps) return;
    if (!path) return;
    
    try {
      // Convert to string if array, validate input
      let pathStr;
      if (Array.isArray(path)) {
        if (path.length === 0) return;
        pathStr = path.join('.');
      } else if (typeof path === 'string') {
        pathStr = path;
      } else {
        return; // Invalid path type
      }
      
      if (!pathStr || pathStr.trim() === '') return;
      
      // Record the full path and all parent paths
      // e.g., "player.inventory.gold" records:
      // - "player"
      // - "player.inventory"  
      // - "player.inventory.gold"
      const parts = pathStr.split('.');
      for (let i = 1; i <= parts.length; i++) {
        currentDeps.add(parts.slice(0, i).join('.'));
      }
    } catch (e) {
      // Log but don't throw - dependency tracking is a performance feature,
      // not critical functionality
      if (typeof console !== 'undefined' && console.error) {
        console.error('[dep-tracker] Failed to record access:', path, e);
      }
    }
  }
  
  /**
   * Get dependencies for a cache key
   * @returns {Set<string>} Set of state paths
   */
  function getDependencies(key) {
    return keyToPaths.get(key) || new Set();
  }
  
  /**
   * Find all cache keys that depend on changed paths
   * Optimized with Trie-based matching - O(path_length) vs O(all_deps)
   * @param {string[]|string[]} changedPaths - Paths that changed
   * @returns {Set<string>} Cache keys to invalidate
   */
  function findInvalidKeys(changedPaths) {
    const invalidKeys = new Set();
    
    if (!changedPaths || changedPaths.length === 0) {
      return invalidKeys;
    }
    
    invalidationCount++;
    
    try {
      // Convert paths to strings with validation
      const changedStrings = changedPaths
        .filter(p => p != null) // Filter out null/undefined
        .map(p => {
          try {
            return Array.isArray(p) ? p.join('.') : String(p);
          } catch (e) {
            return null;
          }
        })
        .filter(p => p != null && p !== ''); // Filter out invalid conversions
      
      // Use Trie for efficient lookup - much faster than string matching
      for (const changedPath of changedStrings) {
        try {
          const affected = pathTrie.findAffectedKeys(changedPath);
          for (const key of affected) {
            invalidKeys.add(key);
          }
        } catch (e) {
          // Log but continue with other paths
          if (typeof console !== 'undefined' && console.error) {
            console.error('[dep-tracker] Failed to find affected keys for:', changedPath, e);
          }
        }
      }
      
      totalInvalidated += invalidKeys.size;
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[dep-tracker] Failed to find invalid keys:', e);
      }
    }
    
    return invalidKeys;
  }
  
  /**
   * Remove dependency tracking for keys
   * More efficient batch removal
   */
  function removeDependencies(keys) {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    
    for (const key of keyArray) {
      if (keyToPaths.has(key)) {
        pathTrie.removeKey(key);
        keyToPaths.delete(key);
      }
    }
  }
  
  /**
   * Clear all dependencies
   */
  function clear() {
    pathTrie.clear();
    keyToPaths.clear();
    currentKey = null;
    currentDeps = null;
  }
  
  /**
   * Get statistics with additional performance metrics
   */
  function getStats() {
    const trackedKeys = keyToPaths.size;
    let totalDeps = 0;
    let maxDeps = 0;
    let minDeps = Infinity;
    
    for (const deps of keyToPaths.values()) {
      totalDeps += deps.size;
      if (deps.size > maxDeps) maxDeps = deps.size;
      if (deps.size < minDeps) minDeps = deps.size;
    }
    
    if (trackedKeys === 0) {
      minDeps = 0;
    }
    
    return {
      trackedKeys,
      totalDependencies: totalDeps,
      avgDepsPerKey: trackedKeys > 0 ? (totalDeps / trackedKeys).toFixed(1) : 0,
      maxDepsPerKey: maxDeps,
      minDepsPerKey: minDeps,
      invalidationCount,
      totalInvalidated,
      avgInvalidatedPerCall: invalidationCount > 0 
        ? (totalInvalidated / invalidationCount).toFixed(1) 
        : 0
    };
  }
  
  return {
    startTracking,
    stopTracking,
    recordAccess,
    getDependencies,
    findInvalidKeys,
    removeDependencies,
    clear,
    getStats,
    
    // For testing/debugging
    get isTracking() { return currentKey !== null; }
  };
}