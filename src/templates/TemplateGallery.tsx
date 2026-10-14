import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Clock, ImagePlus, Images, Sparkles, Trash2, X } from 'lucide-react';
import type { Asset } from '../types';
import { ASPECTS } from '../model';
import { importFiles } from '../media';
import { saveProject } from '../db';
import { useStore } from '../store';
import { BUILTIN_TEMPLATES } from './builtin';
import { deleteUserTemplate, loadUserTemplates, projectFromTemplate } from './build';
import { TemplatePreview } from './TemplatePreview';
import { templateDuration, type Template } from './types';
import './templates.css';

const ACCEPT = 'video/*,image/*';

function previewWidth(t: Template, boxH: number, maxW: number) {
  const a = ASPECTS[t.aspect];
  return Math.round(Math.min(maxW, (boxH * a.w) / a.h));
}

const secs = (n: number) => `${Math.round(n)} s`;

export function TemplateGallery({ onClose }: { onClose: () => void }) {
  const [mine, setMine] = useState(loadUserTemplates);
  const [chosen, setChosen] = useState<Template | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (chosen ? setChosen(null) : onClose());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chosen, onClose]);

  const remove = (t: Template) => {
    if (!confirm(`¿Eliminar la plantilla "${t.name}"?`)) return;
    deleteUserTemplate(t.id);
    setMine(loadUserTemplates());
  };

  const card = (t: Template) => (
    <div key={t.id} className="tpl-card">
      <button className="tpl-open" onClick={() => setChosen(t)} aria-label={`Usar la plantilla ${t.name}`}>
        <div className="tpl-thumb">
          <TemplatePreview template={t} width={previewWidth(t, 210, 168)} />
        </div>
        <strong>{t.name}</strong>
        <small>{t.description}</small>
        <span className="tpl-meta">
          <Images size={14} /> {t.slots.length} · <Clock size={14} /> {secs(templateDuration(t))} · {ASPECTS[t.aspect].label}
        </span>
      </button>
      {t.custom && (
        <button className="icon-btn danger tpl-del" aria-label={`Eliminar ${t.name}`} onClick={() => remove(t)}>
          <Trash2 size={18} />
        </button>
      )}
    </div>
  );

  return (
    <div className="modal-backdrop tpl-backdrop" onClick={onClose}>
      <div className="modal tpl-modal" role="dialog" aria-modal="true" aria-label="Plantillas" onClick={(e) => e.stopPropagation()}>
        {chosen ? (
          <TemplateFill template={chosen} onBack={() => setChosen(null)} onDone={onClose} />
        ) : (
          <>
            <header>
              <h3>Elige una plantilla</h3>
              <button className="icon-btn" aria-label="Cerrar" onClick={onClose}>
                <X />
              </button>
            </header>
            <p className="muted">Tú pones las fotos y los videos; los textos y el ritmo ya están listos. Luego puedes cambiar todo.</p>
            {mine.length > 0 && (
              <>
                <h4 className="tpl-section">Tus plantillas</h4>
                <div className="tpl-grid">{mine.map(card)}</div>
                <h4 className="tpl-section">Plantillas de Clipo</h4>
              </>
            )}
            <div className="tpl-grid">{BUILTIN_TEMPLATES.map(card)}</div>
          </>
        )}
      </div>
    </div>
  );
}

function SlotThumb({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return file.type.startsWith('video/') ? (
    <video src={`${url}#t=0.5`} muted playsInline preload="metadata" />
  ) : (
    <img src={url} alt="" />
  );
}

function TemplateFill({ template: t, onBack, onDone }: { template: Template; onBack: () => void; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(t.fields.map((f) => [f.key, f.default])));
  const [files, setFiles] = useState<(File | null)[]>(() => t.slots.map(() => null));
  const [busy, setBusy] = useState(false);
  const one = useRef<HTMLInputElement>(null);
  const many = useRef<HTMLInputElement>(null);
  const target = useRef(0);
  const filled = files.filter(Boolean).length;
  const [previewW, setPreviewW] = useState(220);

  useEffect(() => {
    const fit = () => setPreviewW(previewWidth(t, Math.min(360, window.innerHeight * 0.42), Math.min(320, window.innerWidth - 64)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [t]);

  const pickOne = (i: number) => {
    target.current = i;
    one.current?.click();
  };

  const addMany = (list: File[]) => {
    setFiles((cur) => {
      const next = [...cur];
      // Fill empty slots first, in order; if all are full, start over from the first.
      let order = next.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
      if (!order.length) order = next.map((_, i) => i);
      list.slice(0, order.length).forEach((f, k) => (next[order[k]] = f));
      return next;
    });
    if (list.length > t.slots.length) useStore.getState().notify(`Esta plantilla usa ${t.slots.length}; agregamos las primeras.`);
  };

  const create = async () => {
    if (!filled || busy) return;
    setBusy(true);
    const s = useStore.getState();
    try {
      // Import each distinct file once, keeping which slot it belongs to.
      const byFile = new Map<File, Asset | null>();
      const failed: string[] = [];
      for (const f of files) {
        if (!f || byFile.has(f)) continue;
        const { ok } = await importFiles([f]);
        byFile.set(f, ok[0] ?? null);
        if (!ok[0]) failed.push(f.name);
      }
      const bySlot = files.map((f) => (f ? byFile.get(f) ?? null : null));
      const good = bySlot.filter((a): a is Asset => !!a);
      if (!good.length) {
        s.notify(`No se pudo abrir: ${failed.join(', ')}. Prueba con MP4, JPG o PNG.`);
        return;
      }
      // Empty slots reuse the chosen media in order so the template keeps its rhythm.
      let k = 0;
      const media = bySlot.map((a) => a ?? good[k++ % good.length]);
      const p = projectFromTemplate(t, media, values);
      await saveProject(p).catch(() => {});
      s.open(p, { ...useStore.getState().urls });
      onDone();
      s.notify(
        failed.length
          ? `No se pudo abrir: ${failed.join(', ')}. Usamos tus otros archivos.`
          : 'Listo. Toca un texto en el video para cambiarlo.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tpl-fill">
      <header>
        <button className="icon-btn" aria-label="Volver a las plantillas" onClick={onBack} disabled={busy}>
          <ChevronLeft />
        </button>
        <h3>{t.name}</h3>
        <div className="spacer" />
        <button className="icon-btn" aria-label="Cerrar" onClick={onDone} disabled={busy}>
          <X />
        </button>
      </header>
      <div className="tpl-fill-body">
        <div className="tpl-fill-preview">
          <TemplatePreview template={t} width={previewW} values={values} />
          <small className="muted">
            {ASPECTS[t.aspect].label} {t.aspect} · {secs(templateDuration(t))}
          </small>
        </div>
        <div className="tpl-fill-form">
          <h4 className="tpl-section">
            <b className="tpl-step">1</b> Elige tus fotos y videos
          </h4>
          <p className="muted small">
            Van en orden, uno por espacio. Si eliges menos, se repiten. ({filled}/{t.slots.length})
          </p>
          <button className="btn-ghost tpl-many" onClick={() => many.current?.click()} disabled={busy}>
            <Images size={20} /> Elegir varias a la vez
          </button>
          <ol className="tpl-slots">
            {t.slots.map((sl, i) => (
              <li key={i}>
                <button className={`tpl-slot ${files[i] ? 'full' : ''}`} onClick={() => pickOne(i)} disabled={busy}>
                  <span className="tpl-slot-media">{files[i] ? <SlotThumb file={files[i]!} /> : <ImagePlus size={24} />}</span>
                  <span className="tpl-slot-text">
                    <strong>
                      {i + 1}. {sl.label}
                    </strong>
                    <small>
                      {sl.duration} s · {files[i] ? 'Toca para cambiar' : 'Toca para elegir'}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {t.fields.length > 0 && (
            <>
              <h4 className="tpl-section">
                <b className="tpl-step">2</b> Escribe tus textos
              </h4>
              <p className="muted small">Podrás cambiarlos, moverlos o borrarlos en el editor.</p>
              {t.fields.map((f) => (
                <label key={f.key} className="tpl-field">
                  <span>{f.label}</span>
                  {f.multiline ? (
                    <textarea
                      rows={2}
                      value={values[f.key]}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    />
                  ) : (
                    <input value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                  )}
                </label>
              ))}
            </>
          )}
        </div>
      </div>
      <footer className="tpl-foot">
        <button className="btn-primary big tpl-create" disabled={!filled || busy} onClick={create}>
          {busy ? <span className="spinner" /> : <Sparkles size={22} />}
          {busy ? 'Preparando tu video…' : filled ? 'Crear mi video' : 'Elige tus fotos primero'}
        </button>
      </footer>
      <input
        ref={one}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setFiles((cur) => cur.map((x, i) => (i === target.current ? f : x)));
          e.target.value = '';
        }}
      />
      <input
        ref={many}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) addMany(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
    </div>
  );
}
