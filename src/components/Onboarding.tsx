import { useEffect, useState } from 'react';
import { Hand, MousePointerClick, Plus, Upload } from 'lucide-react';

const KEY = 'clipo.onboarded';

const STEPS = [
  { icon: Plus, title: 'Agrega tus videos y fotos', text: 'Toca “Agregar”. Se ponen en orden, uno detrás de otro, en la línea de tiempo.' },
  { icon: Hand, title: 'Desliza para moverte', text: 'La línea blanca del centro marca el momento que ves. Desliza la línea de tiempo para elegir dónde cortar.' },
  { icon: MousePointerClick, title: 'Toca algo para editarlo', text: 'Abajo aparecen sus herramientas: dividir, velocidad, filtros… ¿Te equivocaste? Toca “Deshacer”.' },
  { icon: Upload, title: 'Guarda tu video', text: 'Cuando termines, toca “Exportar”. Tu proyecto se guarda solo mientras trabajas.' },
];

export const showOnboarding = () => window.dispatchEvent(new Event('clipo:onboarding'));

export function Onboarding() {
  const [step, setStep] = useState<number | null>(() => {
    try {
      return localStorage.getItem(KEY) ? null : 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    const h = () => setStep(0);
    window.addEventListener('clipo:onboarding', h);
    return () => window.removeEventListener('clipo:onboarding', h);
  }, []);

  if (step === null) return null;
  const done = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private mode: show again next time */
    }
    setStep(null);
  };
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="modal-backdrop">
      <div className="modal onboarding" role="dialog" aria-labelledby="ob-title">
        <div className="ob-icon"><s.icon size={36} /></div>
        <h3 id="ob-title">{s.title}</h3>
        <p>{s.text}</p>
        <div className="ob-dots">
          {STEPS.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}
        </div>
        <div className="ob-actions">
          <button className="btn-ghost" onClick={done}>Saltar</button>
          <button className="btn-primary" onClick={() => (last ? done() : setStep(step + 1))}>
            {last ? '¡Empezar!' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
}
