import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Modal } from './Modal';
import { isIOS } from '../nativeShare';

/** Safari on iPhone has no "install" prompt: Clipo shows the steps itself until it runs from the home screen. */
function needsIosHint(): boolean {
  if (!isIOS() || Capacitor.isNativePlatform()) return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || matchMedia('(display-mode: standalone)').matches;
  return !standalone;
}

export function IosInstallButton() {
  const [show] = useState(needsIosHint);
  const [open, setOpen] = useState(false);
  if (!show) return null;
  return (
    <>
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        <Download size={18} /> Instalar app
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy="ios-install-title" className="ios-install">
          <header>
            <h3 id="ios-install-title">Instala Clipo en tu iPhone</h3>
            <button className="icon-btn" aria-label="Cerrar" onClick={() => setOpen(false)}>
              <X />
            </button>
          </header>
          <p className="muted">Se abre a pantalla completa, funciona sin internet y tus proyectos quedan guardados en el iPhone.</p>
          <ol className="ios-steps">
            <li>
              <span className="step-icon"><Share size={20} /></span>
              <div>Toca <b>Compartir</b> en la barra de Safari.</div>
            </li>
            <li>
              <span className="step-icon"><SquarePlus size={20} /></span>
              <div>Elige <b>Agregar a inicio</b> (desliza hacia abajo si no lo ves).</div>
            </li>
            <li>
              <span className="step-icon"><img src="./icon.svg" alt="" width={20} height={20} /></span>
              <div>Abre Clipo desde su ícono en tu pantalla de inicio.</div>
            </li>
          </ol>
          <button className="btn-primary full" onClick={() => setOpen(false)}>Entendido</button>
        </Modal>
      )}
    </>
  );
}
