import { useStore } from './store';
import { Home } from './components/Home';
import { Editor } from './components/Editor';
import { Toast } from './components/Toast';

export default function App() {
  const open = useStore((s) => !!s.project);
  return (
    <>
      {open ? <Editor /> : <Home />}
      <Toast />
    </>
  );
}
