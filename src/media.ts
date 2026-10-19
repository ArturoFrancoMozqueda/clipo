import type { Asset, MediaKind } from './types';
import { IMAGE_MAX } from './model';
import { putBlob } from './db';
import { uid, useStore } from './store';
import { codecName, convertToMp4, inspectVideo } from './convertVideo';

// Camera formats listed by extension too: a file picker only shows .mov/.m4v under "video/*" when the
// system has those types registered, which isn't always the case on Windows.
const VIDEO_EXTS = '.mov,.m4v,.mp4,.mkv,.webm,.3gp';
/** `accept` of the file pickers for videos and photos. */
export const ACCEPT_VISUAL = `video/*,image/*,${VIDEO_EXTS}`;
/** `accept` of the file pickers for any media. */
export const ACCEPT_MEDIA = `video/*,image/*,audio/*,${VIDEO_EXTS},.mp3,.m4a,.wav`;

const EXT: Record<string, MediaKind> = {
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video', '3gp': 'video',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', avif: 'image', bmp: 'image',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', oga: 'audio', flac: 'audio', opus: 'audio',
};

function detectKind(f: File): MediaKind | null {
  if (f.type.startsWith('video/')) return 'video';
  if (f.type.startsWith('image/')) return 'image';
  if (f.type.startsWith('audio/')) return 'audio';
  return EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

const THUMB_H = 96;

function grab(src: CanvasImageSource, w: number, h: number): string | undefined {
  try {
    const c = document.createElement('canvas');
    c.height = THUMB_H;
    c.width = Math.max(1, Math.round((THUMB_H * w) / h));
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  }
}

function once(el: EventTarget, ev: string, ms: number) {
  return new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    el.addEventListener(ev, () => { clearTimeout(t); resolve(true); }, { once: true });
  });
}

async function probeVideo(url: string) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'metadata';
  const failed = new Promise<never>((_, reject) => v.addEventListener('error', () => reject(new Error('unsupported')), { once: true }));
  failed.catch(() => {});
  v.src = url;
  try {
    const ok = await Promise.race([once(v, 'loadedmetadata', 20000), failed]);
    if (!ok) throw new Error('timeout');
    let duration = v.duration;
    if (!isFinite(duration)) {
      // Some recordings (MediaRecorder WebM) report Infinity until we seek far ahead.
      v.currentTime = 1e7;
      await once(v, 'durationchange', 5000);
      duration = isFinite(v.duration) ? v.duration : 0;
    }
    v.currentTime = Math.min(0.5, duration / 3);
    const seeked = await once(v, 'seeked', 4000);
    const thumb = seeked && v.videoWidth ? grab(v, v.videoWidth, v.videoHeight) : undefined;
    return { duration, width: v.videoWidth, height: v.videoHeight, thumb };
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}

async function probeImage(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return { duration: IMAGE_MAX, width: img.naturalWidth, height: img.naturalHeight, thumb: grab(img, img.naturalWidth, img.naturalHeight) };
}

async function probeAudio(url: string) {
  const a = document.createElement('audio');
  a.preload = 'metadata';
  const failed = new Promise<never>((_, reject) => a.addEventListener('error', () => reject(new Error('unsupported')), { once: true }));
  failed.catch(() => {});
  a.src = url;
  const ok = await Promise.race([once(a, 'loadedmetadata', 20000), failed]);
  if (!ok || !isFinite(a.duration)) throw new Error('timeout');
  return { duration: a.duration, width: 0, height: 0, thumb: undefined };
}

/** Convert a video once so the editor can play it, telling the person how far along it is. */
async function convertForEditing(file: File) {
  const notify = useStore.getState().notify;
  let shown = -1;
  notify(`Preparando ${file.name} para editarlo…`);
  return convertToMp4(file, (p) => {
    const pct = Math.floor(p * 10) * 10;
    if (pct === shown || pct >= 100) return;
    shown = pct;
    notify(`Preparando ${file.name} para editarlo… ${pct}%`);
  });
}

/**
 * Read local files, store them on the device and return their asset records.
 * Files the browser can't play are reported by name instead of throwing.
 */
export async function importFiles(files: FileList | File[]): Promise<{ ok: Asset[]; failed: string[] }> {
  const ok: Asset[] = [];
  const failed: string[] = [];
  const urls: Record<string, string> = {};
  let saveFailed = false;

  for (const file of Array.from(files)) {
    let kind = detectKind(file);
    if (!kind) {
      failed.push(file.name);
      continue;
    }
    const id = uid();
    let stored: File = file;
    let url = URL.createObjectURL(file);
    try {
      let info = kind === 'video' ? await probeVideo(url).catch(() => null) : kind === 'image' ? await probeImage(url) : await probeAudio(url);
      if (kind === 'video' && !info?.width) {
        // The browser can't show this picture by itself (or it is sound only): look inside the file.
        const check = await inspectVideo(file);
        if (check?.hasVideo && !check.canDecode) {
          failed.push(`${file.name} (formato ${codecName(check.codec)}, que este equipo no puede leer)`);
          URL.revokeObjectURL(url);
          continue;
        }
        if (check?.hasVideo) {
          stored = await convertForEditing(file);
          URL.revokeObjectURL(url);
          url = URL.createObjectURL(stored);
          info = await probeVideo(url);
        } else if (info) kind = 'audio'; // audio-only container
      }
      if (!info) throw new Error('unsupported');
      if (kind !== 'image' && info.duration <= 0) throw new Error('empty');
      try {
        await putBlob(id, stored);
      } catch {
        saveFailed = true;
      }
      urls[id] = url;
      ok.push({ id, kind, name: file.name, ...info });
    } catch {
      URL.revokeObjectURL(url);
      failed.push(file.name);
    }
  }
  useStore.getState().addUrls(urls);
  if (saveFailed) useStore.getState().notify('No hay espacio para guardar el archivo: podrás editarlo, pero no se guardará al cerrar.');
  return { ok, failed };
}
