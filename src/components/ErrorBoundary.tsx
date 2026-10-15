import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Leave the broken screen, e.g. close the project and go back to the start screen. */
  onHome(): void;
}

/** Catches a crash in the editor and offers a way out instead of a blank screen. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="home" role="alert" style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', textAlign: 'center' }}>
        <div>
          <h2>Algo salió mal</h2>
          <p>Vuelve al inicio para abrir tu proyecto otra vez, o recarga la página.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
            <button
              className="btn-primary"
              onClick={() => {
                this.props.onHome();
                this.setState({ failed: false });
              }}
            >
              Volver al inicio
            </button>
            <button className="btn-ghost" onClick={() => location.reload()}>
              Recargar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
