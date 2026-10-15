import { useStore } from './store';
import { Home } from './components/Home';
import { Editor } from './components/Editor';
import { Toast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  const open = useStore((s) => !!s.project);
  return (
    <>
      {open ? (
        <ErrorBoundary onHome={() => useStore.getState().close()}>
          <Editor />
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
