// Run with: npm test. Project list helpers of the start screen and the save status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/hooks.ts';
import { sampleProject } from './fixtures/project.ts';
import type { Project } from '../src/types.ts';

const { copyName, filterProjects, fmtLength, relativeDate, sortProjects } = await import('../src/projectActions.ts');
const { isUntouched, trackedSave, useSaveState, markPending } = await import('../src/saveState.ts');

const metas = [
  { name: 'Cumpleaños de Sofía', updatedAt: 300, duration: 12 },
  { name: 'viaje a la playa', updatedAt: 100, duration: 95 },
  { name: 'Receta 2', updatedAt: 200, duration: 40 },
  { name: 'Receta 10', updatedAt: 50, duration: 40 },
];

test('la búsqueda ignora acentos y mayúsculas, y pide todas las palabras', () => {
  assert.deepEqual(filterProjects(metas, 'cumpleanos sofia').map((m) => m.name), ['Cumpleaños de Sofía']);
  assert.deepEqual(filterProjects(metas, 'RECETA').length, 2);
  assert.equal(filterProjects(metas, '   ').length, metas.length);
  assert.equal(filterProjects(metas, 'playa montaña').length, 0);
});

test('ordenar proyectos no cambia la lista original', () => {
  const before = metas.map((m) => m.name);
  assert.deepEqual(sortProjects(metas, 'recent').map((m) => m.updatedAt), [300, 200, 100, 50]);
  assert.deepEqual(sortProjects(metas, 'oldest').map((m) => m.updatedAt), [50, 100, 200, 300]);
  assert.deepEqual(sortProjects(metas, 'name').map((m) => m.name), ['Cumpleaños de Sofía', 'Receta 2', 'Receta 10', 'viaje a la playa']);
  assert.deepEqual(sortProjects(metas, 'longest').map((m) => m.name), ['viaje a la playa', 'Receta 2', 'Receta 10', 'Cumpleaños de Sofía']);
  assert.deepEqual(metas.map((m) => m.name), before);
});

test('el nombre de una copia nunca se repite', () => {
  assert.equal(copyName('Viaje', ['Viaje']), 'Viaje (copia)');
  assert.equal(copyName('Viaje', ['Viaje', 'viaje (COPIA)']), 'Viaje (copia 2)');
  assert.equal(copyName('Viaje (copia)', ['Viaje', 'Viaje (copia)']), 'Viaje (copia 2)');
  assert.equal(copyName('Viaje (copia 2)', ['Viaje', 'Viaje (copia)', 'Viaje (copia 2)']), 'Viaje (copia 3)');
  assert.equal(copyName('  ', []), 'Mi video (copia)');
});

test('fechas relativas en palabras', () => {
  const now = new Date(2026, 4, 20, 15, 0).getTime();
  assert.equal(relativeDate(now - 20_000, now), 'Hace un momento');
  assert.equal(relativeDate(now - 5 * 60_000, now), 'Hace 5 min');
  assert.match(relativeDate(now - 3 * 3_600_000, now), /^Hoy, /);
  assert.equal(relativeDate(new Date(2026, 4, 19, 23, 50).getTime(), now), 'Ayer');
  assert.equal(relativeDate(new Date(2026, 4, 17, 9, 0).getTime(), now), 'Hace 3 días');
  assert.doesNotMatch(relativeDate(new Date(2026, 1, 2).getTime(), now), /2026/);
  assert.match(relativeDate(new Date(2025, 1, 2).getTime(), now), /2025/);
  assert.equal(relativeDate(now + 5000, now), 'Hace un momento'); // clock moved back
});

test('duración en palabras', () => {
  assert.equal(fmtLength(0), '0 s');
  assert.equal(fmtLength(45.4), '45 s');
  assert.equal(fmtLength(60), '1 min');
  assert.equal(fmtLength(80), '1 min 20 s');
});

test('un proyecto vacío se reconoce; uno con contenido no', () => {
  const full = sampleProject() as Project;
  assert.equal(isUntouched(full), false);
  const empty: Project = { ...full, assets: {}, clips: [], texts: [], audios: [], stickers: [], overlays: [] };
  assert.equal(isUntouched(empty), true);
  assert.equal(isUntouched({ ...empty, texts: full.texts.length ? full.texts : [{} as Project['texts'][number]] }), false);
});

test('el estado de guardado sigue a cada escritura', async () => {
  const p = sampleProject() as Project;
  markPending();
  assert.equal(useSaveState.getState().status, 'pending');
  let release!: () => void;
  const slow = trackedSave(p, () => new Promise<void>((r) => (release = r)));
  assert.equal(useSaveState.getState().status, 'saving');
  markPending(); // an edit during the write doesn't hide "Guardando…"
  assert.equal(useSaveState.getState().status, 'saving');
  release();
  await slow;
  assert.equal(useSaveState.getState().status, 'saved');
  await assert.rejects(trackedSave(p, () => Promise.reject(new Error('lleno'))));
  assert.equal(useSaveState.getState().status, 'error');
});
