// A small project with one item of every kind, for store and editing tests.
import type { Project } from '../../src/types.ts';

export function sampleProject(): Project {
  return {
    id: 'p1',
    name: 'Prueba',
    aspect: '9:16',
    assets: {
      v1: { id: 'v1', kind: 'video', name: 'a.mp4', duration: 10, width: 1080, height: 1920, thumb: 'data:image/jpeg;base64,' + 'A'.repeat(5000) },
      a1: { id: 'a1', kind: 'audio', name: 'musica.mp3', duration: 30, width: 0, height: 0 },
      i1: { id: 'i1', kind: 'image', name: 'foto.png', duration: 600, width: 100, height: 100 },
    },
    clips: [
      { id: 'c1', assetId: 'v1', in: 0, out: 10, speed: 1, volume: 1, filter: 'none', fit: 'fit', transition: { type: 'fade', duration: 0.5 } },
      { id: 'c2', assetId: 'v1', in: 2, out: 6, speed: 2, volume: 1, filter: 'none', fit: 'fit' },
    ],
    texts: [{ id: 't1', text: 'Hola', start: 1, duration: 4, x: 0.5, y: 0.5, size: 0.1, styleId: 'clasico', anim: { in: 'fade', out: 'pop', loop: 'none' } }],
    audios: [{ id: 'au1', assetId: 'a1', start: 0, in: 5, out: 25, volume: 0.8, fadeIn: 2, fadeOut: 3 }],
    stickers: [{ id: 's1', start: 2, duration: 4, x: 0.5, y: 0.5, size: 0.2, rotation: 0, emoji: '🔥' }],
    overlays: [
      { id: 'o1', assetId: 'v1', start: 1, in: 1, out: 5, volume: 1, x: 0.5, y: 0.5, size: 0.4, rotation: 0, opacity: 1, blend: 'normal' },
      { id: 'o2', assetId: 'i1', start: 0, in: 0, out: 4, volume: 1, x: 0.5, y: 0.5, size: 0.4, rotation: 0, opacity: 1, blend: 'normal' },
    ],
    luts: { l1: { id: 'l1', name: 'Look', size: 2, data: 'B'.repeat(10000) } },
    createdAt: 1,
    updatedAt: 1,
  };
}
