import { ChevronLeft, CircleHelp, Redo2, Undo2, Upload } from 'lucide-react';
import { useStore } from '../store';
import { engine } from '../engine';
import { saveProject } from '../db';
import { SaveTemplateButton } from '../templates/SaveTemplateButton';

export function TopBar() {
  const name = useStore((s) => s.project!.name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const s = useStore.getState;

  const back = async () => {
    engine.pause();
    const p = s().project;
    if (p) await saveProject(p).catch(() => {});
    s().close();
  };

  return (
    <header className="topbar">
      <button className="icon-btn" onClick={back} aria-label="Volver a mis proyectos" title="Mis proyectos">
        <ChevronLeft />
      </button>
      <input
        className="title-input"
        value={name}
        aria-label="Nombre del proyecto"
        onFocus={() => s().checkpoint()}
        onChange={(e) => s().live((p) => void (p.name = e.target.value))}
      />
      <div className="spacer" />
      <button className="icon-btn labeled" disabled={!canUndo} onClick={() => s().undo()} title="Deshacer (Ctrl+Z)">
        <Undo2 size={20} />
        <span>Deshacer</span>
      </button>
      <button className="icon-btn labeled" disabled={!canRedo} onClick={() => s().redo()} title="Rehacer (Ctrl+Y)">
        <Redo2 size={20} />
        <span>Rehacer</span>
      </button>
      <SaveTemplateButton />
      <button className="icon-btn" onClick={() => s().setPanel('help')} aria-label="Ayuda" title="Ayuda">
        <CircleHelp size={20} />
      </button>
      <button className="btn-primary export-btn" onClick={() => { engine.pause(); s().setPanel('export'); }}>
        <Upload size={18} /> Exportar
      </button>
    </header>
  );
}
