// Repair a saved project before opening it: fill fields missing in older or damaged saves with
// their defaults and drop pieces that can't be shown, so one bad save never breaks the editor.
import type { Asset, AudioItem, Clip, OverlayItem, Project, StickerItem, TextItem } from './types';
import { ASPECTS } from './model';

type Loose = Record<string, unknown>;

const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const list = (v: unknown): Loose[] => (Array.isArray(v) ? v.filter(isObj) : []);
const KINDS = new Set(['video', 'image', 'audio']);

let n = 0;
const freshId = () => `fix${Date.now().toString(36)}${(n++).toString(36)}`;
const idOf = (v: unknown) => (typeof v === 'string' && v ? v : freshId());

/** A copy of a saved project with missing or broken fields filled with defaults. */
export function normalizeProject(raw: Project): Project {
  const p = raw as unknown as Loose;
  if (!isObj(p)) throw new Error('not a project');
  const now = Date.now();

  const assets: Record<string, Asset> = {};
  for (const [id, a] of Object.entries(isObj(p.assets) ? p.assets : {})) {
    if (!isObj(a) || !KINDS.has(a.kind as string)) continue;
    assets[id] = { ...(a as unknown as Asset), id, name: str(a.name, 'Archivo'), duration: num(a.duration, 0), width: num(a.width, 0), height: num(a.height, 0) };
  }
  const known = (id: unknown) => typeof id === 'string' && id in assets;

  const clips = list(p.clips)
    .filter((c) => known(c.assetId))
    .map((c): Clip => {
      const inP = Math.max(0, num(c.in, 0));
      return {
        ...(c as unknown as Clip),
        id: idOf(c.id),
        in: inP,
        out: Math.max(inP + 0.01, num(c.out, inP + 3)),
        speed: num(c.speed, 1) > 0 ? num(c.speed, 1) : 1,
        volume: num(c.volume, 1),
        filter: str(c.filter, 'none'),
        fit: c.fit === 'fill' ? 'fill' : 'fit',
      };
    });

  const texts = list(p.texts).map((t): TextItem => ({
    ...(t as unknown as TextItem),
    id: idOf(t.id),
    text: str(t.text, ''),
    start: Math.max(0, num(t.start, 0)),
    duration: Math.max(0.1, num(t.duration, 3)),
    x: num(t.x, 0.5),
    y: num(t.y, 0.75),
    size: num(t.size, 0.075),
    styleId: str(t.styleId, 'clasico'),
  }));

  const audios = list(p.audios)
    .filter((a) => known(a.assetId))
    .map((a): AudioItem => {
      const inP = Math.max(0, num(a.in, 0));
      return {
        ...(a as unknown as AudioItem),
        id: idOf(a.id),
        start: Math.max(0, num(a.start, 0)),
        in: inP,
        out: Math.max(inP + 0.01, num(a.out, inP + 1)),
        volume: num(a.volume, 1),
        fadeIn: Math.max(0, num(a.fadeIn, 0)),
        fadeOut: Math.max(0, num(a.fadeOut, 0)),
      };
    });

  const stickers = list(p.stickers)
    .filter((s) => typeof s.emoji === 'string' || known(s.assetId))
    .map((s): StickerItem => ({
      ...(s as unknown as StickerItem),
      id: idOf(s.id),
      start: Math.max(0, num(s.start, 0)),
      duration: Math.max(0.1, num(s.duration, 3)),
      x: num(s.x, 0.5),
      y: num(s.y, 0.5),
      size: num(s.size, 0.25),
      rotation: num(s.rotation, 0),
    }));

  const overlays =
    p.overlays === undefined
      ? undefined
      : list(p.overlays)
          .filter((o) => known(o.assetId))
          .map((o): OverlayItem => {
            const inP = Math.max(0, num(o.in, 0));
            return {
              ...(o as unknown as OverlayItem),
              id: idOf(o.id),
              start: Math.max(0, num(o.start, 0)),
              in: inP,
              out: Math.max(inP + 0.01, num(o.out, inP + 3)),
              volume: num(o.volume, 1),
              x: num(o.x, 0.7),
              y: num(o.y, 0.28),
              size: num(o.size, 0.42),
              rotation: num(o.rotation, 0),
              opacity: num(o.opacity, 1),
              blend: (str(o.blend, 'normal') as OverlayItem['blend']),
            };
          });

  const luts: Project['luts'] = {};
  for (const [id, l] of Object.entries(isObj(p.luts) ? p.luts : {})) {
    if (isObj(l) && typeof l.data === 'string' && num(l.size, 0) > 1) luts[id] = l as unknown as NonNullable<Project['luts']>[string];
  }

  const out: Project = {
    ...(p as unknown as Project),
    id: idOf(p.id),
    name: str(p.name, 'Mi video'),
    aspect: typeof p.aspect === 'string' && p.aspect in ASPECTS ? (p.aspect as Project['aspect']) : '9:16',
    assets,
    clips,
    texts,
    audios,
    stickers,
    createdAt: num(p.createdAt, now),
    updatedAt: num(p.updatedAt, now),
  };
  if (overlays) out.overlays = overlays;
  if (p.luts !== undefined) out.luts = luts;
  if (p.audioMix !== undefined && !isObj(p.audioMix)) delete out.audioMix;
  if (p.publish !== undefined && !isObj(p.publish)) delete out.publish;
  return out;
}
