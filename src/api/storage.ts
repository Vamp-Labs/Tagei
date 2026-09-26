import type { z } from 'zod';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

function probeLocalStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    const probeKey = 'bnbplay.probe';
    storage.setItem(probeKey, probeKey);
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

let sharedStorage: KeyValueStorage | null = null;

export function browserStorage(): KeyValueStorage {
  sharedStorage ??= probeLocalStorage() ?? createMemoryStorage();
  return sharedStorage;
}

export function readJson<T>(storage: KeyValueStorage, key: string, schema: z.ZodType<T>): T | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeJson(storage: KeyValueStorage, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
