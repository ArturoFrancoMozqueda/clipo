// In-app replacements for the browser's confirm(), alert() and prompt(): same look as the rest of
// the app, keyboard and screen-reader friendly, and they work inside the desktop and phone apps.
//
//   if (!(await confirmDialog({ title: '¿Eliminar "Mi video"?', message: 'No se puede deshacer.', confirmLabel: 'Eliminar', danger: true }))) return;
//   const name = await promptDialog({ title: 'Cambiar nombre', label: 'Nombre', value: old });   // null = canceled
//   await alertDialog({ title: 'No se pudo abrir', message: '…' });
//
// <ConfirmHost /> must be mounted once (App.tsx). Calls made while another dialog is open wait their turn.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Modal } from './Modal';

export interface ConfirmOptions {
  title: string;
  /** Extra explanation under the title. */
  message?: ReactNode;
  /** Text of the main button (default "Aceptar"). Name the action: "Eliminar", "Desconectar"… */
  confirmLabel?: string;
  /** Text of the secondary button (default "Cancelar"). */
  cancelLabel?: string;
  /** Destructive action: red main button, and the keyboard focus starts on "Cancelar". */
  danger?: boolean;
}

export interface PromptOptions extends Omit<ConfirmOptions, 'danger'> {
  /** Visible label of the text field. */
  label: string;
  /** Initial text (selected, so typing replaces it). */
  value?: string;
  placeholder?: string;
  maxLength?: number;
  /** Accept an empty answer (default: the main button stays disabled until something is typed). */
  allowEmpty?: boolean;
}

export type AlertOptions = Pick<ConfirmOptions, 'title' | 'message' | 'confirmLabel'>;

type Request =
  | ({ kind: 'confirm'; resolve(v: boolean): void } & ConfirmOptions)
  | ({ kind: 'alert'; resolve(v: boolean): void } & AlertOptions)
  | ({ kind: 'prompt'; resolve(v: string | null): void } & PromptOptions);

let queue: (Request & { id: number })[] = [];
let nextId = 0;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function ask<T extends Request>(r: T) {
  queue = [...queue, { ...r, id: ++nextId }];
  emit();
}

/** Ask a yes/no question. Resolves true only when the main button is pressed (Escape = false). */
export function confirmDialog(o: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof o === 'string' ? { title: o } : o;
  // No host on screen (should not happen in the app): fall back to the browser's own dialog.
  if (!hosts) return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(opts.title) : false);
  return new Promise((resolve) => ask({ kind: 'confirm', resolve, ...opts }));
}

/** Show a message that needs to be read. Resolves when it is closed. */
export function alertDialog(o: AlertOptions | string): Promise<void> {
  const opts = typeof o === 'string' ? { title: o } : o;
  if (!hosts) {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(opts.title);
    return Promise.resolve();
  }
  return new Promise((resolve) => ask({ kind: 'alert', resolve: () => resolve(), ...opts }));
}

/** Ask for a short text. Resolves with the trimmed text, or null when canceled. */
export function promptDialog(o: PromptOptions): Promise<string | null> {
  if (!hosts) {
    const v = typeof window !== 'undefined' && typeof window.prompt === 'function' ? window.prompt(o.title, o.value ?? '') : null;
    return Promise.resolve(v == null ? null : v.trim());
  }
  return new Promise((resolve) => ask({ kind: 'prompt', resolve, ...o }));
}

/** Renders the dialog being asked now. Mount once, near the root. */
export function ConfirmHost() {
  const current = useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => queue[0],
  );
  useEffect(() => {
    hosts++;
    return () => {
      hosts--;
      // Nobody left to answer: cancel what is waiting so no caller hangs forever.
      if (!hosts) {
        const left = queue;
        queue = [];
        for (const r of left) r.kind === 'prompt' ? r.resolve(null) : r.resolve(false);
      }
    };
  }, []);
  if (!current) return null;
  return <Dialog key={current.id} r={current} />;
}

function Dialog({ r }: { r: Request & { id: number } }) {
  const [text, setText] = useState(r.kind === 'prompt' ? (r.value ?? '') : '');
  const main = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const danger = r.kind === 'confirm' && !!r.danger;

  // After the modal opened (its own focus pass runs first): the safest control gets the focus.
  useEffect(() => {
    if (r.kind === 'prompt') {
      input.current?.focus();
      input.current?.select();
    } else (danger ? cancel : main).current?.focus();
  }, [r.kind, danger]);

  const finish = (ok: boolean) => {
    queue = queue.filter((x) => x.id !== r.id);
    if (r.kind === 'prompt') r.resolve(ok ? text.trim() : null);
    else r.resolve(ok);
    emit();
  };
  const canSubmit = r.kind !== 'prompt' || r.allowEmpty || !!text.trim();

  return (
    <Modal onClose={() => finish(false)} labelledBy="confirm-title" className="confirm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) finish(true);
        }}
      >
        {danger && (
          <span className="confirm-icon" aria-hidden="true">
            <TriangleAlert size={22} />
          </span>
        )}
        <h3 id="confirm-title">{r.title}</h3>
        {r.message && <div className="confirm-message">{r.message}</div>}
        {r.kind === 'prompt' && (
          <label className="confirm-field">
            <span>{r.label}</span>
            <input
              ref={input}
              className="field"
              value={text}
              placeholder={r.placeholder}
              maxLength={r.maxLength ?? 80}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        )}
        <div className="confirm-actions">
          {r.kind !== 'alert' && (
            <button ref={cancel} type="button" className="btn-ghost" onClick={() => finish(false)}>
              {r.cancelLabel ?? 'Cancelar'}
            </button>
          )}
          <button ref={main} type="submit" className={danger ? 'btn-danger' : 'btn-primary'} disabled={!canSubmit}>
            {r.confirmLabel ?? (r.kind === 'alert' ? 'Entendido' : 'Aceptar')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
