import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, FileJson, FolderOpen, Plus, X } from 'lucide-react';
import { FAILURE_MESSAGE, findDraftFile, matchMedia, parseDraft, type DraftPlan } from '../importers/capcut';
import { buildProject } from '../importers/capcutProject';
import { ASPECTS } from '../model';
import { ACCEPT_MEDIA } from '../media';
import { useStore } from '../store';
import { Modal } from './Modal';

/** Hidden file input; `folder` turns it into a directory picker on desktop browsers. */
function Picker({ folder, accept, onFiles, inputRef }: {
  folder?: boolean;
  accept?: string;
  onFiles: (files: File[]) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  useEffect(() => {
    if (folder) inputRef.current?.setAttribute('webkitdirectory', '');
  }, [folder, inputRef]);
  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      hidden
      accept={accept}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (files.length) onFiles(files);
      }}
    />
  );
}

async function readName(files: File[]): Promise<string | undefined> {
  // draft_meta_info.json usually carries the name shown in CapCut's project list.
  const meta = files.find((f) => f.name.toLowerCase() === 'draft_meta_info.json');
  if (meta) {
    try {
      const j: unknown = JSON.parse(await meta.text());
      const n = j && typeof j === 'object' ? (j as Record<string, unknown>).draft_name : undefined;
      if (typeof n === 'string' && n.trim()) return n.trim();
    } catch {
      /* fall through */
    }
  }
  const rel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel?.split('/')[0] || undefined;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function CapcutImport({ onClose }: { onClose: () => void }) {
  const folderInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<DraftPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const loadDraft = async (picked: File[]) => {
    setError(null);
    const draft = findDraftFile(picked);
    if (!draft) return setError(FAILURE_MESSAGE['not-a-draft']);
    let text = '';
    try {
      text = await draft.text();
    } catch {
      return setError(FAILURE_MESSAGE.unreadable);
    }
    const r = parseDraft(text, (await readName(picked)) ?? 'Proyecto de CapCut');
    if (!r.ok) return setError(FAILURE_MESSAGE[r.reason]);
    setPlan(r.plan);
    // Media copied inside the draft folder can be matched right away.
    setFiles(picked.filter((f) => !f.name.toLowerCase().endsWith('.json')));
  };

  const refs = useMemo(() => (plan ? Object.values(plan.media) : []), [plan]);
  const matched = useMemo(() => matchMedia(refs, files), [refs, files]);
  const empty = plan && !plan.clips.length && !plan.texts.length && !plan.audios.length;

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const { project, urls, problems } = await buildProject(plan, matched);
      const s = useStore.getState();
      s.open(project, urls);
      s.notify(problems.length ? `Proyecto importado. ${problems.join(' ')}` : 'Proyecto de CapCut importado ✅');
    } catch {
      setBusy(false);
      setError('Algo salió mal al importar. Inténtalo de nuevo.');
    }
  };

  return (
    <Modal onClose={onClose} dismissible={!busy} labelledBy="ci-title" className="capcut-import">
        <header>
          <h3 id="ci-title">Importar proyecto de CapCut</h3>
          <button className="icon-btn" aria-label="Cerrar" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </header>

        {!plan && (
          <>
            <p className="muted">
              Trae tus propios borradores de CapCut a Clipo. Elige la carpeta del proyecto (la que contiene{' '}
              <code>draft_content.json</code> o <code>draft_info.json</code>); en PC suele estar dentro de la carpeta “CapCut Drafts”.
            </p>
            <div className="ci-actions">
              <button className="btn-primary" onClick={() => folderInput.current?.click()}>
                <FolderOpen size={20} /> Elegir carpeta del borrador
              </button>
              <button className="btn-ghost" onClick={() => jsonInput.current?.click()}>
                <FileJson size={20} /> Elegir solo el archivo .json
              </button>
            </div>
            <Picker folder inputRef={folderInput} onFiles={loadDraft} />
            <Picker accept=".json,application/json" inputRef={jsonInput} onFiles={loadDraft} />
          </>
        )}

        {error && (
          <p className="ci-error" role="alert">
            <CircleAlert size={20} /> {error}
          </p>
        )}

        {plan && (
          <>
            <p className="ci-summary">
              <strong>{plan.name}</strong>
              <span className="muted">
                {ASPECTS[plan.aspect].label} {plan.aspect} · {count(plan.clips.length, 'clip', 'clips')} · {count(plan.texts.length, 'texto', 'textos')} ·{' '}
                {count(plan.audios.length, 'audio', 'audios')}
              </span>
            </p>

            {refs.length > 0 && (
              <>
                <h4>Tus archivos</h4>
                <p className="muted small">El borrador solo guarda los nombres de tus videos, fotos y audios. Elígelos para traerlos a Clipo.</p>
                <ul className="ci-list">
                  {refs.map((r) => {
                    const f = matched.get(r.key);
                    return (
                      <li key={r.key} className={f ? 'ok' : 'missing'}>
                        {f ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
                        <span>{r.fileName}</span>
                        {f && f.name !== r.fileName && <small className="muted">→ {f.name}</small>}
                        {!f && <small className="muted">falta</small>}
                      </li>
                    );
                  })}
                </ul>
                <button className="btn-ghost" disabled={busy} onClick={() => mediaInput.current?.click()}>
                  <Plus size={18} /> Agregar videos, fotos y audios
                </button>
                <Picker
                  accept={ACCEPT_MEDIA}
                  inputRef={mediaInput}
                  onFiles={(more) => setFiles((prev) => [...more, ...prev])}
                />
              </>
            )}

            {plan.skipped.length > 0 && (
              <>
                <h4>Lo que no se importa igual</h4>
                <ul className="ci-notes">
                  {plan.skipped.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </>
            )}

            {empty ? (
              <p className="ci-error" role="alert">
                <CircleAlert size={20} /> Este borrador no tiene nada que Clipo pueda importar.
              </p>
            ) : (
              <button className="btn-primary full" disabled={busy} onClick={run}>
                {busy ? <span className="spinner" /> : null}
                {busy ? 'Importando…' : `Importar (${matched.size} de ${refs.length} archivos)`}
              </button>
            )}
            <button className="btn-ghost full-ghost" disabled={busy} onClick={() => { setPlan(null); setFiles([]); setError(null); }}>
              Elegir otro borrador
            </button>
          </>
        )}
    </Modal>
  );
}
