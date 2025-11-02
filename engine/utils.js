// engine/utils.js
// Shared utility functions with performance optimizations

export const DEV = new URLSearchParams(location.search).get("dev") === "1";

/**
 * Memory-efficient deep clone with multiple strategies
 * 1. structuredClone (fastest, native)
 * 2. JSON (fast, but limited types)
 * 3. Manual recursive (slowest, most compatible)
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  
  // Try native structuredClone first (fastest)
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(obj);
    } catch (e) {
      if (DEV) console.warn("[engine] structuredClone failed, using fallback", e);
    }
  }
  
  // JSON fallback for simple objects (2-3x faster than manual)
  try {
    // Quick type check - if it's a simple object, use JSON
    if (isJSONSafe(obj)) {
      return JSON.parse(JSON.stringify(obj));
    }
  } catch {}
  
  // Manual recursive clone for complex objects
  return manualClone(obj);
}

/**
 * Quick check if object can be safely JSON serialized
 * Avoids functions, undefined, symbols, etc.
 */
function isJSONSafe(obj, depth = 0) {
  if (depth > 10) return false; // Prevent deep recursion check
  
  if (obj === null) return true;
  
  const type = typeof obj;
  if (type === 'number' || type === 'string' || type === 'boolean') return true;
  if (type !== 'object') return false;
  
  if (Array.isArray(obj)) {
    return obj.length < 100 || depth === 0; // Quick check for arrays
  }
  
  // Check for Date, RegExp, etc.
  if (obj instanceof Date || obj instanceof RegExp) return false;
  
  // Check a few properties
  let checked = 0;
  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    if (checked++ > 20) return true; // Assume safe if many props
    
    const val = obj[key];
    const valType = typeof val;
    if (valType === 'function' || valType === 'symbol' || val === undefined) {
      return false;
    }
    if (valType === 'object' && val !== null) {
      if (!isJSONSafe(val, depth + 1)) return false;
    }
  }
  
  return true;
}

/**
 * Manual deep clone for complex objects
 */
function manualClone(obj, seen = new WeakMap()) {
  if (obj === null || typeof obj !== 'object') return obj;
  
  // Handle circular references
  if (seen.has(obj)) return seen.get(obj);
  
  // Handle special objects
  if (obj instanceof Date) return new Date(obj);
  if (obj instanceof RegExp) return new RegExp(obj);
  if (obj instanceof Map) {
    const copy = new Map();
    seen.set(obj, copy);
    for (const [k, v] of obj) copy.set(k, manualClone(v, seen));
    return copy;
  }
  if (obj instanceof Set) {
    const copy = new Set();
    seen.set(obj, copy);
    for (const v of obj) copy.add(manualClone(v, seen));
    return copy;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    const copy = [];
    seen.set(obj, copy);
    for (let i = 0; i < obj.length; i++) {
      copy[i] = manualClone(obj[i], seen);
    }
    return copy;
  }
  
  // Handle plain objects
  const copy = Object.create(Object.getPrototypeOf(obj));
  seen.set(obj, copy);
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      copy[key] = manualClone(obj[key], seen);
    }
  }
  
  return copy;
}

/**
 * Differential clone - only clone changed paths
 * Much more memory efficient for state snapshots
 * @param {Object} obj - Object to clone
 * @param {string[][]} changedPaths - Paths that changed (e.g., [['player', 'health']])
 * @returns {Object} Shallow copy with deep clones only where needed
 */
export function differentialClone(obj, changedPaths) {
  if (!changedPaths || changedPaths.length === 0) {
    return deepClone(obj); // Fallback to full clone
  }
  
  // Create shallow copy of root
  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  
  // For each changed path, deep clone that branch
  for (const path of changedPaths) {
    if (path.length === 0) continue;
    
    // Navigate to parent and clone the changed subtree
    let current = result;
    let original = obj;
    
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      
      // Shallow copy intermediate objects
      if (current[key] === original[key]) {
        current[key] = Array.isArray(original[key]) 
          ? [...original[key]]
          : { ...original[key] };
      }
      
      current = current[key];
      original = original[key];
      
      if (current === null || typeof current !== 'object') break;
    }
    
    // Deep clone the final changed value
    const finalKey = path[path.length - 1];
    if (current && typeof current === 'object') {
      current[finalKey] = deepClone(original[finalKey]);
    }
  }
  
  return result;
}

/**
 * Estimate memory usage of an object (rough approximation)
 * Useful for adaptive memory management
 */
export function estimateSize(obj, visited = new WeakSet()) {
  if (obj === null || obj === undefined) return 0;
  
  const type = typeof obj;
  
  // Primitives
  if (type === 'boolean') return 4;
  if (type === 'number') return 8;
  if (type === 'string') return obj.length * 2; // Rough UTF-16 estimate
  if (type !== 'object') return 8;
  
  // Avoid circular references
  if (visited.has(obj)) return 0;
  visited.add(obj);
  
  let size = 0;
  
  // Arrays
  if (Array.isArray(obj)) {
    size = 8; // Array overhead
    for (let i = 0; i < Math.min(obj.length, 1000); i++) { // Sample large arrays
      size += estimateSize(obj[i], visited);
    }
    if (obj.length > 1000) {
      size += (obj.length - 1000) * 8; // Estimate remainder
    }
    return size;
  }
  
  // Objects
  size = 16; // Object overhead
  let propCount = 0;
  
  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    if (propCount++ > 100) { // Sample large objects
      size += 16; // Rough per-property estimate
      continue;
    }
    
    size += key.length * 2; // Key name
    size += estimateSize(obj[key], visited);
  }
  
  return size;
}

/**
 * Freeze object deeply in dev mode for immutability checks
 * Optimized to cache frozen status
 */
export function deepFreeze(o) {
  if (!DEV) return o;
  if (!o || typeof o !== 'object') return o;
  if (Object.isFrozen(o)) return o; // Already frozen
  
  Object.freeze(o);
  
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      deepFreeze(v);
    }
  }
  
  return o;
}

/**
 * Simple hash function for cache keys - FNV-1a variant for better distribution
 */
export function hashString(str) {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }
  return (hash >>> 0).toString(36);
}

/**
 * Fast hash for small objects - only hashes structure
 */
export function hashObject(obj, maxDepth = 3) {
  if (obj == null || maxDepth <= 0) return "null";
  
  const type = typeof obj;
  if (type === "string") return `s:${hashString(obj)}`;
  if (type === "number" || type === "boolean") return `${type[0]}:${obj}`;
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "a:[]";
    const items = obj.slice(0, 10).map(v => hashObject(v, maxDepth - 1));
    return `a:[${items.join(",")}]`;
  }
  
  if (type === "object") {
    const keys = Object.keys(obj).sort().slice(0, 20);
    if (keys.length === 0) return "o:{}";
    const pairs = keys.map(k => `${k}:${hashObject(obj[k], maxDepth - 1)}`);
    return `o:{${pairs.join(",")}}`;
  }
  
  return type;
}

/**
 * HTML escape for interpolation
 */
export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

/**
 * Efficient shallow equality check
 */
export function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  
  return true;
}

/**
 * Get nested property safely
 */
export function getAt(obj, pathArr) {
  let cur = obj;
  for (let i = 0; i < pathArr.length; i++) {
    if (cur == null) return undefined;
    cur = cur[pathArr[i]];
  }
  return cur;
}

/**
 * Set nested property, creating intermediate objects
 */
export function setAt(obj, pathArr, value) {
  let cur = obj;
  for (let i = 0; i < pathArr.length - 1; i++) {
    const k = pathArr[i];
    if (typeof cur[k] !== "object" || cur[k] === null) {
      cur[k] = {};
    }
    cur = cur[k];
  }
  cur[pathArr[pathArr.length - 1]] = value;
}

/**
 * Type coercion helpers for operations
 */
export function toNumber(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export function toNumberOrString(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") return v;
  const n = Number(v);
  return isNaN(n) ? String(v) : n;
}

/**
 * Split string by delimiter at top level (respecting nesting)
 */
export function splitTopLevel(src, delim) {
  const out = [];
  let depthPar = 0, depthBrk = 0, depthBrc = 0, inStr = 0;
  let last = 0;
  
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    
    if (inStr === 1) {
      if (ch === "\\") i++;
      else if (ch === "'") inStr = 0;
      continue;
    }
    if (inStr === 2) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = 0;
      continue;
    }
    
    if (ch === "'") { inStr = 1; continue; }
    if (ch === '"') { inStr = 2; continue; }
    if (ch === "(") depthPar++;
    else if (ch === ")") depthPar = Math.max(0, depthPar - 1);
    else if (ch === "[") depthBrk++;
    else if (ch === "]") depthBrk = Math.max(0, depthBrk - 1);
    else if (ch === "{") depthBrc++;
    else if (ch === "}") depthBrc = Math.max(0, depthBrc - 1);
    
    if (depthPar === 0 && depthBrk === 0 && depthBrc === 0 &&
        src.slice(i, i + delim.length) === delim) {
      out.push(src.slice(last, i));
      last = i + delim.length;
    }
  }
  
  out.push(src.slice(last));
  return out;
}

/**
 * Debounce - delay execution until after wait period of inactivity
 * Returns a function that, as long as it continues to be invoked, won't be triggered
 */
export function debounce(fn, wait = 300) {
  let timeoutId = null;
  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Throttle - limit execution to once per wait period
 * Ensures function is called at most once per wait period
 */
export function throttle(fn, wait = 300) {
  let lastCall = 0;
  let timeoutId = null;
  return function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - lastCall);
    
    clearTimeout(timeoutId);
    
    if (remaining <= 0) {
      lastCall = now;
      return fn.apply(this, args);
    } else {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        fn.apply(this, args);
      }, remaining);
    }
  };
}

/**
 * Memoize with LRU cache and optional TTL
 * @param {Function} fn - Function to memoize
 * @param {Object} options - { maxSize: 100, ttl: null (ms) }
 */
export function memoize(fn, { maxSize = 100, ttl = null } = {}) {
  const cache = new Map();
  const timestamps = ttl ? new Map() : null;
  
  return function memoized(...args) {
    const key = hashObject(args);
    
    // Check TTL if enabled
    if (ttl && timestamps.has(key)) {
      if (Date.now() - timestamps.get(key) > ttl) {
        cache.delete(key);
        timestamps.delete(key);
      }
    }
    
    if (cache.has(key)) {
      // Move to end (LRU)
      const value = cache.get(key);
      cache.delete(key);
      cache.set(key, value);
      return value;
    }
    
    const result = fn.apply(this, args);
    
    // Enforce size limit
    if (cache.size >= maxSize) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
      timestamps?.delete(firstKey);
    }
    
    cache.set(key, result);
    timestamps?.set(key, Date.now());
    
    return result;
  };
}

/**
 * Deep equality check - optimized for common cases
 * @param {*} a - First value
 * @param {*} b - Second value
 * @param {number} depth - Maximum recursion depth
 */
export function deepEqual(a, b, depth = 0) {
  if (a === b) return true;
  if (depth > 10) return false; // Prevent stack overflow
  
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }
  
  // Quick type checks
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a.constructor !== b.constructor) return false;
  
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key], depth + 1)) return false;
  }
  
  return true;
}

/**
 * Get differences between two objects - useful for change tracking
 * Returns { added, removed, changed } with arrays of paths
 * @param {Object} oldObj - Previous object state
 * @param {Object} newObj - New object state
 * @param {string[]} path - Current path (for recursion)
 */
export function diff(oldObj, newObj, path = []) {
  const changes = { added: [], removed: [], changed: [] };
  
  const oldKeys = new Set(Object.keys(oldObj || {}));
  const newKeys = new Set(Object.keys(newObj || {}));
  
  // Find added keys
  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      changes.added.push([...path, key]);
    }
  }
  
  // Find removed keys
  for (const key of oldKeys) {
    if (!newKeys.has(key)) {
      changes.removed.push([...path, key]);
    }
  }
  
  // Find changed keys
  for (const key of oldKeys) {
    if (!newKeys.has(key)) continue;
    
    const oldVal = oldObj[key];
    const newVal = newObj[key];
    
    if (oldVal === newVal) continue;
    
    if (typeof oldVal === 'object' && typeof newVal === 'object' && 
        oldVal !== null && newVal !== null) {
      const nested = diff(oldVal, newVal, [...path, key]);
      changes.added.push(...nested.added);
      changes.removed.push(...nested.removed);
      changes.changed.push(...nested.changed);
    } else {
      changes.changed.push([...path, key]);
    }
  }
  
  return changes;
}

/**
 * Get nested value using string path "player.inventory.gold"
 * @param {Object} obj - Object to query
 * @param {string|string[]} path - Dot-separated path or array of keys
 */
export function getPath(obj, path) {
  if (typeof path === 'string') {
    path = path.split('.');
  }
  return getAt(obj, path);
}

/**
 * Set nested value using string path "player.inventory.gold"
 * @param {Object} obj - Object to modify
 * @param {string|string[]} path - Dot-separated path or array of keys
 * @param {*} value - Value to set
 */
export function setPath(obj, path, value) {
  if (typeof path === 'string') {
    path = path.split('.');
  }
  return setAt(obj, path, value);
}
