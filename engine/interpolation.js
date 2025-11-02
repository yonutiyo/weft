// engine/interpolation.js
// Template interpolation with dependency-tracked caching

import { createSmartCache } from "./cache.js";
import { compileExpression, evaluate, defaultHelpers } from "./expressions.js";
import { escapeHtml, hashObject } from "./utils.js";

/**
 * Create an interpolation system
 */
export function createInterpolator(options = {}) {
  const { maxCacheSize = 100 } = options;
  const cache = createSmartCache(maxCacheSize);
  
  /**
   * Interpolate a template with state
   * Uses dependency tracking for selective cache invalidation
   */
  function interpolate(html, passageId, state, helpers = defaultHelpers) {
    // Create cache key from passage ID and relevant state
    // We hash the state shallowly - the dependency tracker will handle the rest
    const stateHash = hashObject(state, 2);
    const cacheKey = `${passageId}:${stateHash}`;
    
    // Check cache
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    
    // Start dependency tracking
    const depTracker = cache.depTracker;
    depTracker.startTracking(cacheKey);
    
    try {
      // Perform interpolation
      const result = html.replace(
        /\{\{\{\s*([^}]+?)\s*\}\}\}|\{\{\s*([^}]+?)\s*\}\}/g,
        (match, rawExpr, escExpr) => {
          const expr = rawExpr ?? escExpr;
          
          try {
            const ast = compileExpression(expr);
            const val = evaluate(ast, { state, helpers, depTracker });
            
            if (val == null) return "";
            
            const str = String(val);
            return rawExpr ? str : escapeHtml(str);
          } catch (e) {
            console.error("[engine] Interpolation error:", expr, e);
            return match; // Return original on error
          }
        }
      );
      
      // Stop tracking and cache result
      depTracker.stopTracking();
      cache.set(cacheKey, result);
      
      return result;
    } catch (e) {
      depTracker.stopTracking();
      console.error("[engine] Interpolation failed:", e);
      return html;
    }
  }
  
  /**
   * Invalidate cache entries based on changed state paths
   */
  function invalidate(changedPaths) {
    return cache.invalidate(changedPaths);
  }
  
  /**
   * Clear entire cache
   */
  function clear() {
    cache.clear();
  }
  
  /**
   * Get cache statistics
   */
  function getStats() {
    return cache.getStats();
  }
  
  return {
    interpolate,
    invalidate,
    clear,
    getStats
  };
}
