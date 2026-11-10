import { lazy, Suspense } from 'react';
import { useStore } from './store';
import { Home } from './components/Home';
import { Toast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfirmHost } from './components/confirm';

// The editor (preview engine, timeline, panels) loads only when a project opens, so the start
// screen appears sooner, above all on phones.
const Editor = lazy(() => import('./components/Editor').then((m) => ({ default: m.Editor })));
// Warm it up once the start screen is idle, so opening a project doesn't wait for the download.
// (A failed warm-up is not an error: the real import retries when a project opens.)
const preload = () => void import('./components/Editor').catch(() => {});
if ('requestIdleCallback' in window) requestIdleCallback(preload, { timeout: 4000 });
else setTimeout(preload, 2000);

function EditorLoading() {
  return (
    <div className="editor-loading" role="status">
      <div className="spinner" aria-hidden="true" />
      <p>Abriendo el editor…</p>
    </div>
  );
}

export default function App() {
  const open = useStore((s) => !!s.project);
  return (
    <>
      {open ? (
        <ErrorBoundary onHome={() => useStore.getState().close()}>
          <Suspense fallback={<EditorLoading />}>
            <Editor />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <ErrorBoundary onHome={() => location.reload()}>
          <Home />
        </ErrorBoundary>
      )}
      <ConfirmHost />
      <Toast />
    </>
  );
}
