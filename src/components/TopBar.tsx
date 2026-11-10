import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, CircleAlert, CircleHelp, Ellipsis, Keyboard, LayoutTemplate, PanelLeftOpen, Redo2, Undo2, Upload } from 'lucide-react';
import { useStore } from '../store';
import { engine } from '../engine';
import { discardProject, isUntouched, saveNow, useSaveState } from '../saveState';
import { openShortcuts } from './Shortcuts';
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

/** "Guardando…" / "Guardado": the user always knows the work is safe. */
function SaveBadge() {
  const status = useSaveState((s) => s.status);
  const text = status === 'saved' ? 'Guardado' : status === 'error' ? 'Sin guardar' : 'Guardando…';
  return (
    <span className={`save-badge ${status}`} role="status" title={status === 'error' ? 'No se pudo guardar en este dispositivo. Puede que falte espacio.' : 'Tu proyecto se guarda solo en este dispositivo.'}>
      {status === 'saved' ? <Check size={14} aria-hidden /> : status === 'error' ? <CircleAlert size={14} aria-hidden /> : <span className="dot" aria-hidden />}
      <span>{text}</span>
    </span>
  );
}

export function TopBar({ libraryOpen, onToggleLibrary }: { libraryOpen: boolean; onToggleLibrary: () => void }) {
  const name = useStore((s) => s.project!.name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const s = useStore.getState;

  const [leaving, setLeaving] = useState(false);
  const back = async () => {
    if (leaving) return;
    setLeaving(true);
    engine.pause();
    const p = s().project;
    // Opened and left empty: don't leave a blank "Mi video" in the list.
    if (p && isUntouched(p)) await discardProject(p);
    else await saveNow();
    s().close();
  };

  return (
    <header className="topbar">
      <button className="icon-btn" onClick={back} disabled={leaving} aria-label="Volver a mis proyectos" title="Mis proyectos">
        <ChevronLeft />
      </button>
      <input
        className="title-input"
        value={name}
        aria-label="Nombre del proyecto"
        maxLength={80}
        placeholder="Nombre del proyecto"
        onFocus={() => s().checkpoint()}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onBlur={(e) => !e.target.value.trim() && s().live((p) => void (p.name = 'Mi video'))}
        onChange={(e) => s().live((p) => void (p.name = e.target.value))}
      />
      <SaveBadge />
      <div className="spacer" />
      {!libraryOpen && (
        <button className="icon-btn labeled topbar-library" onClick={onToggleLibrary} title="Ver tus archivos" aria-label="Ver tus archivos">
          <PanelLeftOpen size={20} />
          <span>Tus archivos</span>
        </button>
      )}
      <button className="icon-btn labeled" disabled={!canUndo} onClick={() => s().undo()} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
        <Undo2 size={20} />
        <span>Deshacer</span>
      </button>
      <button className="icon-btn labeled" disabled={!canRedo} onClick={() => s().redo()} title="Rehacer (Ctrl+Y)" aria-label="Rehacer">
        <Redo2 size={20} />
        <span>Rehacer</span>
      </button>
      <SaveTemplateButton />
      <button className="icon-btn topbar-keys" onClick={openShortcuts} aria-label="Atajos de teclado" title="Atajos de teclado (?)">
        <Keyboard size={20} />
      </button>
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
