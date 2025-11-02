// storage-db.js
// IndexedDB wrapper for async key-value storage
// Drop-in replacement for localStorage with better performance and no blocking

/**
 * Simple IndexedDB key-value store
 * Provides async localStorage-like API with better performance
 */
export class StorageDB {
  constructor(dbName = 'game-storage', storeName = 'saves') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
    this.ready = this.init();
  }

  /**
   * Initialize IndexedDB
   * @returns {Promise<void>}
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => {
        console.error('[StorageDB] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  /**
   * Ensure database is ready before operations
   */
  async ensureReady() {
    await this.ready;
  }

  /**
   * Get a value by key
   * @param {string} key 
   * @returns {Promise<any>}
   */
  async getItem(key) {
    await this.ensureReady();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Set a value by key
   * @param {string} key 
   * @param {any} value 
   * @returns {Promise<void>}
   */
  async setItem(key, value) {
    await this.ensureReady();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove a value by key
   * @param {string} key 
   * @returns {Promise<void>}
   */
  async removeItem(key) {
    await this.ensureReady();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all keys in the store
   * @returns {Promise<string[]>}
   */
  async getAllKeys() {
    await this.ensureReady();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all values matching a key prefix
   * @param {string} prefix 
   * @returns {Promise<Array<{key: string, value: any}>>}
   */
  async getAllWithPrefix(prefix) {
    await this.ensureReady();
    
    const keys = await this.getAllKeys();
    const matching = keys.filter(key => key.startsWith(prefix));
    
    const results = await Promise.all(
      matching.map(async key => ({
        key,
        value: await this.getItem(key)
      }))
    );
    
    return results;
  }

  /**
   * Clear all data in the store
   * @returns {Promise<void>}
   */
  async clear() {
    await this.ensureReady();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get the number of items in the store
   * @returns {Promise<number>}
   */
  async count() {
    await this.ensureReady();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/**
 * Create a singleton instance for the app
 */
let defaultInstance = null;

export function getStorageDB() {
  if (!defaultInstance) {
    defaultInstance = new StorageDB();
  }
  return defaultInstance;
}

/**
 * Migrate existing localStorage data to IndexedDB
 * @param {string} prefix - Key prefix to migrate (e.g., 'if-save')
 * @param {StorageDB} db - Target database
 * @returns {Promise<number>} - Number of items migrated
 */
export async function migrateFromLocalStorage(prefix, db) {
  let migrated = 0;
  
  try {
    // Get all localStorage keys with prefix
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    
    // Migrate each key
    for (const key of keys) {
      try {
        const value = localStorage.getItem(key);
        if (value) {
          await db.setItem(key, value);
          migrated++;
        }
      } catch (e) {
        console.warn(`[Migration] Failed to migrate key: ${key}`, e);
      }
    }
    
    console.log(`[Migration] Migrated ${migrated} items from localStorage to IndexedDB`);
  } catch (e) {
    console.error('[Migration] Failed to migrate from localStorage:', e);
  }
  
  return migrated;
}