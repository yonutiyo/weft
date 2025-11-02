// save-manager.js
// Handles saving/loading game state and managing save slots
// Now using IndexedDB for non-blocking async storage

import { StorageDB, migrateFromLocalStorage } from './storage-db.js';

export class SaveManager {
  constructor(engine, options = {}) {
    this.engine = engine;
    this.storagePrefix = options.storagePrefix || 'if-save';
    this.maxSlots = options.maxSlots || 10;
    this.maxAutoSaves = options.maxAutoSaves || 3;
    
    // IndexedDB instance
    this.db = new StorageDB('game-storage', 'saves');
    
    // Track last auto-save state to prevent duplicates
    this.lastAutoSaveHash = null;
    
    // Track if we're currently saving (prevent concurrent auto-saves)
    this.isSaving = false;
    
    // Auto-save on navigation if enabled
    this.autoSaveEnabled = options.autoSave !== false;
    if (this.autoSaveEnabled) {
      this.engine.on('navigate', () => this.autoSave());
    }
    
    // Initialize and migrate if needed
    this.ready = this.init(options.migrate !== false);
  }

  /**
   * Initialize the database and optionally migrate from localStorage
   */
  async init(migrate = true) {
    try {
      await this.db.ready;
      
      if (migrate) {
        // Check if we need to migrate
        const existingKeys = await this.db.getAllKeys();
        const hasData = existingKeys.some(k => k.startsWith(this.storagePrefix));
        
        if (!hasData) {
          // No data in IndexedDB, try migrating from localStorage
          const migrated = await migrateFromLocalStorage(this.storagePrefix, this.db);
          if (migrated > 0) {
            console.log(`[SaveManager] Migrated ${migrated} saves from localStorage`);
          }
        }
      }
    } catch (e) {
      console.error('[SaveManager] Initialization failed:', e);
    }
  }

  /**
   * Ensure database is ready before operations
   */
  async ensureReady() {
    await this.ready;
  }

  // Create a hash of state for comparison
  createStateHash(state, passage) {
    return JSON.stringify({ state, passage });
  }

  // Create a save state snapshot
  createSaveState(slotName = null) {
    const state = this.engine.getState();
    const currentPassage = this.engine.current;
    
    return {
      version: 1,
      timestamp: Date.now(),
      passage: currentPassage,
      state: state,
      slotName: slotName,
      meta: {
        playTime: null, // Will be filled in by save()
        turns: this.getTurnCount()
      }
    };
  }

  /**
   * Save to a named slot (async, non-blocking)
   */
  async save(slotName) {
    try {
      await this.ensureReady();
      
      const saveData = this.createSaveState(slotName);
      
      // Calculate play time (async)
      saveData.meta.playTime = await this.calculatePlayTime();
      
      const key = `${this.storagePrefix}:${slotName}`;
      
      // Store as JSON string for consistency with old format
      await this.db.setItem(key, JSON.stringify(saveData));
      
      return { success: true, slot: slotName };
    } catch (e) {
      console.error('[SaveManager] Save failed:', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * Load from a named slot (async)
   */
  async load(slotName) {
    try {
      await this.ensureReady();
      
      const key = `${this.storagePrefix}:${slotName}`;
      const data = await this.db.getItem(key);
      
      if (!data) {
        return { success: false, error: 'Save not found' };
      }

      const saveData = JSON.parse(data);
      
      // Restore state
      this.engine.setState(saveData.state, { reRender: false });
      
      // Navigate to saved passage
      await this.engine.goto(saveData.passage);
      
      // Clear history after loading (fresh start from this point)
      this.engine.clearHistory();
      
      return { success: true, slot: slotName };
    } catch (e) {
      console.error('[SaveManager] Load failed:', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * Delete a save slot (async)
   */
  async delete(slotName) {
    try {
      await this.ensureReady();
      
      const key = `${this.storagePrefix}:${slotName}`;
      await this.db.removeItem(key);
      
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Get all save slots with metadata (async)
   */
  async getAllSaves() {
    const saves = [];
    
    try {
      await this.ensureReady();
      
      const items = await this.db.getAllWithPrefix(this.storagePrefix);
      
      for (const item of items) {
        const slotName = item.key.substring(`${this.storagePrefix}:`.length);
        
        // Skip auto-saves and metadata keys
        if (slotName.startsWith('auto-')) continue;
        if (slotName === 'startTime') continue;
        
        try {
          const saveData = JSON.parse(item.value);
          saves.push({
            slot: slotName,
            timestamp: saveData.timestamp,
            passage: saveData.passage,
            meta: saveData.meta || {}
          });
        } catch (e) {
          console.warn('[SaveManager] Failed to parse save:', slotName);
        }
      }
    } catch (e) {
      console.error('[SaveManager] Failed to list saves:', e);
    }
    
    // Sort by timestamp, newest first
    saves.sort((a, b) => b.timestamp - a.timestamp);
    
    return saves;
  }

  /**
   * Auto-save functionality (async, non-blocking)
   * Handles concurrency to prevent overlapping saves
   */
  async autoSave() {
    if (!this.autoSaveEnabled || this.isSaving) return;
    
    try {
      this.isSaving = true;
      
      const state = this.engine.getState();
      const passage = this.engine.current;
      const currentHash = this.createStateHash(state, passage);
      
      // Only save if something actually changed
      if (this.lastAutoSaveHash === currentHash) {
        return;
      }
      
      this.lastAutoSaveHash = currentHash;
      
      // Get existing auto-saves to find next slot
      const autoSaves = await this.getAutoSaves();
      
      // Use rotating slot numbers (1, 2, 3, then back to 1)
      const nextSlotNum = (autoSaves.length % this.maxAutoSaves) + 1;
      const nextSlot = `auto-${nextSlotNum}`;
      
      // Save asynchronously (won't block the UI)
      await this.save(nextSlot);
    } catch (e) {
      console.warn('[SaveManager] Auto-save failed:', e);
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Get auto-save slots (async)
   */
  async getAutoSaves() {
    const saves = [];
    
    try {
      await this.ensureReady();
      
      const items = await this.db.getAllWithPrefix(`${this.storagePrefix}:auto-`);
      
      for (const item of items) {
        const slotName = item.key.substring(`${this.storagePrefix}:`.length);
        
        try {
          const saveData = JSON.parse(item.value);
          saves.push({
            slot: slotName,
            timestamp: saveData.timestamp,
            passage: saveData.passage
          });
        } catch (e) {
          // Skip corrupted saves
        }
      }
    } catch (e) {
      console.error('[SaveManager] Failed to list auto-saves:', e);
    }
    
    // Sort by timestamp, newest first
    saves.sort((a, b) => b.timestamp - a.timestamp);
    
    // Enforce max auto-saves limit
    if (saves.length > this.maxAutoSaves) {
      // Delete oldest auto-saves beyond the limit (async, don't wait)
      const toDelete = saves.slice(this.maxAutoSaves);
      toDelete.forEach(save => {
        this.delete(save.slot).catch(e => {
          console.warn('[SaveManager] Failed to clean up old auto-save:', e);
        });
      });
      return saves.slice(0, this.maxAutoSaves);
    }
    
    return saves;
  }

  /**
   * Export save to file (async)
   */
  async exportSave(slotName) {
    try {
      await this.ensureReady();
      
      const key = `${this.storagePrefix}:${slotName}`;
      const data = await this.db.getItem(key);
      
      if (!data) {
        return { success: false, error: 'Save not found' };
      }

      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slotName}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Import save from file (async)
   */
  async importSave(file, slotName) {
    try {
      await this.ensureReady();
      
      const text = await file.text();
      const saveData = JSON.parse(text);
      
      // Validate save data
      if (!saveData.version || !saveData.passage || !saveData.state) {
        return { success: false, error: 'Invalid save file' };
      }
      
      const key = `${this.storagePrefix}:${slotName || `import-${Date.now()}`}`;
      await this.db.setItem(key, text);
      
      return { success: true, slot: slotName };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Calculate play time (async)
   */
  async calculatePlayTime() {
    try {
      await this.ensureReady();
      
      const startKey = `${this.storagePrefix}:startTime`;
      const startTime = await this.db.getItem(startKey);
      
      if (!startTime) {
        await this.db.setItem(startKey, Date.now().toString());
        return 0;
      }
      
      return Date.now() - parseInt(startTime, 10);
    } catch (e) {
      console.error('[SaveManager] Failed to calculate play time:', e);
      return 0;
    }
  }

  /**
   * Get turn count (sync - from current engine state)
   */
  getTurnCount() {
    const state = this.engine.getState();
    return state.meta?.turns || 0;
  }

  /**
   * Clear all saves (async)
   */
  async clearAll() {
    try {
      await this.ensureReady();
      
      const items = await this.db.getAllWithPrefix(this.storagePrefix);
      const keys = items.map(item => item.key);
      
      await Promise.all(keys.map(key => this.db.removeItem(key)));
      
      return { success: true, count: keys.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    try {
      await this.ensureReady();
      
      const allSaves = await this.getAllSaves();
      const autoSaves = await this.getAutoSaves();
      
      return {
        totalSaves: allSaves.length,
        autoSaves: autoSaves.length,
        manualSaves: allSaves.length,
        oldestSave: allSaves.length > 0 ? allSaves[allSaves.length - 1].timestamp : null,
        newestSave: allSaves.length > 0 ? allSaves[0].timestamp : null
      };
    } catch (e) {
      console.error('[SaveManager] Failed to get stats:', e);
      return null;
    }
  }
}

// Format timestamp for display
export function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  // Less than 1 minute
  if (diff < 60000) {
    return 'Just now';
  }
  
  // Less than 1 hour
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m ago`;
  }
  
  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }
  
  // Same year
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  
  // Different year
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Format play time
export function formatPlayTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}