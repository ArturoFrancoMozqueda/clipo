import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import { requestPersistence, saveProject } from './db';
import './styles.css';

// Autosave: every edit is written to the device shortly after it happens.
let saveTimer: number | undefined;
useStore.subscribe((s, prev) => {
  if (s.project && s.project !== prev.project) {
    const p = s.project;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveProject(p).catch(() => {}), 600);
  }
});
window.addEventListener('pagehide', () => {
  const p = useStore.getState().project;
  if (p) saveProject(p).catch(() => {});
});
requestPersistence();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
