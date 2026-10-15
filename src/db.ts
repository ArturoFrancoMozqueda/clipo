import type { AspectId, Project } from './types';
import { totalDuration } from './model';

// Projects and their media live only on this device, in IndexedDB.
const DB_NAME = 'clipo';
// 2: 'meta' store with a light summary of each project, for the project list.
const VERSION = 2;

/** What the start screen needs to list a project, without loading the whole project. */
export interface ProjectMeta {
  id: string;
  name: string;
  aspect: AspectId;
  createdAt: number;
  updatedAt: number;
  /** Seconds. */
  duration: number;
  /** Thumbnail of the first clip (data URL). */
  thumb?: string;
  clipCount: number;
  /** Every asset id the project uses (their blobs must be kept). */
  assetIds: string[];
}

/** Every media id a project refers to: its assets plus any item pointing at one. */
export function projectAssetIds(p: Project): string[] {
  const ids = new Set(Object.keys(p.assets ?? {}));
  for (const c of p.clips ?? []) {
    if (c.assetId) ids.add(c.assetId);
    if (c.bgRemoval?.assetId) ids.add(c.bgRemoval.assetId);
  }
  for (const x of [...(p.audios ?? []), ...(p.overlays ?? []), ...(p.stickers ?? [])]) if (x.assetId) ids.add(x.assetId);
  return [...ids];
}

export function projectMeta(p: Project): ProjectMeta {
  const first = p.clips?.[0] && p.assets?.[p.clips[0].assetId];
  let duration = 0;
  try {
    duration = totalDuration(p);
  } catch {
    /* damaged project: the list still shows it */
  }
  return {
    id: p.id,
    name: p.name,
    aspect: p.aspect,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    duration,
    thumb: first ? first.thumb : undefined,
    clipCount: p.clips?.length ?? 0,
    assetIds: projectAssetIds(p),
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
        if (!d.objectStoreNames.contains('meta')) {
          const meta = d.createObjectStore('meta', { keyPath: 'id' });
          // Summaries of the projects saved before this version.
          const cur = req.transaction!.objectStore('projects').openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (!c) return;
            try {
              meta.put(projectMeta(c.value as Project));
            } catch {
              /* a damaged project is listed by listProjectMeta's fallback */
            }
            c.continue();
          };
        }
      };
      req.onsuccess = () => {
        const d = req.result;
        // Another tab with a newer version wants to upgrade: let it.
        d.onversionchange = () => {
          d.close();
          dbPromise = null;
        };
        resolve(d);
      };
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

/** One transaction. `fn` may return a request (its result is returned) or a function read at the end. */
function run<T>(store: string | string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest | (() => T) | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx);
        tx.oncomplete = () => resolve(typeof req === 'function' ? req() : req ? (req.result as T) : (undefined as T));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** Blobs stored during this session; never collected while it lasts (undo may bring them back). */
const fresh = new Set<string>();

export const saveProject = (p: Project) =>
  run<void>(['projects', 'meta'], 'readwrite', (tx) => {
    tx.objectStore('projects').put(p);
    tx.objectStore('meta').put(projectMeta(p));
  });
/** Every saved project, complete. Prefer listProjectMeta() + getProject() for the project list. */
export const listProjects = () => run<Project[]>('projects', 'readonly', (tx) => tx.objectStore('projects').getAll());
export const getProject = (id: string) => run<Project | undefined>('projects', 'readonly', (tx) => tx.objectStore('projects').get(id));
export const putBlob = (id: string, blob: Blob) => {
  fresh.add(id);
  return run<void>('blobs', 'readwrite', (tx) => tx.objectStore('blobs').put(blob, id));
};
export const getBlob = (id: string) => run<Blob | undefined>('blobs', 'readonly', (tx) => tx.objectStore('blobs').get(id));

/**
 * Summaries of the saved projects. With `strict`, a project that can't be read makes it throw
 * instead of being left out (the garbage collector must never miss a project).
 */
async function readMetas(strict: boolean): Promise<ProjectMeta[]> {
  const [metas, keys] = await run<[ProjectMeta[], IDBValidKey[]]>(['meta', 'projects'], 'readonly', (tx) => {
    const m = tx.objectStore('meta').getAll();
    const k = tx.objectStore('projects').getAllKeys();
    return () => [m.result as ProjectMeta[], k.result];
  });
  const saved = new Set(keys.map(String));
  const list = metas.filter((m) => saved.has(m.id) && (!strict || Array.isArray(m.assetIds)));
  const have = new Set(list.map((m) => m.id));
  // Projects without a summary (saved by an older version in another tab): read them once.
  for (const id of saved) {
    if (have.has(id)) continue;
    const p = await getProject(id).catch((e) => {
      if (strict) throw e;
      return undefined;
    });
    if (p) list.push(projectMeta(p));
    else if (strict) throw new Error(`project ${id} unreadable`);
  }
  return list;
}

/** Light summaries of every saved project, newest first (no full project is kept in memory). */
export async function listProjectMeta(): Promise<ProjectMeta[]> {
  return (await readMetas(false)).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Asset ids used by the saved projects, optionally leaving one project out. */
async function savedAssetIds(except?: string): Promise<Set<string>> {
  const used = new Set<string>();
  for (const m of await readMetas(true)) if (m.id !== except) for (const id of m.assetIds) used.add(id);
  return used;
}

/** Delete a project and the media only it was using. */
export async function deleteProject(p: Pick<Project, 'id' | 'assets'> | ProjectMeta) {
  const ids = 'assetIds' in p ? p.assetIds : projectAssetIds(p as Project);
  await run<void>(['projects', 'meta'], 'readwrite', (tx) => {
    tx.objectStore('projects').delete(p.id);
    tx.objectStore('meta').delete(p.id);
  });
  let used: Set<string>;
  try {
    used = await savedAssetIds(p.id);
  } catch {
    return; // another project could not be read: leave the media to collectGarbage()
  }
  // Media shared with another project stays.
  const gone = ids.filter((id) => !used.has(id));
  if (gone.length) await run<void>('blobs', 'readwrite', (tx) => gone.forEach((id) => tx.objectStore('blobs').delete(id)));
}

// Keys of blobs that are not project media (see myVoice.ts): never collected.
const isMediaKey = (k: string) => /^[a-z0-9]{6,20}$/.test(k);

/**
 * Pure part of the garbage collection: which stored keys to delete. Keeps anything a saved
 * project uses, anything in `keep` (the open project and its undo history, blobs of this
 * session) and anything that is not a project media key.
 */
export function blobsToDelete(stored: Iterable<string>, used: Set<string>, keep: Set<string>): string[] {
  return [...stored].filter((k) => isMediaKey(k) && !used.has(k) && !keep.has(k));
}

/**
 * Delete media blobs no saved project uses (for example a file imported and then undone).
 * `keep` lists the ids still used in memory: the open project, its undo/redo history.
 * Skipped while Clipo is open in another tab, since that tab may hold unsaved imports.
 * Returns how many blobs were deleted.
 */
export async function collectGarbage(keep: Iterable<string> = []): Promise<number> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.query) return 0;
  const held = await locks.query();
  const tabs = [...(held.held ?? []), ...(held.pending ?? [])].filter((l) => l.name?.startsWith(TAB_LOCK)).length;
  if (tabs > 1) return 0;
  const used = await savedAssetIds();
  const keys = await run<IDBValidKey[]>('blobs', 'readonly', (tx) => tx.objectStore('blobs').getAllKeys());
  const keepSet = new Set([...keep, ...fresh]);
  const gone = blobsToDelete(keys.map(String), used, keepSet);
  if (gone.length) await run<void>('blobs', 'readwrite', (tx) => gone.forEach((id) => tx.objectStore('blobs').delete(id)));
  return gone.length;
}

const TAB_LOCK = 'clipo-tab-';

/** Mark this tab as open (held until it closes), so collectGarbage in another tab waits. */
export function holdTabLock() {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  locks?.request(TAB_LOCK + Math.random().toString(36).slice(2), () => new Promise<void>(() => {})).catch(() => {});
}

/** Ask the browser not to evict our data when storage runs low. */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
