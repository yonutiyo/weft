// engine/events.js
// Simple event bus for engine events

/**
 * Create an event bus
 */
export function createEventBus() {
  const listeners = new Map();
  
  /**
   * Register event listener
   * @returns {Function} Unsubscribe function
   */
  function on(event, fn) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add(fn);
    
    // Return unsubscribe function
    return () => off(event, fn);
  }
  
  /**
   * Remove event listener
   */
  function off(event, fn) {
    const set = listeners.get(event);
    if (set) {
      set.delete(fn);
    }
  }
  
  /**
   * Emit an event to all listeners
   */
  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    
    for (const fn of set) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[engine] Event "${event}" listener error:`, e);
      }
    }
  }
  
  /**
   * Remove all listeners for an event (or all events)
   */
  function clear(event) {
    if (event) {
      listeners.delete(event);
    } else {
      listeners.clear();
    }
  }
  
  /**
   * Get listener count for debugging
   */
  function getListenerCount(event) {
    if (event) {
      return listeners.get(event)?.size || 0;
    }
    let total = 0;
    for (const set of listeners.values()) {
      total += set.size;
    }
    return total;
  }
  
  return {
    on,
    off,
    emit,
    clear,
    getListenerCount
  };
}
