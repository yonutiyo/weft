// engine.js — Modular interactive fiction engine
// This file re-exports the new modular engine for backward compatibility

export { createEngine, createMemoryProvider } from "./engine/core.js";
export { DEV } from "./engine/utils.js";

// Note: The engine has been refactored into modules:
// - engine/core.js - Main engine factory
// - engine/state.js - State management
// - engine/expressions.js - Expression evaluation
// - engine/interpolation.js - Template interpolation
// - engine/cache.js - Smart caching
// - engine/dependency-tracker.js - Dependency tracking
// - engine/rendering.js - DOM rendering
// - engine/routing.js - Hash routing
// - engine/timers.js - Timer system
// - engine/events.js - Event bus
// - engine/utils.js - Shared utilities
//
// Key improvements:
// ✓ Dependency tracking for selective cache invalidation
// ✓ Optimized state management
// ✓ Better modularity and testability
// ✓ Reduced memory usage
// ✓ Faster cache operations
