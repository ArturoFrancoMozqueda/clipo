import { useEffect, useState } from 'react';
import { LayoutTemplate, X } from 'lucide-react';
import type { Project } from '../types';
import { useStore } from '../store';
import { engine } from '../engine';
import { saveUserTemplate, templateFromProject } from './build';
import { TemplatePreview } from './TemplatePreview';
import { ASPECTS } from '../model';
import type { Template } from './types';
import { Modal } from '../components/Modal';
import './templates.css';

const OPEN_EVENT = 'clipo:save-template';
/** Opens the editor's "save as template" dialog (used by the top bar's "⋯" menu on phones). */
export const openSaveTemplate = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** Save a project's structure (order, durations, filters, texts — not its media) as a template. */
export function SaveTemplateButton({
  project,
  load,
  className = 'icon-btn labeled tpl-topbar-btn',
}: {
  project?: Project;
  /** Loads the project on demand (the start screen only keeps summaries). */
  load?: () => Promise<Project | undefined>;
  className?: string;
}) {
  const [draft, setDraft] = useState<Template | null>(null);
  const [name, setName] = useState('');

  const own = !!(project || load);
  const open = async () => {
    engine.pause();
    const s = useStore.getState();
    const p = project ?? (load ? await load().catch(() => undefined) : s.project);
    if (!p?.clips.length) return s.notify('Agrega al menos una foto o video para guardar una plantilla');
    setName(p.name);
    setDraft(templateFromProject(p, p.name));
  };

  // The top-bar instance (no `project`) also answers the "⋯" menu; its button is hidden on phones.
  useEffect(() => {
    if (own) return;
    const h = () => void open();
    window.addEventListener(OPEN_EVENT, h);
    return () => window.removeEventListener(OPEN_EVENT, h);
  });

  const save = () => {
    if (!draft) return;
    try {
      saveUserTemplate({ ...draft, name: name.trim() || draft.name });
      useStore.getState().notify('Plantilla guardada. La verás en “Usar una plantilla”.');
      setDraft(null);
    } catch {
      useStore.getState().notify('No hay espacio para guardar la plantilla');
    }
  };

  const a = draft && ASPECTS[draft.aspect];
  return (
    <>
      <button className={className} onClick={open} title="Guardar como plantilla" aria-label="Guardar como plantilla">
        <LayoutTemplate size={20} />
        {!own && <span>Plantilla</span>}
      </button>
      {draft && a && (
        <Modal onClose={() => setDraft(null)} labelledBy="tpl-save-title" className="tpl-save">
            <header>
              <h3 id="tpl-save-title">Guardar como plantilla</h3>
              <button className="icon-btn" aria-label="Cerrar" onClick={() => setDraft(null)}>
                <X />
              </button>
            </header>
            <p className="muted">
              Se guardan el orden, la duración, los filtros y los textos. Tus fotos y videos no: cada vez que la uses
              elegirás otros nuevos ({draft.slots.length} {draft.slots.length === 1 ? 'espacio' : 'espacios'}).
            </p>
            <div className="tpl-save-row">
              <TemplatePreview template={draft} width={Math.round(Math.min(140, (180 * a.w) / a.h))} />
              <label className="tpl-field">
                <span>Nombre de la plantilla</span>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
              </label>
            </div>
            <button className="btn-primary full big" onClick={save}>
              <LayoutTemplate size={20} /> Guardar plantilla
            </button>
        </Modal>
      )}
    </>
  );
}
