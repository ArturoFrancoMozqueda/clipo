// Saving and sharing a finished file on every platform Clipo runs on.
// - Android/iOS app (Capacitor): the WebView ignores <a download> of a blob and Android has no
//   navigator.share, so the file is written to the app's cache with the Filesystem plugin and
//   handed to the system share sheet with the Share plugin ("Guardar video", Drive, WhatsApp…).
//   On Android "Descargar" writes it to Documents/Clipo instead.
// - Browser: navigator.share with files when the browser can, otherwise a normal download.
// - Desktop app (Electron): a normal download (Electron shows its own save dialog).
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useStore } from './store';

// Minimal shapes of @capacitor/filesystem and @capacitor/share (only what is used here). The
// plugins are found by name at runtime once installed and synced (`npx cap sync`).
type Directory = 'CACHE' | 'DOCUMENTS' | 'DATA';
interface FilesystemPlugin {
  writeFile(o: { path: string; data: string; directory: Directory; recursive?: boolean }): Promise<{ uri: string }>;
  appendFile(o: { path: string; data: string; directory: Directory }): Promise<void>;
  deleteFile(o: { path: string; directory: Directory }): Promise<void>;
  getUri(o: { path: string; directory: Directory }): Promise<{ uri: string }>;
}
interface SharePlugin {
  canShare(): Promise<{ value: boolean }>;
  share(o: { title?: string; text?: string; files?: string[]; dialogTitle?: string }): Promise<unknown>;
}

const Filesystem = registerPlugin<FilesystemPlugin>('Filesystem');
const Share = registerPlugin<SharePlugin>('Share');

const notify = (text: string) => useStore.getState().notify(text);

export const isNative = () => Capacitor.isNativePlatform();
const isElectron = () => typeof window !== 'undefined' && !!window.clipoDesktop;
const nativeReady = () => isNative() && Capacitor.isPluginAvailable('Filesystem') && Capacitor.isPluginAvailable('Share');

/** Bytes per write to the native side: a multiple of 3, so every chunk is whole base64. */
const CHUNK = 3 * 1024 * 1024;

/** Base64 of a part of a file, without loading the rest. */
function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('read'));
    r.readAsDataURL(blob);
  });
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'video.mp4';

/** Writes the file a few MB at a time (one giant base64 string would run a phone out of memory). */
async function writeNative(file: File, path: string, directory: Directory): Promise<string> {
  let uri = '';
  if (!file.size) return (await Filesystem.writeFile({ path, data: '', directory, recursive: true })).uri;
  for (let at = 0; at < file.size; at += CHUNK) {
    const data = await base64Of(file.slice(at, at + CHUNK));
    if (at === 0) uri = (await Filesystem.writeFile({ path, data, directory, recursive: true })).uri;
    else await Filesystem.appendFile({ path, data, directory });
  }
  return uri;
}

// Must stay under Cache/share/: the only cache folder Android's FileProvider exposes (res/xml/file_paths.xml).
const cachePath = (name: string) => `share/${safeName(name)}`;
/** Files written to the cache this session, removed before writing new ones. */
const cached = new Set<string>();

async function toCache(file: File) {
  const path = cachePath(file.name);
  for (const old of cached) {
    if (old !== path) await Filesystem.deleteFile({ path: old, directory: 'CACHE' }).catch(() => {});
    cached.delete(old);
  }
  const uri = await writeNative(file, path, 'CACHE');
  cached.add(path);
  return uri;
}

const cancelledShare = (e: unknown) => {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return (e as DOMException)?.name === 'AbortError' || m.includes('cancel') || m.includes('abort');
};

/** Whether "Compartir" can be offered for this file. */
export function canShareFile(file: File): boolean {
  if (nativeReady()) return true;
  if (isNative()) return false;
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

/** Opens the share sheet with the file. Call it straight from the tap (browsers need the gesture). */
export async function shareFile(file: File, title?: string): Promise<void> {
  if (isNative()) {
    if (!nativeReady()) return notify('Esta versión de la app no puede compartir archivos. Actualízala e intenta otra vez.');
    try {
      notify('Preparando el video…');
      const uri = await toCache(file);
      await Share.share({ title: title ?? file.name, files: [uri], dialogTitle: 'Compartir video' });
    } catch (e) {
      if (!cancelledShare(e)) {
        console.error('Native share failed', e);
        notify(isQuota(e) ? 'No hay espacio suficiente en el teléfono para compartir el video.' : 'No se pudo compartir el video. Intenta otra vez.');
      }
    }
    return;
  }
  try {
    await navigator.share({ files: [file], title: title ?? file.name });
  } catch (e) {
    if (!cancelledShare(e)) {
      console.warn('Web share failed', e);
      notify('No se pudo compartir. Usa “Descargar” y súbelo desde la app de la red.');
    }
  }
}

const isQuota = (e: unknown) => {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return (e as DOMException)?.name === 'QuotaExceededError' || m.includes('space') || m.includes('espacio');
};

function anchorDownload(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Long enough for the browser to start reading it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * "Descargar". Browser and desktop: a normal download. Android app: written to Documents/Clipo.
 * iOS app (no public folder): the share sheet, where "Guardar video" and "Guardar en Archivos" are.
 */
export async function saveFile(file: File): Promise<void> {
  if (!isNative() || isElectron()) return anchorDownload(file);
  if (!nativeReady()) return notify('Esta versión de la app no puede guardar archivos. Actualízala e intenta otra vez.');
  if (Capacitor.getPlatform() === 'android') {
    try {
      notify('Guardando el video…');
      await writeNative(file, `Clipo/${safeName(file.name)}`, 'DOCUMENTS');
      notify(`Guardado en Documentos/Clipo: ${safeName(file.name)}`);
      return;
    } catch (e) {
      // Older Android versions need a permission for public folders: offer the share sheet instead.
      console.warn('Could not write to Documents, opening the share sheet', e);
      if (isQuota(e)) return notify('No hay espacio suficiente en el teléfono para guardar el video.');
    }
  }
  await shareFile(file);
}

/** "Descargar todas". */
export async function saveFiles(files: File[]): Promise<void> {
  if (!isNative() || isElectron()) return files.forEach(anchorDownload);
  for (const f of files) await saveFile(f);
}
