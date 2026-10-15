// The publish queue and the videos waiting to be uploaded, in their own IndexedDB database
// (separate from projects, so it never needs a migration of the 'clipo' database).
import type { PublishJob } from './types';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('clipo-publish', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('jobs')) d.createObjectStore('jobs', { keyPath: 'id' });
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

export const listJobs = () => run<PublishJob[]>('jobs', 'readonly', (s) => s.getAll());
export const saveJob = (j: PublishJob) => run<void>('jobs', 'readwrite', (s) => s.put(j));
export const deleteJobs = (ids: string[]) => run<void>('jobs', 'readwrite', (s) => ids.forEach((id) => s.delete(id)));
export const putBlob = (id: string, blob: Blob) => run<void>('blobs', 'readwrite', (s) => s.put(blob, id));
export const getBlob = (id: string) => run<Blob | undefined>('blobs', 'readonly', (s) => s.get(id));
export const deleteBlobs = (ids: string[]) => run<void>('blobs', 'readwrite', (s) => ids.forEach((id) => s.delete(id)));
