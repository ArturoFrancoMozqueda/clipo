import type { Clip, Project } from '../types';
import { layout } from '../model';
import { uid, itemsOf } from '../store';
import { FILTERS } from '../filters';
import { TRANSITIONS, EFFECTS } from '../visuals';
import { TEXT_STYLES } from '../textStyles';
import { FONTS } from '../fonts';
import type { EditOperation } from './schema';

export function catalog() {
  const names = <T extends { id: string; name: string }>(xs: T[]) => xs.map(({ id, name }) => ({ id, name }));
  return { filters: names(FILTERS), transitions: names(TRANSITIONS), effects: names(EFFECTS), textStyles: names(TEXT_STYLES), fonts: names(FONTS) };
}

function checkCatalog(p: Project, original: Project) {
  const known = (list: { id: string }[], id: string) => list.some((x) => x.id === id);
  const ids = new Set<string>();
  const previous = new Map([...original.clips, ...original.texts, ...original.audios, ...(original.overlays ?? []), ...(original.stickers ?? [])].map((x) => [x.id, x]));
  for (const item of [...p.clips, ...p.texts, ...p.audios, ...(p.overlays ?? []), ...(p.stickers ?? [])]) {
    if (ids.has(item.id)) throw new Error(`Id duplicado: ${item.id}`);
    ids.add(item.id);
    if ('assetId' in item && item.assetId) {
      const a = Object.hasOwn(p.assets, item.assetId) ? p.assets[item.assetId] : undefined;
      if (!a) throw new Error(`Archivo inexistente: ${item.assetId}`);
      if ('speed' in item && a.kind === 'audio') throw new Error('Un clip necesita video o imagen.');
      if ('fadeIn' in item && a.kind === 'image') throw new Error('Un audio necesita un archivo con sonido.');
      if ('blend' in item && a.kind === 'audio') throw new Error('Una superposición necesita video o imagen.');
      if ('emoji' in item && a.kind !== 'image') throw new Error('Un sticker necesita una imagen.');
      if ('in' in item && 'out' in item && !('freeze' in item && item.freeze !== undefined)) {
        if (item.in < 0 || item.out <= item.in || item.out > a.duration + 0.001) throw new Error(`Recorte fuera del archivo: ${a.name}`);
      }
      if ('freeze' in item && item.freeze !== undefined && (a.kind !== 'video' || item.freeze >= a.duration || item.in !== 0 || item.speed !== 1 || item.volume !== 0)) throw new Error('Congelado inválido: video, tiempo de origen válido, in=0, speed=1, volume=0.');
      if ('bgRemoval' in item && item.bgRemoval?.mode === 'media' && (!item.bgRemoval.assetId || !p.assets[item.bgRemoval.assetId] || p.assets[item.bgRemoval.assetId]!.kind === 'audio')) throw new Error('El fondo necesita una imagen o video existente.');
      if ('reframe' in item && item.reframe?.points.some((k, i, xs) => k.t > a.duration || (i > 0 && k.t <= xs[i - 1]!.t))) throw new Error('Ruta de reencuadre inválida.');
    }
    if ('lut' in item && item.lut && !Object.hasOwn(p.luts ?? {}, item.lut.id)) throw new Error('LUT inexistente.');
    if ('filter' in item && item.filter && !known(FILTERS, item.filter)) throw new Error(`Filtro desconocido: ${item.filter}`);
    if ('transition' in item && item.transition && !known(TRANSITIONS, item.transition.type)) throw new Error('Transición desconocida.');
    if ('effect' in item && item.effect && !known(EFFECTS, item.effect.id)) throw new Error('Efecto desconocido.');
    if ('styleId' in item && !known(TEXT_STYLES, item.styleId)) throw new Error(`Estilo desconocido: ${item.styleId}`);
    if ('font' in item && item.font && !known(FONTS, item.font)) throw new Error(`Fuente desconocida: ${item.font}`);
    if ('crop' in item && item.crop && (item.crop.w <= 0 || item.crop.h <= 0 || item.crop.x + item.crop.w > 1.001 || item.crop.y + item.crop.h > 1.001)) throw new Error('El encuadre sale de la imagen.');
    if ('fadeIn' in item && (item.fadeIn > item.out - item.in || item.fadeOut > item.out - item.in)) throw new Error('El fundido supera la duración del audio.');
    const prev = previous.get(item.id);
    const sameTiming = prev && ('duration' in item && 'duration' in prev ? item.duration === prev.duration : 'in' in item && 'in' in prev && item.in === prev.in && item.out === prev.out);
    const existingWords = sameTiming && prev && 'words' in prev && 'words' in item && JSON.stringify(prev.words) === JSON.stringify(item.words);
    if (!existingWords && 'duration' in item && 'words' in item && item.words?.some((w) => w.end <= w.start || w.end > item.duration + 0.001)) throw new Error('Tiempos de palabras inválidos.');
    if ('keyframes' in item && item.keyframes) {
      const duration = 'duration' in item ? item.duration : 'in' in item ? item.out - item.in : 0;
      const existingFrames = sameTiming && prev && 'keyframes' in prev && JSON.stringify(prev.keyframes) === JSON.stringify(item.keyframes);
      if (item.keyframes.some((k, i, frames) => (!existingFrames && (k.t < 0 || k.t > duration + 0.001)) || !Number.isFinite(k.t) || (i > 0 && k.t <= frames[i - 1]!.t))) throw new Error('Los keyframes deben estar ordenados dentro de la duración.');
    }
  }
  if (p.publish?.coverTime !== undefined && p.publish.coverTime > layout(p).reduce((m, c) => Math.max(m, c.end), 0)) throw new Error('Portada fuera de la pista principal.');
  for (const s of p.stickers ?? []) {
    if (!s.emoji && !s.assetId) throw new Error('El sticker necesita emoji o imagen.');
    if (s.assetId && p.assets[s.assetId]?.kind !== 'image') throw new Error('Un sticker necesita una imagen.');
  }
}

/** Prepare a whole batch on a copy. Nothing is committed if any operation is invalid. */
export function applyEdits(project: Project, operations: EditOperation[]) {
  const p = structuredClone(project);
  const added: { kind: string; id: string }[] = [];
  const addId = (kind: string) => { const id = uid(); added.push({ kind, id }); return id; };
  const update = <T extends { id: string }>(list: T[], id: string, changes: object) => {
    const item = list.find((x) => x.id === id);
    if (!item) throw new Error(`Elemento inexistente: ${id}`);
    Object.assign(item, changes);
  };
  for (const op of operations) {
    switch (op.op) {
      case 'settings': {
        if (op.name !== undefined) p.name = op.name;
        if (op.aspect !== undefined) p.aspect = op.aspect;
        if (op.audioMix !== undefined) p.audioMix = op.audioMix;
        if (op.publish !== undefined) p.publish = { ...p.publish, ...op.publish };
        break;
      }
      case 'clear': {
        const item = itemsOf(p, op.kind).find((x) => x.id === op.id);
        if (!item) throw new Error('Elemento inexistente.');
        const allowed = { clip: ['transition','effect','color','bgRemoval','voiceFx','lut','freeze','reframe','crop','flipH','flipV'], text: ['font','fill','anim','words','karaoke','keyframes','opacity'], audio: ['voiceFx'], overlay: ['color','keyframes'], sticker: ['keyframes','opacity'] };
        for (const field of op.fields) {
          if (!allowed[op.kind].includes(field)) throw new Error('Campo incompatible con el elemento.');
          delete (item as unknown as Record<string, unknown>)[field];
        }
        break;
      }
      case 'duplicate': {
        const list = itemsOf(p, op.kind);
        const index = list.findIndex((x) => x.id === op.id);
        if (index < 0) throw new Error('Elemento inexistente.');
        const copy = structuredClone(list[index]!) as { id: string; start?: number };
        copy.id = addId(op.kind);
        if (op.start !== undefined) {
          if (op.kind === 'clip') throw new Error('Los clips principales se insertan después del original.');
          copy.start = op.start;
        }
        list.splice(index + 1, 0, copy);
        break;
      }
      case 'split_item': {
        const list = itemsOf(p, op.kind);
        const index = list.findIndex((x) => x.id === op.id);
        if (index < 0) throw new Error('Elemento inexistente.');
        const item = list[index]! as unknown as { id: string; start: number; duration?: number; in?: number; out?: number; fadeIn?: number; fadeOut?: number; words?: { text: string; start: number; end: number }[]; keyframes?: unknown[] };
        const length = item.duration ?? item.out! - item.in!;
        const offset = op.at - item.start;
        if (offset < 0.01 || offset > length - 0.01) throw new Error('El corte debe quedar dentro del elemento.');
        // Retiming animated poses across a cut needs interpolation; reject rather than
        // silently corrupting animation. Static items and timed captions are supported.
        if (item.keyframes?.length) throw new Error('Divide el elemento sin keyframes o retima sus poses explícitamente.');
        const second = structuredClone(item);
        second.id = addId(op.kind); second.start = op.at;
        if (item.duration !== undefined) { item.duration = offset; second.duration = length - offset; }
        else { second.in = item.in! + offset; item.out = second.in; }
        if (item.words) {
          second.words = item.words.filter((w) => w.end > offset).map((w) => ({ ...w, start: Math.max(0, w.start - offset), end: w.end - offset }));
          item.words = item.words.filter((w) => w.start < offset).map((w) => ({ ...w, end: Math.min(offset, w.end) }));
        }
        if (item.fadeIn !== undefined) { second.fadeIn = 0; item.fadeIn = Math.min(item.fadeIn, offset); second.fadeOut = Math.min(second.fadeOut!, length - offset); item.fadeOut = 0; }
        list.splice(index + 1, 0, second);
        break;
      }
      case 'add_clip': {
        const index = op.index ?? p.clips.length;
        if (index > p.clips.length) throw new Error('Posición de clip inexistente.');
        p.clips.splice(index, 0, { ...op.clip, id: addId('clip') } as Clip);
        break;
      }
      case 'update_clip': update(p.clips, op.id, op.changes); break;
      case 'split_clip': {
        const hit = layout(p).find((x) => x.clip.id === op.id);
        if (!hit) throw new Error('Clip inexistente.');
        if (op.at <= hit.start + 0.01 || op.at >= hit.end - 0.01) throw new Error('El corte debe quedar dentro del clip.');
        const c = hit.clip;
        const second = { ...structuredClone(c), id: addId('clip') };
        if (c.freeze !== undefined) { second.out = hit.end - op.at; c.out = op.at - hit.start; }
        else { second.in = c.in + (op.at - hit.start) * c.speed; c.out = second.in; }
        delete c.transition;
        p.clips.splice(hit.index + 1, 0, second);
        break;
      }
      case 'reorder_clips': {
        if (op.clipIds.length !== p.clips.length || new Set(op.clipIds).size !== p.clips.length) throw new Error('Incluye cada clip una sola vez.');
        p.clips = op.clipIds.map((id) => { const c = p.clips.find((c) => c.id === id); if (!c) throw new Error(`Clip inexistente: ${id}`); return c; });
        break;
      }
      case 'add_text': p.texts.push({ ...op.text, id: addId('text') }); break;
      case 'update_text': update(p.texts, op.id, op.changes); break;
      case 'add_audio': p.audios.push({ ...op.audio, id: addId('audio') }); break;
      case 'update_audio': update(p.audios, op.id, op.changes); break;
      case 'add_overlay': (p.overlays ??= []).push({ ...op.overlay, id: addId('overlay') }); break;
      case 'update_overlay': update(p.overlays ?? [], op.id, op.changes); break;
      case 'add_sticker': (p.stickers ??= []).push({ ...op.sticker, id: addId('sticker') }); break;
      case 'update_sticker': update(p.stickers ?? [], op.id, op.changes); break;
      case 'delete': {
        const list = { clip: p.clips, text: p.texts, audio: p.audios, overlay: p.overlays ?? [], sticker: p.stickers ?? [] }[op.kind];
        const i = list.findIndex((x) => x.id === op.id);
        if (i < 0) throw new Error(`Elemento inexistente: ${op.id}`);
        list.splice(i, 1);
        break;
      }
    }
  }
  checkCatalog(p, project);
  return { project: p, added };
}
