import { Component, type ReactNode } from 'react';
import { RotateCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Leave the broken screen, e.g. close the project and go back to the start screen. */
  onHome(): void;
}

/** Catches a crash in the editor and offers a way out instead of a blank screen. */
export class ErrorBoundary extends Component<Props, { failed: boolean; offline: boolean }> {
  state = { failed: false, offline: false };

  static getDerivedStateFromError(error: unknown) {
    // A part of the app that could not be downloaded (no signal, or a new version was published).
    const offline = /dynamically imported module|Importing a module script failed|Failed to fetch|Loading chunk/i.test(String((error as Error)?.message ?? error));
    return { failed: true, offline };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { offline } = this.state;
    return (
      <div className="crash" role="alert">
        <div className="crash-box">
          <img src="./icon.svg" alt="" width={56} height={56} />
          <h2>{offline ? 'No se pudo cargar esta parte de Clipo' : 'Algo salió mal'}</h2>
          <p>
            {offline
              ? 'Revisa tu conexión a internet y vuelve a cargar. Tus proyectos siguen guardados en este dispositivo.'
              : 'Tu proyecto está a salvo: se guarda solo mientras trabajas. Vuelve al inicio para abrirlo otra vez.'}
          </p>
          <div className="crash-actions">
            {!offline && (
              <button
                className="btn-primary"
                onClick={() => {
                  this.props.onHome();
                  this.setState({ failed: false });
                }}
              >
                Volver al inicio
              </button>
            )}
            <button className={offline ? 'btn-primary' : 'btn-ghost'} onClick={() => location.reload()}>
              <RotateCw size={18} /> Volver a cargar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
