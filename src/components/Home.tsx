import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Clapperboard, Copy, Download, Film, FolderInput, ImagePlus, LayoutTemplate, Pencil, Play, Plus, Scissors, Search, Share2, ShieldCheck, Trash2, X } from 'lucide-react';
import type { AspectId } from '../types';
import { deleteProject, getBlob, getProject, listProjectMeta, type ProjectMeta } from '../db';
import { useStore } from '../store';
import { FormatPicker } from './FormatPicker';
import { Modal } from './Modal';
import { useInstallPrompt } from './useInstallPrompt';
import { IosInstallButton } from './IosInstall';
import { confirmDialog, promptDialog } from './confirm';
import { SORT_LABELS, duplicateProject, filterProjects, fmtLength, relativeDate, renameProject, sortProjects, type ProjectSort } from '../projectActions';

// Opened on demand from the start screen.
const TemplateGallery = lazy(() => import('../templates/TemplateGallery').then((m) => ({ default: m.TemplateGallery })));
const SaveTemplateButton = lazy(() => import('../templates/SaveTemplateButton').then((m) => ({ default: m.SaveTemplateButton })));
const CapcutImport = lazy(() => import('./CapcutImport').then((m) => ({ default: m.CapcutImport })));

const STEPS = [
  { icon: ImagePlus, title: 'Agrega tus videos y fotos', text: 'Desde tu galería o tu computadora.' },
  { icon: Scissors, title: 'Corta, pon texto y música', text: 'Subtítulos, filtros y efectos en un toque.' },
  { icon: Share2, title: 'Guárdalo y compártelo', text: 'En el formato de cada red social.' },
];

/** The list only needs a search box and a sort menu once there are enough projects to get lost in. */
const SEARCH_FROM = 6;
const SORT_KEY = 'clipo.projectSort';

function loadSort(): ProjectSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v && v in SORT_LABELS ? (v as ProjectSort) : 'recent';
  } catch {
    return 'recent';
  }
}

function ProjectSkeleton() {
  return (
    <div className="project-grid" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="project-card skeleton">
          <div className="project-thumb" />
          <span className="sk-line" />
          <span className="sk-line short" />
        </div>
      ))}
    </div>
  );
}

export function Home() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
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
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProjectSort>(loadSort);
  // Opening reads every media file of a project: show it and ignore a second tap meanwhile.
  const [opening, setOpening] = useState<string | null>(null);
  const install = useInstallPrompt();

  const load = () => {
    setLoadFailed(false);
    listProjectMeta().then(setProjects, () => {
      setProjects([]);
      setLoadFailed(true);
    });
  };
  useEffect(load, []);

  // The editing code loads on demand, so the start screen opens fast on phones.
  const create = async (aspect: AspectId) => {
    const { newProject } = await import('../ops');
    useStore.getState().open(newProject(aspect), {});
  };

  const openProject = async (m: ProjectMeta) => {
    if (opening) return;
    setOpening(m.id);
    const urls: Record<string, string> = {};
    try {
      const p = await getProject(m.id).catch(() => undefined);
      if (!p) return useStore.getState().notify('No se pudo abrir este proyecto. Prueba de nuevo.');
      let missing = 0;
      for (const id of Object.keys(p.assets)) {
        const b = await getBlob(id).catch(() => undefined);
        if (b) urls[id] = URL.createObjectURL(b);
        else missing++;
      }
      useStore.getState().open(p, urls);
      if (missing) useStore.getState().notify(missing === 1 ? 'Falta 1 archivo: ya no está en este dispositivo.' : `Faltan ${missing} archivos: ya no están en este dispositivo.`);
    } catch {
      // Don't leak the files already prepared when something fails half way.
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
      useStore.getState().notify('No se pudo abrir este proyecto. Prueba de nuevo.');
    } finally {
      setOpening(null);
    }
  };

  const remove = async (p: ProjectMeta) => {
    const ok = await confirmDialog({
      title: `¿Eliminar “${p.name}”?`,
      message: 'Se borra de este dispositivo y no se puede recuperar. Tus archivos originales no se tocan.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProject(p);
      setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null);
      useStore.getState().notify('Proyecto eliminado');
    } catch {
      useStore.getState().notify('No se pudo eliminar. Prueba de nuevo.');
    }
  };

  const rename = async (p: ProjectMeta) => {
    const name = await promptDialog({ title: 'Cambiar nombre', label: 'Nombre del proyecto', value: p.name, confirmLabel: 'Guardar' });
    if (!name || name === p.name) return;
    try {
      const next = await renameProject(p.id, name);
      if (next) setProjects((ps) => ps?.map((x) => (x.id === p.id ? next : x)) ?? null);
    } catch {
      useStore.getState().notify('No se pudo cambiar el nombre. Prueba de nuevo.');
    }
  };

  const duplicate = async (p: ProjectMeta) => {
    try {
      const copy = await duplicateProject(p.id, projects?.map((x) => x.name) ?? []);
      if (!copy) return useStore.getState().notify('No se pudo duplicar este proyecto.');
      setProjects((ps) => [copy, ...(ps ?? [])]);
      useStore.getState().notify('Proyecto duplicado');
    } catch {
      useStore.getState().notify('No se pudo duplicar. Puede que falte espacio en el dispositivo.');
    }
  };

  const changeSort = (s: ProjectSort) => {
    setSort(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      /* private mode: this session only */
    }
  };

  const shown = useMemo(() => (projects ? sortProjects(filterProjects(projects, query), sort) : null), [projects, query, sort]);
  const many = (projects?.length ?? 0) >= SEARCH_FROM;
  const hasProjects = !!projects?.length;
  // The newest project is the likeliest thing someone wants when they come back.
  const latest = hasProjects ? [...projects!].sort((a, b) => b.updatedAt - a.updatedAt)[0]! : null;

  return (
    <div className="home">
      <div className="home-glow" aria-hidden="true" />
      <header className="home-head">
        <img src="./icon.svg" alt="" width={36} height={36} />
        <h1>Clipo</h1>
        <div className="spacer" />
        {install && (
          <button className="btn-ghost" onClick={install}>
            <Download size={18} /> Instalar app
          </button>
        )}
        {!install && <IosInstallButton />}
      </header>

      <section className={`hero ${hasProjects ? 'compact' : ''}`}>
        {!hasProjects && (
          <span className="hero-badge">
            <ShieldCheck size={16} /> Gratis · Sin marca de agua · Privado
          </span>
        )}
        <h2>
          Crea videos geniales <span className="grad-text">en minutos</span>
        </h2>
        <p>Sin experiencia y sin cuenta. Tus videos nunca salen de tu dispositivo.</p>
        <div className="hero-actions">
          <button className="btn-primary big" onClick={() => setPicking(true)}>
            <Plus size={22} /> Nuevo video
          </button>
          <button className="btn-primary alt big home-template-btn" onClick={() => setTemplates(true)}>
            <LayoutTemplate size={22} /> Usar una plantilla
          </button>
        </div>
        <button className="btn-ghost hero-alt" onClick={() => setImporting(true)}>
          <FolderInput size={18} /> Importar proyecto de CapCut
        </button>
        <div className="hero-visual" aria-hidden="true">
          <div className="hv-ruler" />
          <div className="hv-frame"><Play fill="currentColor" /></div>
          <div className="hv-track">
            <i style={{ '--w': 3, '--c': '#3b3560' } as CSSProperties} />
            <i style={{ '--w': 2, '--c': '#4a3a58' } as CSSProperties} />
            <i style={{ '--w': 4, '--c': '#33405e' } as CSSProperties} />
          </div>
          <div className="hv-track text">
            <i style={{ '--w': 3 } as CSSProperties} />
            <i style={{ '--w': 2, opacity: 0 } as CSSProperties} />
            <i style={{ '--w': 3 } as CSSProperties} />
          </div>
          <div className="hv-track audio"><i /></div>
          <div className="hv-head"><b className="hero-time">00:12.4</b></div>
        </div>
        {!hasProjects && projects !== null && (
          <ol className="steps">
            {STEPS.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <span className="step-icon"><Icon size={20} /></span>
                <div>
                  <strong>{title}</strong>
                  {text}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="projects" aria-labelledby="projects-title" aria-busy={projects === null}>
        <div className="projects-head">
          <h3 id="projects-title">Tus proyectos</h3>
          {hasProjects && <span>{projects!.length}</span>}
          <div className="spacer" />
          {latest && (
            <button className="btn-ghost small-btn" onClick={() => openProject(latest)} disabled={!!opening}>
              Seguir con el último
            </button>
          )}
        </div>

        {many && (
          <div className="projects-tools">
            <label className="search-box">
              <Search size={18} aria-hidden="true" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre" aria-label="Buscar proyectos" />
            </label>
            <select className="sort-select" value={sort} onChange={(e) => changeSort(e.target.value as ProjectSort)} aria-label="Ordenar proyectos">
              {(Object.keys(SORT_LABELS) as ProjectSort[]).map((k) => (
                <option key={k} value={k}>{SORT_LABELS[k]}</option>
              ))}
            </select>
          </div>
        )}

        {shown === null ? (
          <>
            <span className="sr-only" role="status">Cargando tus proyectos…</span>
            <ProjectSkeleton />
          </>
        ) : loadFailed ? (
          <div className="projects-empty" role="alert">
            <Clapperboard size={32} />
            <p>No se pudieron leer tus proyectos.</p>
            <button className="btn-ghost" onClick={load}>Intentar de nuevo</button>
          </div>
        ) : !hasProjects ? (
          <div className="projects-empty">
            <Clapperboard size={32} />
            <p>Tus videos aparecerán aquí. Se guardan solos mientras trabajas.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="projects-empty">
            <Search size={28} />
            <p>No hay proyectos con “{query.trim()}”.</p>
            <button className="btn-ghost" onClick={() => setQuery('')}>Borrar búsqueda</button>
          </div>
        ) : (
          <div className="project-grid">
            {shown.map((p) => (
              <div key={p.id} className={`project-card ${opening === p.id ? 'opening' : ''}`}>
                <button className="project-open" onClick={() => openProject(p)} disabled={!!opening} aria-label={`Abrir ${p.name}`}>
                  <div className="project-thumb">
                    {p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <Film size={28} />}
                    {p.clipCount > 0 && <span className="project-dur">{fmtLength(p.duration)}</span>}
                    {opening === p.id && <span className="spinner" aria-hidden="true" />}
                  </div>
                  <strong>{p.name}</strong>
                  <small>{relativeDate(p.updatedAt)}</small>
                </button>
                <div className="project-actions">
                  {p.clipCount > 0 && (
                    <Suspense fallback={null}>
                      <SaveTemplateButton load={() => getProject(p.id)} className="icon-btn" />
                    </Suspense>
                  )}
                  <button className="icon-btn" aria-label={`Cambiar nombre de ${p.name}`} title="Cambiar nombre" onClick={() => rename(p)}>
                    <Pencil size={17} />
                  </button>
                  <button className="icon-btn" aria-label={`Duplicar ${p.name}`} title="Duplicar" onClick={() => duplicate(p)}>
                    <Copy size={17} />
                  </button>
                  <button className="icon-btn danger" aria-label={`Eliminar ${p.name}`} title="Eliminar" onClick={() => remove(p)}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="home-foot">Clipo · Tus videos se editan y se guardan solo en este dispositivo.</footer>

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
