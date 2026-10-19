import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose } from 'lucide-react';
import { useStore } from '../store';
import { engine } from '../engine';
import { deleteSelected, splitAtPlayhead } from '../ops';
import { TopBar } from './TopBar';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import { Sheet } from './Panels';
import { MediaLibrary } from './MediaLibrary';
import { Onboarding } from './Onboarding';
import { importAndAdd } from './ImportButton';
import { useKeyboardInset } from './useKeyboardInset';

const LIBRARY_KEY = 'clipo.library';

export function Editor() {
  const [dragging, setDragging] = useState(false);
  // The "Tus archivos" column (wide screens only) can be hidden to give the preview more room.
  const [libraryOpen, setLibraryOpen] = useState(() => {
    try {
      return localStorage.getItem(LIBRARY_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const toggleLibrary = () => {
    setLibraryOpen((v) => {
      try {
        localStorage.setItem(LIBRARY_KEY, v ? '0' : '1');
      } catch {
        /* private mode: remembered for this session only */
      }
      return !v;
    });
  };
  const exporting = useStore((s) => s.exporting);
  const root = useRef<HTMLDivElement>(null);
  useKeyboardInset();

  // iOS Safari: a stray pinch inside the editor would zoom the whole app (Preview handles its own pinch).
  useEffect(() => {
    const el = root.current!;
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener('gesturestart', stop);
    return () => el.removeEventListener('gesturestart', stop);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const s = useStore.getState();
      if (s.exporting) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        engine.toggle();
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
      } else if (!mod && key === 's') {
        splitAtPlayhead();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        engine.seek(s.time + (e.key === 'ArrowLeft' ? -step : step));
      } else if (e.key === 'Escape') {
        if (s.panel) s.setPanel(null);
        else s.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      engine.pause();
    };
  }, []);

  return (
    <div
      ref={root}
      className={`editor ${exporting ? 'exporting' : ''} ${libraryOpen ? '' : 'library-off'}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) importAndAdd(e.dataTransfer.files);
      }}
    >
      <TopBar libraryOpen={libraryOpen} onToggleLibrary={toggleLibrary} />
      <div className="workspace">
        <aside className="library-side" aria-label="Tus archivos">
          <div className="library-head">
            <h3>Tus archivos</h3>
            <button className="icon-btn" onClick={toggleLibrary} aria-label="Ocultar tus archivos" title="Ocultar">
              <PanelLeftClose size={18} />
            </button>
          </div>
          <MediaLibrary />
        </aside>
        <Preview />
      </div>
      <Timeline />
      <Toolbar />
      <Sheet />
      <Onboarding />
      {dragging && <div className="drop-overlay">Suelta tus archivos aquí</div>}
    </div>
  );
}
