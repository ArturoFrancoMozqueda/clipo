import type { Project } from './types';

// Projects and their media live only on this device, in IndexedDB.
const DB_NAME = 'clipo';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? (req.result as T) : (undefined as T));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const saveProject = (p: Project) => run<void>('projects', 'readwrite', (s) => s.put(p));
export const listProjects = () => run<Project[]>('projects', 'readonly', (s) => s.getAll());
export const putBlob = (id: string, blob: Blob) => run<void>('blobs', 'readwrite', (s) => s.put(blob, id));
export const getBlob = (id: string) => run<Blob | undefined>('blobs', 'readonly', (s) => s.get(id));

export async function deleteProject(p: Project) {
  await run<void>('projects', 'readwrite', (s) => s.delete(p.id));
  await run<void>('blobs', 'readwrite', (s) => {
    for (const id of Object.keys(p.assets)) s.delete(id);
  });
}

/** Ask the browser not to evict our data when storage runs low. */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
