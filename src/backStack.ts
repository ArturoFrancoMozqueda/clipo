import { useEffect, useRef } from 'react';

/**
 * The system "back" (Android button or gesture, browser back, mouse back button) closes whatever is
 * on top: a dialog, then the open panel, then the editor, instead of leaving the app.
 *
 * Each open layer owns one history entry. Back pops the entry and we close the top layer; closing a
 * layer from the UI removes its entry with history.back() and ignores the popstate that follows.
 * On Android the native shell (MainActivity) sends back to the WebView while it can go back, so the
 * same entries drive the phone app.
 */

interface Layer {
  /** Return false to stay open (e.g. a dialog that can't be dismissed right now). */
  onBack: () => boolean | void;
}

const stack: Layer[] = [];
let ignorePops = 0;
let listening = false;

function onPop() {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const top = stack[stack.length - 1];
  if (!top) return;
  if (top.onBack() === false) {
    history.pushState({ clipoLayer: stack.length }, ''); // still open: put its entry back
    return;
  }
  // Closing it normally calls release(), which then finds it already gone.
  const i = stack.lastIndexOf(top);
  if (i >= 0) stack.splice(i, 1);
}

/** Adds a back-closable layer. Returns `release`, to call when the layer closes some other way. */
export function pushBackLayer(onBack: Layer['onBack']): () => void {
  if (typeof window === 'undefined' || typeof history === 'undefined') return () => {};
  if (!listening) {
    window.addEventListener('popstate', onPop);
    listening = true;
  }
  const layer: Layer = { onBack };
  stack.push(layer);
  history.pushState({ clipoLayer: stack.length }, '');
  return () => {
    const i = stack.lastIndexOf(layer);
    if (i < 0) return; // closed by back: its entry is already gone
    stack.splice(i, 1);
    ignorePops++;
    history.back();
  };
}

/** While `active`, the system back calls `onBack` instead of leaving the screen. */
export function useBackLayer(active: boolean, onBack: () => boolean | void) {
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    if (!active) return;
    return pushBackLayer(() => cb.current());
  }, [active]);
}

/** Number of open layers (for tests). */
export const backDepth = () => stack.length;
