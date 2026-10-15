import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import { collectGarbage, holdTabLock, projectAssetIds, requestPersistence } from './db';
import { createAutosave } from './autosave';
import { startPublishing } from './publish/store';
import './styles.css';

// Autosave: every edit is written to the device shortly after the editing pauses.
const autosave = createAutosave({
  onError: () =>
    useStore
      .getState()
      .notify('No se pudo guardar tu proyecto en este dispositivo. Puede que falte espacio: libera espacio o guarda el video antes de cerrar.'),
});
useStore.subscribe((s, prev) => {
  if (s.project !== prev.project) autosave.changed(s.project);
});
window.addEventListener('pagehide', () => void autosave.flush());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void autosave.flush());
requestPersistence();
holdTabLock();
// Desktop app only: reload the publish queue and its local scheduler.
startPublishing().catch((e) => console.error(e));

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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
