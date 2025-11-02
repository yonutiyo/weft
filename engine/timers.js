// engine/timers.js
// Timer system with automatic cleanup

/**
 * Create a timer manager
 */
export function createTimerManager() {
  const timers = new Map();
  let nextTimerId = 1;
  
  /**
   * Set a timer that fires after delay
   * @param {Function} callback - Function to call
   * @param {number} delay - Delay in milliseconds
   * @returns {number} Timer ID
   */
  function after(callback, delay) {
    const id = nextTimerId++;
    const timeoutId = setTimeout(() => {
      timers.delete(id);
      try {
        callback();
      } catch (e) {
        console.error("[engine] Timer callback error:", e);
      }
    }, delay);
    
    timers.set(id, {
      id,
      delay,
      callback,
      repeating: false,
      timeoutId
    });
    
    return id;
  }
  
  /**
   * Set a repeating timer
   * @param {Function} callback - Function to call
   * @param {number} interval - Interval in milliseconds
   * @returns {number} Timer ID
   */
  function every(callback, interval) {
    const id = nextTimerId++;
    const intervalId = setInterval(() => {
      try {
        callback();
      } catch (e) {
        console.error("[engine] Timer callback error:", e);
      }
    }, interval);
    
    timers.set(id, {
      id,
      delay: interval,
      callback,
      repeating: true,
      intervalId
    });
    
    return id;
  }
  
  /**
   * Clear a timer
   * @param {number} timerId - Timer ID to clear
   */
  function clearTimer(timerId) {
    const timer = timers.get(timerId);
    if (!timer) return;
    
    if (timer.repeating) {
      clearInterval(timer.intervalId);
    } else {
      clearTimeout(timer.timeoutId);
    }
    
    timers.delete(timerId);
  }
  
  /**
   * Clear all timers (called on passage navigation)
   */
  function clearAll() {
    for (const [id] of timers) {
      clearTimer(id);
    }
  }
  
  /**
   * Get timer count
   */
  function count() {
    return timers.size;
  }
  
  return {
    after,
    every,
    clearTimer,
    clearAll,
    count
  };
}
