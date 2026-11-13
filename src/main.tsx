import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import { collectGarbage, holdTabLock, projectAssetIds, requestPersistence, toStorageError } from './db';
import { createAutosave } from './autosave';
import { markPending, markSaved, setSaveNow, trackedSave } from './saveState';
// UI font, bundled so it works offline (the video text fonts load on demand in fonts.ts).
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
// Display face of the brand: the start screen's headline and the dialog titles.
import '@fontsource/bricolage-grotesque/latin-700.css';
import '@fontsource/bricolage-grotesque/latin-800.css';
// Monospace for timecodes and durations.
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles.css';

// Autosave: every edit is written to the device shortly after the editing pauses.
const autosave = createAutosave({
  save: (p) => trackedSave(p),
  // toStorageError says what happened and what to do (full disk, private window…).
  onError: (e) => useStore.getState().notify(toStorageError(e).message),
});
useStore.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  autosave.changed(s.project);
  // The top bar shows "Guardando…" / "Guardado": only edits of the same project count as unsaved.
  if (s.project && prev.project?.id === s.project.id) markPending();
  else markSaved();
});
setSaveNow(() => autosave.flush());
window.addEventListener('pagehide', () => void autosave.flush());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void autosave.flush());
requestPersistence();
holdTabLock();
// Desktop app only: reload the publish queue and its local scheduler.
// (Loaded on demand so the start screen doesn't wait for publishing code it never uses on phones.)
import('./publish/store')
  .then((m) => m.startPublishing())
  .catch((e) => console.warn('Clipo: no se pudo cargar la cola de publicación', e));
// Light copies of heavy videos for a smooth preview, made in the background.
// (Also on demand: it only has work once a project with videos is open.)
import('./proxies')
  .then((m) => m.startProxies())
  .catch((e) => console.warn('Clipo: no se pudo iniciar la optimización de videos', e));

// Free media left behind (e.g. a file imported and then undone) once the app is idle.
const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 10_000 }) : setTimeout(fn, 3000));
setTimeout(
  () =>
    idle(() => {
      const s = useStore.getState();
      const keep = [s.project, ...s.past, ...s.future].flatMap((p) => (p ? projectAssetIds(p) : []));
      collectGarbage(keep).catch((e) => console.warn('Clipo: no se pudo limpiar el almacenamiento', e));
    }),
  5000,
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dev builds only: lets playback tests read the store and the engine.
if (import.meta.env.DEV) void import('./engine').then(({ engine }) => Object.assign(window, { __clipo: { engine, useStore } }));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
