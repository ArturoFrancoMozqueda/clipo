import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, CircleHelp, Ellipsis, LayoutTemplate, Redo2, Undo2, Upload } from 'lucide-react';
import { useStore } from '../store';
import { engine } from '../engine';
import { saveProject } from '../db';
import { SaveTemplateButton, openSaveTemplate } from '../templates/SaveTemplateButton';

/** "⋯" menu that holds the secondary actions on narrow phones (CSS shows it only there). */
function MoreMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="topbar-more" ref={box}>
      <button
        ref={btn}
        className="icon-btn"
        aria-label="Más opciones"
        title="Más opciones"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Ellipsis size={20} />
      </button>
      {open && (
        <div className="topbar-menu" role="menu">
          <button role="menuitem" onClick={run(openSaveTemplate)}>
            <LayoutTemplate size={18} /> Guardar como plantilla
          </button>
          <button role="menuitem" onClick={run(() => useStore.getState().setPanel('help'))}>
            <CircleHelp size={18} /> Ayuda
          </button>
        </div>
      )}
    </div>
  );
}

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
      <button className="icon-btn labeled" disabled={!canUndo} onClick={() => s().undo()} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
        <Undo2 size={20} />
        <span>Deshacer</span>
      </button>
      <button className="icon-btn labeled" disabled={!canRedo} onClick={() => s().redo()} title="Rehacer (Ctrl+Y)" aria-label="Rehacer">
        <Redo2 size={20} />
        <span>Rehacer</span>
      </button>
      <SaveTemplateButton />
      <button className="icon-btn topbar-help" onClick={() => s().setPanel('help')} aria-label="Ayuda" title="Ayuda">
        <CircleHelp size={20} />
      </button>
      <MoreMenu />
      <button className="btn-primary export-btn" aria-label="Exportar" title="Exportar" onClick={() => { engine.pause(); s().setPanel('export'); }}>
        <Upload size={18} /> <span className="export-label">Exportar</span>
      </button>
    </header>
  );
}
