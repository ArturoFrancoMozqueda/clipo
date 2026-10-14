// Editing actions shared by the toolbar, panels and keyboard shortcuts.
import type { AspectId, Asset, Project, StickerItem } from './types';
import { DEFAULT_IMAGE_SECONDS, audioDur, layout } from './model';
import { itemsOf, uid, useStore } from './store';
import { engine } from './engine';
import { EFFECT_DEFAULT_INTENSITY, STICKER_DEFAULT_SIZE } from './visuals';

const get = () => useStore.getState();

export function newProject(aspect: AspectId): Project {
  const now = Date.now();
  const date = new Date().toLocaleDateString('es', { day: 'numeric', month: 'short' });
  return { id: uid(), name: `Mi video ${date}`, aspect, assets: {}, clips: [], texts: [], audios: [], stickers: [], createdAt: now, updatedAt: now };
}

export function addAssetsToTimeline(assets: Asset[]) {
  if (!assets.length) return;
  const t = get().time;
  get().commit((p) => {
    for (const a of assets) {
      p.assets[a.id] = a;
      if (a.kind === 'audio') {
        p.audios.push({ id: uid(), assetId: a.id, start: t, in: 0, out: a.duration, volume: 1, fadeIn: 0, fadeOut: 0 });
      } else {
        p.clips.push({
          id: uid(),
          assetId: a.id,
          in: 0,
          out: a.kind === 'image' ? DEFAULT_IMAGE_SECONDS : a.duration,
          speed: 1,
          volume: 1,
          filter: 'none',
          fit: 'fit',
          // Photos get a slow zoom so they don't look frozen.
          ...(a.kind === 'image' ? { effect: { id: 'kenburns' as const, intensity: EFFECT_DEFAULT_INTENSITY } } : {}),
        });
      }
    }
  });
}

export function splitAtPlayhead() {
  const s = get();
  const p = s.project;
  if (!p) return;
  engine.pause();
  const t = s.time;
  const sel = s.selection;
  const MIN = 0.1;

  if (sel?.kind === 'text') {
    const x = p.texts.find((i) => i.id === sel.id);
    if (!x || t <= x.start + MIN || t >= x.start + x.duration - MIN) return s.notify('Mueve la línea blanca sobre el texto para dividirlo');
    const id = uid();
    s.commit((q) => {
      const it = q.texts.find((i) => i.id === sel.id)!;
      const rest = it.start + it.duration - t;
      it.duration = t - it.start;
      q.texts.push({ ...it, id, start: t, duration: rest });
    });
    s.select({ kind: 'text', id });
    return s.notify('Texto dividido');
  }

  if (sel?.kind === 'sticker') {
    const x = (p.stickers ?? []).find((i) => i.id === sel.id);
    if (!x || t <= x.start + MIN || t >= x.start + x.duration - MIN) return s.notify('Mueve la línea blanca sobre el sticker para dividirlo');
    const id = uid();
    s.commit((q) => {
      const it = q.stickers!.find((i) => i.id === sel.id)!;
      const rest = it.start + it.duration - t;
      it.duration = t - it.start;
      q.stickers!.push({ ...it, id, start: t, duration: rest });
    });
    s.select({ kind: 'sticker', id });
    return s.notify('Sticker dividido');
  }

  if (sel?.kind === 'audio') {
    const a = p.audios.find((i) => i.id === sel.id);
    if (!a || t <= a.start + MIN || t >= a.start + audioDur(a) - MIN) return s.notify('Mueve la línea blanca sobre el audio para dividirlo');
    const id = uid();
    s.commit((q) => {
      const it = q.audios.find((i) => i.id === sel.id)!;
      const cut = it.in + (t - it.start);
      q.audios.push({ ...it, id, start: t, in: cut });
      it.out = cut;
    });
    s.select({ kind: 'audio', id });
    return s.notify('Audio dividido');
  }

  const hit = layout(p).find((l) => t > l.start + MIN && t < l.end - MIN);
  if (!hit) return s.notify('Coloca la línea blanca dentro de un clip para dividirlo');
  const id = uid();
  s.commit((q) => {
    const c = q.clips[hit.index];
    const cut = c.in + (t - hit.start) * c.speed;
    q.clips.splice(hit.index + 1, 0, { ...c, id, in: cut });
    c.out = cut;
    delete c.transition; // the transition stays at the end of the second piece
  });
  s.select({ kind: 'clip', id });
  s.notify('Clip dividido ✂️');
}

export function deleteSelected() {
  const s = get();
  const sel = s.selection;
  if (!sel) return;
  engine.pause();
  s.commit((p) => {
    if (sel.kind === 'clip') p.clips = p.clips.filter((c) => c.id !== sel.id);
    if (sel.kind === 'text') p.texts = p.texts.filter((c) => c.id !== sel.id);
    if (sel.kind === 'audio') p.audios = p.audios.filter((c) => c.id !== sel.id);
    if (sel.kind === 'sticker') p.stickers = (p.stickers ?? []).filter((c) => c.id !== sel.id);
  });
  s.select(null);
  s.setPanel(null);
  s.notify('Eliminado · puedes deshacerlo');
}

export function duplicateSelected() {
  const s = get();
  const sel = s.selection;
  if (!sel) return;
  const id = uid();
  s.commit((p) => {
    if (sel.kind === 'clip') {
      const i = p.clips.findIndex((c) => c.id === sel.id);
      if (i >= 0) p.clips.splice(i + 1, 0, { ...p.clips[i], id });
    } else if (sel.kind === 'text') {
      const x = p.texts.find((c) => c.id === sel.id);
      if (x) p.texts.push({ ...x, id, start: x.start + x.duration });
    } else if (sel.kind === 'sticker') {
      const x = p.stickers?.find((c) => c.id === sel.id);
      // Offset the copy so both are visible right away.
      if (x) p.stickers!.push({ ...x, id, x: Math.min(0.9, x.x + 0.06), y: Math.min(0.9, x.y + 0.06) });
    } else {
      const x = p.audios.find((c) => c.id === sel.id);
      if (x) p.audios.push({ ...x, id, start: x.start + audioDur(x) });
    }
  });
  s.select({ kind: sel.kind, id });
  s.notify('Duplicado');
}

export function moveClip(dir: -1 | 1) {
  const s = get();
  const sel = s.selection;
  if (sel?.kind !== 'clip' || !s.project) return;
  const i = s.project.clips.findIndex((c) => c.id === sel.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= s.project.clips.length) return s.notify(dir < 0 ? 'Ya es el primer clip' : 'Ya es el último clip');
  engine.pause();
  s.commit((p) => {
    const [c] = p.clips.splice(i, 1);
    p.clips.splice(j, 0, c);
  });
  // Keep the playhead on the moved clip so the user sees where it went.
  const placed = layout(get().project!).find((l) => l.clip.id === sel.id);
  if (placed) s.setTime(placed.start + 0.01);
}

export function addText() {
  const s = get();
  if (!s.project) return;
  engine.pause();
  const id = uid();
  s.commit((p) => {
    p.texts.push({ id, text: 'Tu texto aquí', start: s.time, duration: 3, x: 0.5, y: 0.75, size: 0.075, styleId: 'clasico' });
  });
  s.select({ kind: 'text', id });
  s.setPanel('text');
}

export function setAspect(aspect: AspectId) {
  get().commit((p) => {
    p.aspect = aspect;
  });
}

/** Add an emoji or image sticker at the playhead and select it. */
export function addSticker(what: Pick<StickerItem, 'emoji' | 'assetId'>, asset?: Asset) {
  const s = get();
  if (!s.project) return;
  engine.pause();
  const id = uid();
  // Place new stickers slightly apart so several added in a row don't hide each other.
  const n = itemsOf(s.project, 'sticker').length;
  s.commit((p) => {
    if (asset) p.assets[asset.id] = { ...asset, sticker: true };
    (p.stickers ??= []).push({
      id,
      start: s.time,
      duration: 3,
      x: 0.5 + ((n % 3) - 1) * 0.18,
      y: 0.35 + (Math.floor(n / 3) % 3) * 0.12,
      size: STICKER_DEFAULT_SIZE,
      rotation: 0,
      ...what,
    });
  });
  s.select({ kind: 'sticker', id });
}

/** Add imported image assets as stickers (kept out of the media library). */
export function addImageStickers(assets: Asset[]) {
  for (const a of assets) addSticker({ assetId: a.id }, a);
}
