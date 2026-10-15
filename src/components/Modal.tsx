import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  /** Called on Escape, backdrop click or the browser closing the dialog. Omit for a modal that can't be dismissed. */
  onClose?: () => void;
  /** While false, Escape and backdrop clicks are ignored (e.g. during an import). */
  dismissible?: boolean;
  /** Id of the heading that names the dialog. */
  labelledBy?: string;
  /** Accessible name when there is no visible heading. */
  label?: string;
  /** Classes for the content box (always gets `modal`). */
  className?: string;
  /** Extra classes for the full-screen <dialog> that acts as the backdrop. */
  backdropClassName?: string;
  children: ReactNode;
}

/**
 * Accessible modal on a native <dialog> opened with showModal(): the rest of the page becomes inert
 * (focus stays inside), Escape closes it, focus starts on the first control (or [autofocus]) and
 * returns to where it was when the modal closes.
 */
export function Modal({ onClose, dismissible = true, labelledBy, label, className = '', backdropClassName = '', children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const canClose = useRef(dismissible);
  closeRef.current = onClose;
  canClose.current = dismissible && !!onClose;
  const downOnBackdrop = useRef(false);

  useLayoutEffect(() => {
    const d = ref.current!;
    const back = document.activeElement as HTMLElement | null;
    if (!d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', ''); // very old WebViews
      }
    }
    if (!d.contains(document.activeElement)) {
      const first = d.querySelector<HTMLElement>('[autofocus], button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
      (first ?? d).focus();
    }
    const cancel = (e: Event) => {
      e.preventDefault(); // React state decides whether it closes
      if (canClose.current) closeRef.current?.();
    };
    // The browser may still force it closed (e.g. a second Escape): keep React in sync.
    // (The event is async: ignore a stale one from a close()+showModal() pair, e.g. StrictMode remounts.)
    const close = () => !d.open && closeRef.current?.();
    d.addEventListener('cancel', cancel);
    d.addEventListener('close', close);
    return () => {
      d.removeEventListener('cancel', cancel);
      d.removeEventListener('close', close);
      if (d.open) d.close();
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  // Escape handled here must not also reach the editor's global shortcuts.
  useEffect(() => {
    const d = ref.current!;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.stopPropagation();
    };
    d.addEventListener('keydown', key);
    return () => d.removeEventListener('keydown', key);
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal-dialog ${backdropClassName}`}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      tabIndex={-1}
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        // Only a press that starts and ends on the backdrop (not a drag out of a text field).
        if (e.target === e.currentTarget && downOnBackdrop.current && canClose.current) closeRef.current?.();
        downOnBackdrop.current = false;
      }}
    >
      <div className={`modal ${className}`}>{children}</div>
    </dialog>
  );
}
