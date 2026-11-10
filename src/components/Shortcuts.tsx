import { X } from 'lucide-react';
import { Modal } from './Modal';

/** Opened with "?" (desktop) or from the top bar's help menu. */
export const openShortcuts = () => window.dispatchEvent(new Event('clipo:shortcuts'));

const ROWS: { keys: string[][]; what: string }[] = [
  { keys: [['Espacio']], what: 'Reproducir o pausar' },
  { keys: [['S']], what: 'Dividir en la línea blanca' },
  { keys: [['Supr']], what: 'Eliminar lo seleccionado' },
  { keys: [['Ctrl', 'Z']], what: 'Deshacer' },
  { keys: [['Ctrl', 'Y'], ['Ctrl', 'Shift', 'Z']], what: 'Rehacer' },
  { keys: [['←'], ['→']], what: 'Avanzar o retroceder un fotograma' },
  { keys: [['Shift', '←'], ['Shift', '→']], what: 'Avanzar o retroceder un segundo' },
  { keys: [['Esc']], what: 'Cerrar el panel o soltar la selección' },
  { keys: [['?']], what: 'Ver esta lista' },
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} labelledBy="keys-title" className="shortcuts">
      <header>
        <h3 id="keys-title">Atajos de teclado</h3>
        <button className="icon-btn" aria-label="Cerrar" onClick={onClose}>
          <X />
        </button>
      </header>
      <dl className="keys-list">
        {ROWS.map((r) => (
          <div key={r.what}>
            <dt>
              {r.keys.map((combo, i) => (
                <span key={i}>
                  {i > 0 && <i> o </i>}
                  {combo.map((k, j) => (
                    <span key={k}>{j > 0 && '+'}<kbd>{k}</kbd></span>
                  ))}
                </span>
              ))}
            </dt>
            <dd>{r.what}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">Con Ctrl + rueda del ratón acercas o alejas la línea de tiempo.</p>
    </Modal>
  );
}
