import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

/** Long messages (an error with what to do next) stay long enough to be read. */
export const toastMs = (text: string) => Math.min(9000, Math.max(2600, 1200 + text.length * 55));

export function Toast() {
  const toast = useStore((s) => s.toast);
  const [visible, setVisible] = useState(false);
  // Reading it with the mouse over it (or keyboard focus on it) keeps it on screen.
  const [held, setHeld] = useState(false);
  const shownId = useRef(0);

  useEffect(() => {
    if (!toast) return;
    // A new message: show it, and forget a hover left over from the previous one.
    if (shownId.current !== toast.id) {
      shownId.current = toast.id;
      setVisible(true);
      if (held) return setHeld(false); // this effect runs again with held = false
    }
    if (held) return;
    const t = setTimeout(() => setVisible(false), toastMs(toast.text));
    return () => clearTimeout(t);
  }, [toast, held]);

  const show = !!toast && visible;
  // The live region stays mounted so screen readers announce every change of its text.
  return (
    <div className="toast-live" role="status" aria-live="polite">
      {show && (
        <button
          type="button"
          className="toast"
          key={toast.id}
          title="Cerrar aviso"
          onClick={() => setVisible(false)}
          onPointerEnter={(e) => e.pointerType === 'mouse' && setHeld(true)}
          onPointerLeave={() => setHeld(false)}
        >
          {toast.text}
        </button>
      )}
    </div>
  );
}
