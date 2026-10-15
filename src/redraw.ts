// Tiny bus for "something the preview shows just changed" (a font, a sticker picture or a person
// mask finished loading). The engine only redraws when told, so drawing code that starts an async
// load calls requestRedraw() when it lands instead of relying on a 60 fps loop. No DOM access at
// import, so the drawing modules stay importable from Node tests.

const listeners = new Set<() => void>();

export function requestRedraw() {
  listeners.forEach((l) => l());
}

export function onRedraw(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const watched = new WeakSet<object>();

/** Redraw once when a picture that isn't decoded yet finishes loading (hooked once per image). */
export function redrawWhenLoaded(img: HTMLImageElement) {
  if (img.complete || watched.has(img)) return;
  watched.add(img);
  const done = () => {
    img.removeEventListener('load', done);
    img.removeEventListener('error', done);
    requestRedraw();
  };
  img.addEventListener('load', done);
  img.addEventListener('error', done);
}

