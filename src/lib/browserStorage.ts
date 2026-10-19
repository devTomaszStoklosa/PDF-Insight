/** The subset of the Web Storage API the app uses; implemented by localStorage. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Storage kept in memory only: a fallback when localStorage is blocked, and a test double. */
export function createMemoryStorage(): KeyValueStorage {
  const items = new Map<string, string>();

  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

/**
 * Returns localStorage, or in-memory storage when the browser blocks it: reading
 * `window.localStorage` throws a SecurityError when site data is disabled.
 */
export function getLocalStorage(): KeyValueStorage {
  try {
    return window.localStorage;
  } catch {
    return createMemoryStorage();
  }
}
