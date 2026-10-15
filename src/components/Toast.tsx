import { useEffect, useState } from 'react';
import { useStore } from '../store';

export function Toast() {
  const toast = useStore((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  const show = !!toast && visible;
  // The live region stays mounted so screen readers announce every change of its text.
  return (
    <div className="toast-live" role="status" aria-live="polite">
      {show && (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
