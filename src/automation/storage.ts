/** Separate from the user's project database. Transactions finish before success is returned. */
let opening: Promise<IDBDatabase> | undefined;
const db = () => opening ??= new Promise((resolve, reject) => {
  const r = indexedDB.open('clipo-agent', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('records');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
export interface RecordStore {
  put(key: string, value: unknown): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  list<T>(prefix: string): Promise<T[]>;
  remove(key: string): Promise<void>;
}
export const agentStorage: RecordStore = {
  async put(key, value) {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction('records', 'readwrite'); tx.objectStore('records').put(value, key);
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
    });
  },
  async get<T>(key: string) {
    const d = await db();
    return new Promise<T | undefined>((resolve, reject) => {
      const r = d.transaction('records').objectStore('records').get(key);
      r.onsuccess = () => resolve(r.result as T | undefined); r.onerror = () => reject(r.error);
    });
  },
  async list<T>(prefix: string) {
    const d = await db();
    return new Promise<T[]>((resolve, reject) => {
      const r = d.transaction('records').objectStore('records').getAll(IDBKeyRange.bound(prefix, prefix + '\uffff'));
      r.onsuccess = () => resolve(r.result as T[]); r.onerror = () => reject(r.error);
    });
  },
  async remove(key) {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction('records', 'readwrite'); tx.objectStore('records').delete(key);
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
    });
  },
};
export async function digest(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}
export const projectDigest = (value: unknown) => digest(new TextEncoder().encode(JSON.stringify(value)).buffer);
