import { lazy, Suspense } from 'react';
import { useStore } from './store';
import { Home } from './components/Home';
import { Toast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';

// The editor (preview engine, timeline, panels) loads only when a project opens, so the start
// screen appears sooner, above all on phones.
const Editor = lazy(() => import('./components/Editor').then((m) => ({ default: m.Editor })));
// Warm it up once the start screen is idle, so opening a project doesn't wait for the download.
const preload = () => void import('./components/Editor');
if ('requestIdleCallback' in window) requestIdleCallback(preload, { timeout: 4000 });
else setTimeout(preload, 2000);

export default function App() {
  const open = useStore((s) => !!s.project);
  return (
    <>
      {open ? (
        <ErrorBoundary onHome={() => useStore.getState().close()}>
          <Suspense fallback={<div className="editor-loading" role="status" aria-label="Abriendo el editor"><div className="spinner" /></div>}>
            <Editor />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <ErrorBoundary onHome={() => location.reload()}>
          <Home />
        </ErrorBoundary>
      )}
      <Toast />
    </>
  );
}
