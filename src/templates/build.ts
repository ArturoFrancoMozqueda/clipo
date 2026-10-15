import type { Asset, Clip, Project, TextItem } from '../types';
import type { AspectId } from '../types';
import { canvasSize, clamp, clipDur, layout } from '../model';
import { getTextStyle } from '../textStyles';
import { newProject } from '../ops';
import { uid } from '../store';
import type { Template, TemplateSlot } from './types';
import { BUILTIN_TEMPLATES } from './builtin';

const MIN_TEXT = 0.5;

let measurer: CanvasRenderingContext2D | null = null;

/** Shrink a text's size so its longest line fits inside the frame (user answers can be long). */
export function fitSize(text: string, styleId: string, size: number, aspect: AspectId) {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return size;
  const [W, H] = canvasSize(aspect, 1000);
  const st = getTextStyle(styleId);
  const fs = size * Math.min(W, H);
  measurer.font = `${st.italic ? 'italic ' : ''}${st.weight} ${fs}px ${st.font}`;
  const raw = st.upper ? text.toUpperCase() : text;
  // Same padding as drawText (0.45 em per side) plus a small safety margin.
  const need = Math.max(...raw.split('\n').map((l) => measurer!.measureText(l).width)) + fs * 0.9;
  const room = W * 0.94;
  return need > room ? Math.max(0.025, Math.floor((size * room * 1000) / need) / 1000) : size;
}

/** Replace `{key}` placeholders; empty answers fall back to the field's example. */
export function fillText(text: string, t: Template, values: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (all, key: string) => {
    const f = t.fields.find((x) => x.key === key);
    if (!f) return all;
    const v = values[key]?.trim();
    return v ? v : f.default;
  });
}

/**
 * Texts placed on a timeline whose slots last `lengths` seconds each
 * (videos shorter than their slot shorten it, so texts are clamped to fit).
 */
export function placeTexts(t: Template, values: Record<string, string>, lengths: number[]): TextItem[] {
  if (!lengths.length) return [];
  const starts: number[] = [];
  let total = 0;
  for (const l of lengths) {
    starts.push(total);
    total += l;
  }
  const out: TextItem[] = [];
  for (const x of t.texts) {
    const all = x.slot === 'all';
    const i = all ? 0 : Math.min(x.slot as number, lengths.length - 1);
    const base = all ? 0 : starts[i];
    const len = all ? total : lengths[i];
    if (base === undefined || len === undefined) continue;
    const offset = clamp(x.offset, 0, Math.max(0, len - MIN_TEXT));
    const duration = clamp(x.duration ?? len - offset, MIN_TEXT, Math.max(MIN_TEXT, len - offset));
    const text = fillText(x.text, t, values);
    out.push({
      id: uid(),
      text,
      start: base + offset,
      duration,
      x: x.x,
      y: x.y,
      size: fitSize(text, x.styleId, x.size, t.aspect),
      styleId: x.styleId,
    });
  }
  return out;
}

function clipFor(a: Asset, s: TemplateSlot): Clip {
  const out = a.kind === 'image' ? s.duration : Math.min(a.duration, s.duration);
  return { id: uid(), assetId: a.id, in: 0, out, speed: 1, volume: 1, filter: s.filter, fit: s.fit };
}

/**
 * A ready-to-edit project: slot i gets media[i]; when there are fewer files
 * than slots they repeat in order so the template keeps its rhythm.
 */
export function projectFromTemplate(t: Template, media: Asset[], values: Record<string, string>): Project {
  const p = newProject(t.aspect);
  const first = t.fields[0] && values[t.fields[0].key]?.trim();
  p.name = first ? `${t.name} · ${first}` : t.name;
  for (const a of media) p.assets[a.id] = a;
  if (media.length) p.clips = t.slots.map((s, i) => clipFor(media[i % media.length]!, s));
  p.texts = placeTexts(t, values, p.clips.length ? p.clips.map(clipDur) : t.slots.map((s) => s.duration));
  return p;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Turn the open project into a reusable template: each clip becomes an empty slot. */
export function templateFromProject(p: Project, name: string): Template {
  const placed = layout(p);
  const slots: TemplateSlot[] = placed.map(({ clip }, i) => {
    const a = p.assets[clip.assetId];
    return {
      label: `${a?.kind === 'video' ? 'Video' : 'Foto'} ${i + 1}`,
      duration: round(clipDur(clip)),
      filter: clip.filter,
      fit: clip.fit,
    };
  });
  const texts = p.texts
    .filter((x) => !x.caption)
    .map((x) => {
      const i = placed.findIndex((l) => x.start >= l.start - 1e-3 && x.start < l.end);
      const l = placed[i];
      const ok = l !== undefined && x.start + x.duration <= l.end + 0.05;
      return {
        text: x.text,
        slot: ok ? i : ('all' as const),
        offset: round(ok ? x.start - l.start : x.start),
        duration: round(x.duration),
        x: x.x,
        y: x.y,
        size: x.size,
        styleId: x.styleId,
      };
    });
  const palette = BUILTIN_TEMPLATES[Math.floor(Math.random() * BUILTIN_TEMPLATES.length)]!.look.colors;
  return {
    version: 1,
    id: `mia-${uid()}`,
    name,
    description: `${slots.length} ${slots.length === 1 ? 'espacio' : 'espacios'} para tus fotos y videos`,
    aspect: p.aspect,
    slots,
    fields: [],
    texts,
    look: { colors: palette, motif: 'bubbles' },
    custom: true,
    createdAt: Date.now(),
  };
}

// The user's own templates are small JSON (no media), kept in localStorage.
const KEY = 'clipo.templates';

export function loadUserTemplates(): Template[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((t) => t?.version === 1 && Array.isArray(t.slots)) : [];
  } catch {
    return [];
  }
}

export function saveUserTemplate(t: Template) {
  localStorage.setItem(KEY, JSON.stringify([t, ...loadUserTemplates().filter((x) => x.id !== t.id)]));
}

export function deleteUserTemplate(id: string) {
  localStorage.setItem(KEY, JSON.stringify(loadUserTemplates().filter((x) => x.id !== id)));
}
