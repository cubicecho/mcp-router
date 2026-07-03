import '@testing-library/jest-dom/vitest';

// Node >=22 exposes an experimental `localStorage` getter on globalThis that returns
// undefined unless the process runs with --localstorage-file, and vitest's jsdom
// environment does not override pre-existing globals. Shim a simple in-memory Storage.
if (typeof window.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear' | 'key' | 'length'> = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}
