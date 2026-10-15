// Copy-on-write edits (a tiny immer): `produce(base, fn)` lets `fn` mutate a draft and returns a
// new object that reuses every part `fn` did not touch. Undo snapshots are then just references,
// and big untouched data (asset thumbnails, LUTs) is shared instead of copied on every edit.
// Only plain objects and arrays are drafted (projects are JSON-like data); `base` is never changed.

const STATE = Symbol('draft');

type Obj = Record<PropertyKey, unknown>;

interface DraftState {
  base: Obj;
  copy: Obj | null;
  modified: boolean;
  parent: DraftState | null;
  /** Not part of the tree `produce` started from (a value assigned during the edit). */
  foreign: boolean;
  finalized: boolean;
  /** Result of finalizing, so a draft referenced twice ends up as one object. */
  done?: unknown;
}

const isPlain = (v: unknown): v is Obj => {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const stateOf = (v: unknown): DraftState | undefined =>
  v !== null && typeof v === 'object' ? (v as { [STATE]?: DraftState })[STATE] : undefined;

export const isDraft = (v: unknown) => !!stateOf(v);

const has = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);
const latest = (s: DraftState) => s.copy ?? s.base;

function prepareCopy(s: DraftState): Obj {
  if (!s.copy) s.copy = Array.isArray(s.base) ? (s.base.slice() as unknown as Obj) : { ...s.base };
  return s.copy;
}

function markModified(s: DraftState) {
  for (let cur: DraftState | null = s; cur && !cur.modified; cur = cur.parent) {
    cur.modified = true;
    prepareCopy(cur);
  }
}

function createDraft(base: Obj, parent: DraftState | null, foreign: boolean): object {
  const state: DraftState = { base, copy: null, modified: false, parent, foreign, finalized: false };
  // The target only has to look like the base (array or not) for Array.isArray and proxy invariants.
  const target: object = Array.isArray(base) ? [] : {};
  const proxy: Obj = new Proxy(target as Obj, {
    get(_t, prop) {
      if (prop === STATE) return state;
      const src = latest(state);
      const value = src[prop];
      if (!has(src, prop) || !isPlain(value) || stateOf(value)) return value;
      // Hand out a draft (kept in our copy) so nested edits are copy-on-write too.
      const child = createDraft(value, state, state.foreign || value !== state.base[prop]);
      prepareCopy(state)[prop] = child;
      return child;
    },
    set(_t, prop, value) {
      const src = latest(state);
      if (!state.modified) {
        if (src[prop] === value && (value !== undefined || has(src, prop))) return true;
        markModified(state);
      }
      state.copy![prop] = value;
      return true;
    },
    deleteProperty(_t, prop) {
      if (!has(latest(state), prop)) return true;
      markModified(state);
      delete state.copy![prop];
      return true;
    },
    defineProperty(_t, prop, desc) {
      markModified(state);
      if ('value' in desc) state.copy![prop] = desc.value;
      return true;
    },
    has: (_t, prop) => prop in latest(state),
    ownKeys: () => Reflect.ownKeys(latest(state)),
    getOwnPropertyDescriptor(t, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(latest(state), prop);
      if (!desc) return undefined;
      // Must agree with the empty target, where only an array's `length` is non-configurable.
      const fixed = Reflect.getOwnPropertyDescriptor(t, prop);
      return { writable: true, enumerable: desc.enumerable, configurable: !(fixed && !fixed.configurable), value: proxy[prop] };
    },
    getPrototypeOf: () => Object.getPrototypeOf(state.base),
    setPrototypeOf: () => false,
  });
  return proxy;
}

/** Finalize the values of `obj` in place; with `original`, values still equal to it are skipped. */
function walk(obj: Obj, seen: Set<object>, original?: Obj) {
  if (seen.has(obj)) return;
  seen.add(obj);
  const arr = Array.isArray(obj);
  for (const k of Reflect.ownKeys(obj)) {
    if (arr && k === 'length') continue;
    const v = obj[k];
    if (original && v === original[k]) continue;
    if (v === null || typeof v !== 'object') continue;
    const f = finalize(v, seen);
    if (f !== v) obj[k] = f;
  }
}

/** Replace drafts with their final objects. Values assigned during the edit are searched for drafts. */
function finalize(value: unknown, seen: Set<object>): unknown {
  const s = stateOf(value);
  if (!s) {
    if (isPlain(value)) walk(value, seen);
    return value;
  }
  if (s.finalized) return s.done;
  s.finalized = true;
  if (!s.modified) {
    s.done = s.base;
    // Untouched parts of the original tree hold no drafts; assigned values might.
    if (s.foreign) walk(s.base, seen);
    return s.base;
  }
  s.done = s.copy;
  walk(s.copy!, seen, s.foreign ? undefined : s.base);
  return s.copy;
}

/**
 * Run `fn` on a draft of `base` and return the result. Untouched objects keep their identity;
 * if nothing changed, `base` itself is returned.
 */
export function produce<T extends object>(base: T, fn: (draft: T) => void): T {
  const root = createDraft(base as unknown as Obj, null, false) as T;
  fn(root);
  return finalize(root, new Set()) as T;
}
