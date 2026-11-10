// Finding sounds quickly: Spanish search with synonyms (accents and plurals don't matter), plus
// favorites and recently used sounds remembered on the device.

/** Lower case, no accents, no punctuation. */
export const fold = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s+-]/g, ' ').replace(/\s+/g, ' ').trim();

/** Words people use for the same thing. Any word of a group finds the others. */
const GROUPS: string[][] = [
  ['aplauso', 'aplausos', 'ovacion', 'palmas', 'clap', 'publico'],
  ['golpe', 'impacto', 'boom', 'hit', 'remate', 'punchline', 'estruendo'],
  ['dinero', 'plata', 'billete', 'moneda', 'monedas', 'cash', 'pago', 'ganancia', 'venta', 'caja', 'ka-ching'],
  ['susto', 'miedo', 'terror', 'horror', 'sorpresa'],
  ['foto', 'camara', 'captura', 'obturador', 'flash'],
  ['mensaje', 'chat', 'notificacion', 'aviso', 'whatsapp', 'alerta'],
  ['error', 'fallo', 'incorrecto', 'equivocado', 'mal', 'buzzer'],
  ['correcto', 'acierto', 'bien', 'ding', 'logro', 'exito'],
  ['triste', 'fail', 'fracaso', 'sad', 'perder', 'decepcion', 'llorar'],
  ['subida', 'riser', 'sube', 'build', 'tension', 'suspenso', 'crescendo'],
  ['bajo', 'grave', 'bass', '808', 'sub', 'drop'],
  ['viento', 'aire', 'whoosh', 'swoosh', 'pase', 'barrido', 'transicion'],
  ['tiempo', 'reloj', 'tictac', 'cuenta', 'timer', 'temporizador', 'cronometro'],
  ['magia', 'magico', 'brillo', 'destello', 'estrellas', 'hada', 'shimmer', 'sparkle'],
  ['teclado', 'escribir', 'tipear', 'typing', 'teclas'],
  ['gracioso', 'comico', 'humor', 'meme', 'chiste', 'caricatura', 'broma'],
  ['disco', 'vinilo', 'scratch', 'dj', 'rayado'],
  ['latido', 'corazon', 'nervios'],
  ['glitch', 'falla', 'digital', 'tecnologia', 'robot'],
  ['relajante', 'asmr', 'suave', 'calma', 'tranquilo'],
  ['juego', 'videojuego', 'gamer', 'arcade', '8bit', 'nivel'],
  ['oscuro', 'phonk', 'drift', 'autos', 'carros'],
  ['telefono', 'llamada', 'celular', 'timbre'],
  ['lluvia', 'agua', 'gota', 'mar', 'olas'],
];

const synonyms = new Map<string, Set<string>>();
for (const g of GROUPS) {
  for (const w of g) {
    const set = synonyms.get(w) ?? new Set<string>();
    for (const x of g) set.add(x);
    synonyms.set(w, set);
  }
}

/** Singular-ish form, so "monedas" finds "moneda". */
const stem = (w: string) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

export interface Searchable {
  name: string;
  use: string;
  category: string;
  tags?: string;
}

/**
 * How well a sound matches a search, 0 = not at all. Every word must match (the word itself, the
 * start of a word, or a synonym); matches in the name count most.
 */
export function matchScore(s: Searchable, query: string): number {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return 1;
  const name = fold(s.name);
  const rest = fold(`${s.use} ${s.category} ${s.tags ?? ''}`);
  const nameWords = name.split(' ');
  const restWords = rest.split(' ');
  let total = 0;
  for (const w of words) {
    const alts = [w, stem(w), ...(synonyms.get(w) ?? synonyms.get(stem(w)) ?? [])];
    let best = 0;
    for (const a of alts) {
      const exact = a === w || a === stem(w);
      if (nameWords.some((x) => x === a || stem(x) === a)) best = Math.max(best, exact ? 10 : 4);
      else if (name.includes(a) && a.length > 2) best = Math.max(best, exact ? 7 : 3);
      else if (restWords.some((x) => x === a || stem(x) === a)) best = Math.max(best, exact ? 5 : 2);
      else if (a.length > 2 && rest.includes(a)) best = Math.max(best, exact ? 3 : 1);
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

/** Filter and order by relevance. Equal scores keep the original order. */
export function searchSounds<T extends Searchable>(list: T[], query: string): T[] {
  if (!fold(query)) return list;
  return list
    .map((s, i) => ({ s, score: matchScore(s, query), i }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.s);
}

// ---------- favorites and recents ----------

const FAV_KEY = 'clipo.sfx.favorites';
const RECENT_KEY = 'clipo.sfx.recent';
export const MAX_RECENT = 12;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStore = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

function readList(key: string, store: Store | null): string[] {
  try {
    const v = JSON.parse(store?.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeList(key: string, list: string[], store: Store | null) {
  try {
    store?.setItem(key, JSON.stringify(list));
  } catch {
    /* private mode or full storage: it just won't be remembered */
  }
}
const pickStore = (store?: Store | null) => (store === undefined ? defaultStore() : store);

export const loadFavorites = (store?: Store | null) => readList(FAV_KEY, pickStore(store));
export const loadRecents = (store?: Store | null) => readList(RECENT_KEY, pickStore(store));

/** Add or remove a favorite; returns the new list (newest first). */
export function toggleFavorite(id: string, store?: Store | null): string[] {
  const cur = loadFavorites(store);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur];
  writeList(FAV_KEY, next, pickStore(store));
  return next;
}

/** Put a sound at the front of "Recientes"; returns the new list. */
export function pushRecent(id: string, store?: Store | null): string[] {
  const next = [id, ...loadRecents(store).filter((x) => x !== id)].slice(0, MAX_RECENT);
  writeList(RECENT_KEY, next, pickStore(store));
  return next;
}

/** The sounds for a list of ids, in that order, skipping ids that no longer exist. */
export function byIds<T extends { id: string }>(all: T[], ids: string[]): T[] {
  const map = new Map(all.map((s) => [s.id, s]));
  return ids.flatMap((id) => (map.has(id) ? [map.get(id)!] : []));
}
