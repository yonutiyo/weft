// engine/state.js
// Optimized state management with structural sharing

import { 
  getAt, 
  setAt, 
  toNumber, 
  splitTopLevel, 
  DEV 
} from "./utils.js";
import { compileExpression, evaluate, lvaluePathFromAst, defaultHelpers } from "./expressions.js";

/**
 * Structural sharing - only copy changed paths, reuse unchanged objects
 */
function structuralClone(obj, changedPaths = []) {
  if (changedPaths.length === 0) {
    return { ...obj };
  }
  
  const result = { ...obj };
  
  for (const path of changedPaths) {
    if (path.length === 0) continue;
    
    let current = result;
    let original = obj;
    
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (current[key] === original[key]) {
        current[key] = Array.isArray(original[key]) ? [...original[key]] : { ...original[key] };
      }
      current = current[key];
      original = original[key];
      if (current === null || typeof current !== 'object') break;
    }
  }
  
  return result;
}

export function createStateManager(options = {}) {
  const { maxHistory = 50, onHistoryChange, onStateChange } = options;
  
  let state = {
    meta: { visited: {}, turns: 0, playTime: 0, startTime: Date.now() }
  };
  
  const visitedSet = new Set();
  const undoStack = [];
  const redoStack = [];
  let isUndoRedo = false;
  let currentPassage = null;
  
  const pathCache = new Map();
  const MAX_PATH_CACHE = 2000;
  
  function getState() {
    return DEV && Object.freeze ? Object.freeze({ ...state }) : { ...state };
  }
  
  function getRawState() {
    return state;
  }
  
  function parsePathStringToArray(pathStr) {
    if (pathCache.has(pathStr)) return pathCache.get(pathStr);
    const ast = compileExpression(pathStr);
    const arr = lvaluePathFromAst(ast);
    if (!arr) throw new Error(`Not a valid path: ${pathStr}`);
    if (pathCache.size < MAX_PATH_CACHE) pathCache.set(pathStr, arr);
    return arr;
  }
  
  function createSnapshot(changedPaths = []) {
    return {
      state: structuralClone(state, changedPaths),
      passage: currentPassage,
      timestamp: Date.now()
    };
  }
  
  function pushUndo(snapshot) {
    undoStack.push(snapshot);
    if (undoStack.length > maxHistory) undoStack.shift();
    if (onHistoryChange) {
      onHistoryChange({ historyLength: undoStack.length, redoLength: redoStack.length });
    }
  }
  
  function setState(patch = {}, opts = {}) {
    const { recordHistory = true } = opts;
    const changedPaths = [];
    const outPatch = {};
    
    if (recordHistory && !isUndoRedo) {
      pushUndo(createSnapshot([]));
      redoStack.length = 0;
    }
    
    for (const [k, v] of Object.entries(patch)) {
      const path = typeof k === "string" && (k.includes(".") || k.includes("["))
        ? parsePathStringToArray(k) : [k];
      const before = getAt(state, path);
      if (before !== v) {
        setAt(state, path, v);
        changedPaths.push(path);
        outPatch[k] = v;
      }
    }
    
    const changed = changedPaths.length > 0;
    if (changed && onStateChange) {
      onStateChange({ patch: outPatch, changedPaths, state: getState() });
    }
    
    return { changed, changedPaths };
  }
  
  function set(key, value, opts) {
    return setState({ [key]: value }, opts);
  }
  
  function applySetStatements(setStr, passageId = null) {
    if (!setStr || !setStr.trim()) {
      return { changed: false, changedPaths: [], patch: {} };
    }
    
    const changedPaths = [];
    const patch = {};
    
    if (!isUndoRedo) {
      pushUndo(createSnapshot([]));
      redoStack.length = 0;
    }
    
    const stmts = splitTopLevel(setStr, ";");
    
    for (const stmtRaw of stmts) {
      const stmt = stmtRaw.trim();
      if (!stmt) continue;
      
      try {
        const m = stmt.match(/^(.+?)(=|\+=|-=|\*=|\/=)(.+)$/);
        if (!m) continue;
        
        const [, leftStr, op, rightStr] = m;
        const left = leftStr.trim();
        const right = rightStr.trim();
        
        const pathArr = parsePathStringToArray(left);
        const pathStr = pathArr.join('.');
        const currentVal = getAt(state, pathArr);
        
        const helpers = { ...defaultHelpers, ...state };
        const rightAst = compileExpression(right);
        const rightVal = evaluate(rightAst, { state, helpers });
        
        let nextVal;
        if (op === "=") nextVal = rightVal;
        else if (op === "+=") nextVal = toNumber(currentVal) + toNumber(rightVal);
        else if (op === "-=") nextVal = toNumber(currentVal) - toNumber(rightVal);
        else if (op === "*=") nextVal = toNumber(currentVal) * toNumber(rightVal);
        else if (op === "/=") {
          const divisor = toNumber(rightVal);
          nextVal = divisor !== 0 ? toNumber(currentVal) / divisor : currentVal;
        }
        
        if (currentVal !== nextVal) {
          setAt(state, pathArr, nextVal);
          changedPaths.push(pathArr);
          patch[pathStr] = nextVal;
        }
      } catch (e) {
        if (DEV) console.error("[engine] Error in set statement:", stmt, e);
      }
    }
    
    const changed = changedPaths.length > 0;
    if (changed && onStateChange) {
      onStateChange({ patch, changedPaths, state: getState() });
    }
    
    return { changed, changedPaths, patch };
  }
  
  function markVisited(passageId) {
    visitedSet.add(passageId);
    state.meta = state.meta || {};
    state.meta.visited = state.meta.visited || {};
    state.meta.visited[passageId] = true;
    
    // Update current passage tracker (called after navigation completes)
    currentPassage = passageId;
  }
  
  function isVisited(passageId) {
    return visitedSet.has(passageId);
  }
  
  function incrementTurn() {
    state.meta.turns = (state.meta.turns || 0) + 1;
  }
  
  /**
   * Called before navigation with the CURRENT passage ID
   * Saves a snapshot of current state+passage before we leave
   */
  function setHistoryPassage(passageId) {
    if (isUndoRedo) return;
    
    // Save snapshot when leaving a passage (skip if null/undefined)
    if (passageId !== null && passageId !== undefined) {
      const snapshot = createSnapshot([]);
      snapshot.passage = passageId;
      pushUndo(snapshot);
      redoStack.length = 0;
    }
  }
  
  /**
   * Undo - go back to previous passage
   */
  function undo() {
    if (undoStack.length === 0) return null;
    
    // Save current state to redo stack
    const currentSnapshot = createSnapshot([]);
    redoStack.push(currentSnapshot);
    
    // Restore previous state
    const snapshot = undoStack.pop();
    
    isUndoRedo = true;
    state = snapshot.state;
    currentPassage = snapshot.passage;
    isUndoRedo = false;
    
    if (onHistoryChange) {
      onHistoryChange({ historyLength: undoStack.length, redoLength: redoStack.length });
    }
    
    return snapshot;
  }
  
  /**
   * Redo - go forward to next passage
   */
  function redo() {
    if (redoStack.length === 0) return null;
    
    // Save current state to undo stack
    const currentSnapshot = createSnapshot([]);
    undoStack.push(currentSnapshot);
    
    // Restore next state
    const snapshot = redoStack.pop();
    
    isUndoRedo = true;
    state = snapshot.state;
    currentPassage = snapshot.passage;
    isUndoRedo = false;
    
    if (onHistoryChange) {
      onHistoryChange({ historyLength: undoStack.length, redoLength: redoStack.length });
    }
    
    return snapshot;
  }
  
  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }
  
  function clearHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    if (onHistoryChange) onHistoryChange({ historyLength: 0, redoLength: 0 });
  }
  
  function getMemoryStats() {
    return {
      historyLength: undoStack.length,
      redoLength: redoStack.length,
      maxHistory,
      pathCacheSize: pathCache.size
    };
  }
  
  return {
    getState, getRawState, setState, set, applySetStatements,
    markVisited, isVisited, incrementTurn,
    undo, redo, canUndo, canRedo, clearHistory,
    setHistoryPassage, getMemoryStats,
    get historyLength() { return undoStack.length; },
    get redoLength() { return redoStack.length; }
  };
}