import '@testing-library/jest-dom/vitest';

// jsdom lacks ResizeObserver, which Radix popper-based primitives (Tooltip,
// Select, …) touch when they open. Provide a no-op implementation.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom's window.scrollTo throws "Not implemented"; some libraries call it.
window.scrollTo = () => {};

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
