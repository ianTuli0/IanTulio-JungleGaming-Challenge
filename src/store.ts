import { useSyncExternalStore } from 'react';

/** Minimal observable value. React subscribes; non-React code (game loop, sync queue) writes. */
export interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const useStore = <T,>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.get);

/** localStorage that never throws (private mode, quota, blocked storage). */
export const storage = {
  read<T>(key: string, parse: (raw: unknown) => T | null): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : parse(JSON.parse(raw));
    } catch {
      return null;
    }
  },
  write(key: string, value: unknown): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage unavailable: the app keeps working with in-memory state.
    }
  },
};
