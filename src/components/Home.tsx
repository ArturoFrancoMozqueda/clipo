import { lazy, Suspense, useEffect, useState } from 'react';
import { Download, Film, FolderInput, LayoutTemplate, Plus, Trash2, X } from 'lucide-react';
import type { AspectId } from '../types';
import { deleteProject, getBlob, getProject, listProjectMeta, type ProjectMeta } from '../db';
import { useStore } from '../store';
import { newProject } from '../ops';
import { fmtTime } from '../model';
import { FormatPicker } from './FormatPicker';
import { Modal } from './Modal';
import { useInstallPrompt } from './useInstallPrompt';
import { SaveTemplateButton } from '../templates/SaveTemplateButton';

// Opened on demand from the start screen.
const TemplateGallery = lazy(() => import('../templates/TemplateGallery').then((m) => ({ default: m.TemplateGallery })));
const CapcutImport = lazy(() => import('./CapcutImport').then((m) => ({ default: m.CapcutImport })));

export function Home() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  // "Nuevo video" shortcut of the installed app (manifest shortcuts) opens the format picker.
  const [picking, setPicking] = useState(() => new URLSearchParams(location.search).has('nuevo'));
  useEffect(() => {
    const url = new URL(location.href);
    if (!url.searchParams.has('nuevo')) return;
    url.searchParams.delete('nuevo');
    history.replaceState(history.state, '', url);
  }, []);
  const [templates, setTemplates] = useState(false);
  const [importing, setImporting] = useState(false);
  const install = useInstallPrompt();

  useEffect(() => {
    listProjectMeta()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const create = (aspect: AspectId) => useStore.getState().open(newProject(aspect), {});

  const openProject = async (m: ProjectMeta) => {
    const p = await getProject(m.id).catch(() => undefined);
    if (!p) return useStore.getState().notify('No se pudo abrir este proyecto');
    const urls: Record<string, string> = {};
    let missing = 0;
    for (const id of Object.keys(p.assets)) {
      const b = await getBlob(id).catch(() => undefined);
      if (b) urls[id] = URL.createObjectURL(b);
      else missing++;
    }
    useStore.getState().open(p, urls);
    if (missing) useStore.getState().notify(`${missing} archivo(s) ya no están en este dispositivo`);
  };

  const remove = async (p: ProjectMeta) => {
    if (!confirm(`¿Eliminar "${p.name}"? Esto no se puede deshacer.`)) return;
    await deleteProject(p);
    setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null);
  };

  return (
    <div className="home">
      <header className="home-head">
        <img src="./icon.svg" alt="" width={36} height={36} />
        <h1>Clipo</h1>
        <div className="spacer" />
        {install && (
          <button className="btn-ghost" onClick={install}>
            <Download size={18} /> Instalar app
          </button>
        )}
      </header>

      <section className="hero">
        <h2>Crea videos geniales en minutos</h2>
        <p>Sin experiencia, sin cuenta y sin marca de agua. Tus videos nunca salen de tu dispositivo.</p>
        <button className="btn-primary big" onClick={() => setPicking(true)}>
          <Plus size={24} /> Nuevo video
        </button>
        <button className="btn-primary alt big home-template-btn" onClick={() => setTemplates(true)}>
          <LayoutTemplate size={24} /> Usar una plantilla
        </button>
        <button className="btn-ghost hero-alt" onClick={() => setImporting(true)}>
          <FolderInput size={18} /> Importar proyecto de CapCut
        </button>
        <ol className="steps">
          <li><b>1</b> Agrega tus videos y fotos</li>
          <li><b>2</b> Corta, pon texto y música</li>
          <li><b>3</b> Guárdalo y compártelo</li>
        </ol>
      </section>

      <section className="projects">
        <h3>Tus proyectos</h3>
        {projects === null ? null : projects.length === 0 ? (
          <p className="muted">Aún no tienes proyectos. Toca “Nuevo video” para empezar.</p>
        ) : (
          <div className="project-grid">
            {projects.map((p) => {
              return (
                <div key={p.id} className="project-card">
                  <button className="project-open" onClick={() => openProject(p)}>
                    <div className="project-thumb">
                      {p.thumb ? <img src={p.thumb} alt="" /> : <Film size={28} />}
                      <span className="project-dur">{fmtTime(p.duration)}</span>
                    </div>
                    <strong>{p.name}</strong>
                    <small>{new Date(p.updatedAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}</small>
                  </button>
                  {p.clipCount > 0 && <SaveTemplateButton load={() => getProject(p.id)} className="icon-btn tpl-card-save" />}
                  <button className="icon-btn danger" aria-label={`Eliminar ${p.name}`} onClick={() => remove(p)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Suspense fallback={null}>
        {templates && <TemplateGallery onClose={() => setTemplates(false)} />}
        {importing && <CapcutImport onClose={() => setImporting(false)} />}
      </Suspense>

      {picking && (
        <Modal onClose={() => setPicking(false)} labelledBy="pick-title">
            <header>
              <h3 id="pick-title">¿Dónde vas a publicar tu video?</h3>
              <button className="icon-btn" aria-label="Cerrar" onClick={() => setPicking(false)}>
                <X />
              </button>
            </header>
            <p className="muted">Puedes cambiarlo después.</p>
            <FormatPicker onPick={create} />
        </Modal>
      )}
    </div>
  );
}
