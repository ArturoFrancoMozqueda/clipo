import { useState } from 'react';
import { LayoutTemplate, X } from 'lucide-react';
import type { Project } from '../types';
import { useStore } from '../store';
import { engine } from '../engine';
import { saveUserTemplate, templateFromProject } from './build';
import { TemplatePreview } from './TemplatePreview';
import { ASPECTS } from '../model';
import type { Template } from './types';
import './templates.css';

/** Save a project's structure (order, durations, filters, texts — not its media) as a template. */
export function SaveTemplateButton({ project, className = 'icon-btn labeled tpl-topbar-btn' }: { project?: Project; className?: string }) {
  const [draft, setDraft] = useState<Template | null>(null);
  const [name, setName] = useState('');

  const open = () => {
    engine.pause();
    const s = useStore.getState();
    const p = project ?? s.project;
    if (!p?.clips.length) return s.notify('Agrega al menos una foto o video para guardar una plantilla');
    setName(p.name);
    setDraft(templateFromProject(p, p.name));
  };

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
        {!project && <span>Plantilla</span>}
      </button>
      {draft && a && (
        <div className="modal-backdrop" onClick={() => setDraft(null)}>
          <div className="modal tpl-save" role="dialog" aria-modal="true" aria-label="Guardar como plantilla" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>Guardar como plantilla</h3>
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
          </div>
        </div>
      )}
    </>
  );
}
