import { randomUUID } from 'node:crypto';
import { seed } from './seed.js';
import { firestoreDriver } from './firestore.js';

const copy = (v) => structuredClone(v);

/**
 * Storage contract used by every route. Drivers: memory (default) and firestore (src/firestore.js).
 * To add MongoDB, implement the same async methods and return it from createDb().
 */
function memoryDriver() {
  const data = copy(seed());
  const col = (n) => data[n] ?? (data[n] = []);
  return {
    list: async (n) => copy(col(n)),
    get: async (n, id) => copy(col(n).find((r) => r.id === id) ?? null),
    create: async (n, doc) => {
      const row = { ...doc, id: doc.id || randomUUID() };
      col(n).unshift(row);
      return copy(row);
    },
    update: async (n, id, patch) => {
      const row = col(n).find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return copy(row);
    },
    remove: async (n, id) => {
      const i = col(n).findIndex((r) => r.id === id);
      if (i < 0) return false;
      col(n).splice(i, 1);
      return true;
    },
    getMeta: async () => copy(data.meta),
    setMeta: async (meta) => { data.meta = copy(meta); },
  };
}

export function createDb() {
  const driver = process.env.DB_DRIVER || 'memory';
  if (driver === 'firestore') return { driver, ...firestoreDriver(seed()) };
  if (driver !== 'memory') console.warn(`Unknown DB_DRIVER "${driver}", using the in-memory store.`);
  return { driver: 'memory', ...memoryDriver() };
}
