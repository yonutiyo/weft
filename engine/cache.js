// engine/cache.js
// Intelligent caching with adaptive sizing and memory monitoring

import { createDependencyTracker } from "./dependency-tracker.js";
import { estimateSize } from "./utils.js";

/**
 * Create a smart cache with adaptive sizing and O(1) LRU eviction
 * Automatically adjusts cache size based on hit rates and memory pressure
 * Uses Map insertion order for constant-time eviction performance
 */
export function createSmartCache(initialSize = 200, options = {}) {
  const {
    minSize = 50,           // Minimum cache size
    maxSize = 1000,         // Maximum cache size
    targetHitRate = 0.7,    // Target cache hit rate (70%)
    adaptInterval = 100,    // Adjust size every N operations
    memoryLimit = 50 * 1024 * 1024, // 50MB memory limit (rough)
    enableAdaptive = true   // Enable dynamic sizing
  } = options;
  
  const cache = new Map();
  const depTracker = createDependencyTracker();
  
  // Performance tracking
  let hits = 0;
  let misses = 0;
  let operations = 0;
  let evictions = 0;
  let currentMaxSize = initialSize;
  let totalMemoryEstimate = 0;
  
  // Last adaptation
  let lastAdaptation = 0;
  
  /**
   * Adaptive sizing - adjust cache size based on performance
   */
  function adaptCacheSize() {
    if (!enableAdaptive) return;
    
    const totalOps = hits + misses;
    if (totalOps === 0) return;
    
    const hitRate = hits / totalOps;
    const avgEntrySize = totalMemoryEstimate / (cache.size || 1);
    
    // If hit rate is below target and we have room, grow cache
    if (hitRate < targetHitRate && currentMaxSize < maxSize) {
      // Check memory pressure
      if (totalMemoryEstimate < memoryLimit * 0.8) {
        const newSize = Math.min(
          Math.ceil(currentMaxSize * 1.2), // Grow 20%
          maxSize
        );
        currentMaxSize = newSize;
      }
    }
    // If hit rate is great and memory pressure is high, can shrink slightly
    else if (hitRate > targetHitRate + 0.1 && totalMemoryEstimate > memoryLimit * 0.9) {
      const newSize = Math.max(
        Math.floor(currentMaxSize * 0.9), // Shrink 10%
        minSize
      );
      currentMaxSize = newSize;
      
      // Evict excess entries
      while (cache.size > currentMaxSize) {
        evictOldest();
      }
    }
    
    lastAdaptation = operations;
  }
  
  /**
   * Get value from cache
   */
  function get(key) {
    operations++;
    
    const entry = cache.get(key);
    if (!entry) {
      misses++;
      
      // Periodic adaptation check
      if (enableAdaptive && operations - lastAdaptation >= adaptInterval) {
        adaptCacheSize();
      }
      
      return undefined;
    }
    
    hits++;
    
    // Move to end (most recent) to maintain LRU order
    // This is O(1) and leverages Map's insertion order for O(1) eviction
    entry.lastAccess = Date.now();
    entry.accessCount++;
    
    // Re-insert at end to mark as most recently used
    cache.delete(key);
    cache.set(key, entry);
    
    return entry.value;
  }
  
  /**
   * Set value in cache with memory estimation
   */
  function set(key, value) {
    // Estimate memory for new entry
    const estimatedSize = estimateSize(value);
    
    // Check memory limit before adding
    if (totalMemoryEstimate + estimatedSize > memoryLimit && !cache.has(key)) {
      // Memory pressure - evict multiple entries
      const targetReduction = estimatedSize * 2;
      let freed = 0;
      
      while (freed < targetReduction && cache.size > minSize) {
        const evictedSize = evictOldest();
        freed += evictedSize;
      }
    }
    
    // Enforce size limit with LRU eviction
    if (cache.size >= currentMaxSize && !cache.has(key)) {
      evictOldest();
    }
    
    // Update memory tracking
    if (cache.has(key)) {
      const oldEntry = cache.get(key);
      totalMemoryEstimate -= oldEntry.size;
    }
    
    cache.set(key, {
      value,
      lastAccess: Date.now(),
      created: Date.now(),
      accessCount: 0,
      size: estimatedSize
    });
    
    totalMemoryEstimate += estimatedSize;
  }
  
  /**
   * Evict oldest entry using Map insertion order (O(1) operation)
   * Returns size of evicted entry
   * 
   * Map maintains insertion order, and we move accessed items to the end,
   * so the first entry is always the least recently used.
   */
  function evictOldest() {
    if (cache.size === 0) return 0;
    
    // Get the first (oldest) entry from the Map
    const firstKey = cache.keys().next().value;
    
    if (firstKey !== undefined) {
      const entry = cache.get(firstKey);
      const size = entry.size;
      
      cache.delete(firstKey);
      depTracker.removeDependencies([firstKey]);
      evictions++;
      totalMemoryEstimate -= size;
      
      return size;
    }
    
    return 0;
  }
  
  /**
   * Check if key exists
   */
  function has(key) {
    return cache.has(key);
  }
  
  /**
   * Delete a specific key
   */
  function del(key) {
    if (cache.has(key)) {
      const entry = cache.get(key);
      totalMemoryEstimate -= entry.size;
      cache.delete(key);
      depTracker.removeDependencies([key]);
    }
  }
  
  /**
   * Clear entire cache
   */
  function clear() {
    cache.clear();
    depTracker.clear();
    totalMemoryEstimate = 0;
    hits = 0;
    misses = 0;
    evictions = 0;
  }
  
  /**
   * Invalidate cache entries based on changed state paths
   * This is the key optimization - only invalidate what changed
   */
  function invalidate(changedPaths) {
    if (!changedPaths || changedPaths.length === 0) {
      // No specific paths - clear everything (fallback behavior)
      clear();
      return 0;
    }
    
    const keysToInvalidate = depTracker.findInvalidKeys(changedPaths);
    
    for (const key of keysToInvalidate) {
      if (cache.has(key)) {
        const entry = cache.get(key);
        totalMemoryEstimate -= entry.size;
        cache.delete(key);
      }
    }
    
    depTracker.removeDependencies(keysToInvalidate);
    
    return keysToInvalidate.size;
  }
  
  /**
   * Get current size
   */
  function size() {
    return cache.size;
  }
  
  /**
   * Get comprehensive cache statistics
   */
  function getStats() {
    const now = Date.now();
    let totalAge = 0;
    let newestAge = Infinity;
    let oldestAge = 0;
    let totalAccessCount = 0;
    let maxAccessCount = 0;
    
    for (const entry of cache.values()) {
      const age = now - entry.created;
      totalAge += age;
      if (age < newestAge) newestAge = age;
      if (age > oldestAge) oldestAge = age;
      
      totalAccessCount += entry.accessCount;
      if (entry.accessCount > maxAccessCount) {
        maxAccessCount = entry.accessCount;
      }
    }
    
    const totalOps = hits + misses;
    const hitRate = totalOps > 0 ? hits / totalOps : 0;
    
    return {
      size: cache.size,
      maxSize: currentMaxSize,
      initialMaxSize: initialSize,
      utilization: cache.size / currentMaxSize,
      
      // Performance metrics
      hits,
      misses,
      hitRate: (hitRate * 100).toFixed(1) + '%',
      evictions,
      
      // Memory metrics
      memoryEstimate: `${(totalMemoryEstimate / 1024 / 1024).toFixed(2)} MB`,
      memoryLimit: `${(memoryLimit / 1024 / 1024).toFixed(2)} MB`,
      memoryPressure: ((totalMemoryEstimate / memoryLimit) * 100).toFixed(1) + '%',
      avgEntrySize: cache.size > 0 
        ? `${(totalMemoryEstimate / cache.size / 1024).toFixed(2)} KB`
        : '0 KB',
      
      // Age metrics
      avgAge: cache.size > 0 ? Math.round(totalAge / cache.size) : 0,
      newestAge: isFinite(newestAge) ? Math.round(newestAge) : 0,
      oldestAge: Math.round(oldestAge),
      
      // Access metrics
      avgAccessCount: cache.size > 0 
        ? (totalAccessCount / cache.size).toFixed(1)
        : 0,
      maxAccessCount,
      
      // Dependency tracking
      ...depTracker.getStats()
    };
  }
  
  /**
   * Force cache size adjustment (for testing or manual control)
   */
  function setMaxSize(newSize) {
    currentMaxSize = Math.max(minSize, Math.min(newSize, maxSize));
    
    while (cache.size > currentMaxSize) {
      evictOldest();
    }
  }
  
  /**
   * Reset statistics
   */
  function resetStats() {
    hits = 0;
    misses = 0;
    operations = 0;
    evictions = 0;
    lastAdaptation = 0;
  }
  
  return {
    get,
    set,
    has,
    delete: del,
    clear,
    invalidate,
    size,
    getStats,
    setMaxSize,
    resetStats,
    
    // Expose dependency tracker for recording during evaluation
    get depTracker() { return depTracker; },
    
    // Current configuration
    get currentMaxSize() { return currentMaxSize; },
    get hitRate() { 
      const total = hits + misses;
      return total > 0 ? hits / total : 0;
    }
  };
}

/**
 * Create a simple LRU cache without dependency tracking
 * Useful for expression ASTs and other non-state-dependent data
 * Optimized with Map iteration order
 */
export function createLRUCache(maxSize = 1000) {
  const cache = new Map();
  
  function get(key) {
    if (!cache.has(key)) return undefined;
    
    // Move to end (most recent) by delete and re-insert
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }
  
  function set(key, value) {
    // Delete if exists (to re-insert at end)
    if (cache.has(key)) {
      cache.delete(key);
    } else if (cache.size >= maxSize) {
      // Delete oldest (first) entry - Map maintains insertion order
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    
    cache.set(key, value);
  }
  
  function has(key) {
    return cache.has(key);
  }
  
  function clear() {
    cache.clear();
  }
  
  function size() {
    return cache.size;
  }
  
  return { get, set, has, clear, size };
}