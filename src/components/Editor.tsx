import { useEffect, useState } from 'react';
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

export function Editor() {
  const [dragging, setDragging] = useState(false);
  const exporting = useStore((s) => s.exporting);

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
      className={`editor ${exporting ? 'exporting' : ''}`}
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
      <TopBar />
      <div className="workspace">
        <aside className="library-side">
          <h3>Tus archivos</h3>
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
