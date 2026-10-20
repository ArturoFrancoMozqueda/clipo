// Text and caption panels: fonts, colors, karaoke captions, subtitle files and the brand kit.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Captions, Download, Search, Star, TriangleAlert, Upload } from 'lucide-react';
import type { KaraokeMode, TextItem } from '../types';
import { useStore } from '../store';
import { TEXT_STYLES, getTextStyle, styleToCss } from '../textStyles';
import { FONT_CATEGORIES, POPULAR_FONTS, ensureFont, fontFamily, fontsIn, getFont, searchFonts, warmFont, type FontPickerTab } from '../fonts';
import { TEXT_PRESETS } from '../textPresets';
import { editPose, poseNow } from '../ops';
import {
  CAPTION_LANGUAGES, CAPTION_STYLES, captionDownloadMB, cancelCaptions, generateCaptions, importSubtitleFile, loadCaptionLook,
  restyleCaptions, saveCaptionLook, subtitleFile, type CaptionLook, type CaptionProgress, type CaptionQuality,
} from '../captions';
import { brandLook, saveBrand, useBrand, type BrandKit } from '../brand';
import { Hint, NeedsSelection, Slider, checkpoint, editSelected, usePoseTime, useSelected } from './Panels';
import { TextAnimSection } from './VisualPanels';
import './text.css';

const SWATCHES = ['#ffffff', '#111111', '#ffe500', '#ff9500', '#ff3b30', '#ff2bd6', '#7c6cff', '#00e5ff', '#22c55e'];

/** A row of color circles plus "any color". `value` undefined = the style's own color. */
function ColorRow(props: { value?: string; onPick: (c: string | undefined) => void; allowDefault?: string; extra?: string[] }) {
  const colors = [...new Set([...(props.extra ?? []), ...SWATCHES])];
  return (
    <div className="tx-swatches">
      {props.allowDefault && (
        <button className={`tx-swatch tx-default ${!props.value ? 'active' : ''}`} onClick={() => props.onPick(undefined)}>
          {props.allowDefault}
        </button>
      )}
      {colors.map((c) => (
        <button
          key={c}
          className={`tx-swatch ${props.value?.toLowerCase() === c ? 'active' : ''}`}
          style={{ background: c }}
          aria-label={`Color ${c}`}
          onClick={() => props.onPick(c)}
        />
      ))}
      <label className="tx-swatch tx-custom" aria-label="Otro color" title="Otro color">
        <input type="color" value={props.value ?? '#ffffff'} onPointerDown={checkpoint} onChange={(e) => props.onPick(e.target.value)} />
      </label>
    </div>
  );
}

// ---------- fonts ----------

function FontPicker({ value, onPick }: { value?: string; onPick: (id: string | undefined) => void }) {
  const current = getFont(value);
  const [cat, setCat] = useState<FontPickerTab>(() => (current && !POPULAR_FONTS.includes(current.id) ? current.category : 'populares'));
  const [q, setQ] = useState('');
  const searching = q.trim().length > 0;
  const list = searching ? searchFonts(q) : fontsIn(cat);
  const key = list.map((f) => f.id).join();
  // Download the fonts on screen so each name shows in its own letters.
  useEffect(() => list.forEach((f) => void ensureFont(f.id)), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <label className="tx-search">
        <Search size={18} />
        <input type="search" value={q} placeholder="Buscar: bodas, cómic, terror, Montserrat…" onChange={(e) => setQ(e.target.value)} />
      </label>
      {!searching && (
        <div className="tx-tabs" role="tablist">
          {FONT_CATEGORIES.map((c) => (
            <button key={c.id} role="tab" aria-selected={cat === c.id} className={`chip ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {searching && !list.length && <Hint>No encontramos esa fuente. Prueba con otra palabra, como “moderna” o “a mano”.</Hint>}
      <div className="font-grid">
        {!searching && cat === 'populares' && (
          <button className={`font-opt ${!value ? 'active' : ''}`} onClick={() => onPick(undefined)}>
            <span>Normal</span>
            <small>La del estilo</small>
          </button>
        )}
        {list.map((f) => (
          <button key={f.id} className={`font-opt ${value === f.id ? 'active' : ''}`} title={f.hint} onClick={() => onPick(f.id)}>
            <span style={{ fontFamily: fontFamily(f), fontWeight: f.weight }}>{f.name}</span>
            <small>{f.hint}</small>
          </button>
        ))}
      </div>
    </>
  );
}

// ---------- brand kit ----------

function BrandSection({ text }: { text: TextItem }) {
  const kit = useBrand();
  const save = () => {
    const next: BrandKit = { font: text.font, styleId: text.styleId, fill: text.fill, accent: text.karaoke?.color ?? kit?.accent ?? '#ffe500', forNew: kit?.forNew ?? true };
    saveBrand(next);
    useStore.getState().notify(kit ? 'Mi marca actualizada' : 'Guardado como mi marca. Los textos nuevos ya la usan.');
  };
  if (!kit) {
    return (
      <>
        <Hint>Guarda la fuente, el color y el estilo de este texto para que tus textos nuevos salgan así en todos tus videos.</Hint>
        <button className="btn-ghost tx-btn" onClick={save}>
          <Star size={18} /> Guardar como mi marca
        </button>
      </>
    );
  }
  const st = getTextStyle(kit.styleId);
  const f = getFont(kit.font);
  return (
    <div className="tx-brand">
      <div className="tx-brand-preview">
        <span style={{ ...styleToCss(st), ...(f ? { fontFamily: fontFamily(f), fontWeight: f.weight } : {}), ...(kit.fill ? { color: kit.fill } : {}) }}>Mi marca</span>
        <span className="tx-dot" style={{ background: kit.accent }} title="Color para resaltar" />
      </div>
      <div className="row">
        <button className="btn-primary" onClick={() => { checkpoint(); if (kit.font) warmFont(kit.font); editSelected((t) => void brandLook(t, kit)); }}>
          Usar en este texto
        </button>
        <button className="btn-ghost" onClick={save}>Guardar este texto como mi marca</button>
      </div>
      <label className="tx-check">
        <input type="checkbox" checked={kit.forNew} onChange={(e) => saveBrand({ ...kit, forNew: e.target.checked })} />
        Usar mi marca en los textos nuevos
      </label>
      <p className="label">Color para resaltar palabras</p>
      <ColorRow value={kit.accent} onPick={(c) => saveBrand({ ...kit, accent: c ?? '#ffe500' })} />
      <button className="btn-ghost tx-link" onClick={() => saveBrand(null)}>Borrar mi marca</button>
    </div>
  );
}

// ---------- karaoke ----------

const KARAOKE_MODES: { id: KaraokeMode | 'none'; name: string }[] = [
  { id: 'none', name: 'Sin resaltar' },
  { id: 'color', name: 'Color' },
  { id: 'box', name: 'Caja' },
  { id: 'scale', name: 'Más grande' },
];

/** Tiny sample of how the word being said is highlighted. */
function KaraokeSample({ mode, color }: { mode: KaraokeMode | 'none'; color: string }) {
  const on: CSSProperties =
    mode === 'color' ? { color } : mode === 'box' ? { background: color, borderRadius: 4, padding: '0 3px' } : mode === 'scale' ? { color, fontSize: '1.2em' } : {};
  return (
    <span className="tx-kara-sample">
      hola <b style={on}>a</b> todos
    </span>
  );
}

function KaraokePicker(props: { mode: KaraokeMode | 'none'; color: string; onChange: (mode: KaraokeMode | 'none', color: string) => void; accent?: string }) {
  return (
    <>
      <div className="chips">
        {KARAOKE_MODES.map((m) => (
          <button key={m.id} className={`chip big tx-kara ${props.mode === m.id ? 'active' : ''}`} onClick={() => props.onChange(m.id, props.color)}>
            {m.name}
            <KaraokeSample mode={m.id} color={props.color} />
          </button>
        ))}
      </div>
      {props.mode !== 'none' && (
        <>
          <p className="label">Color de la palabra que se dice</p>
          <ColorRow value={props.color} extra={props.accent ? [props.accent] : undefined} onPick={(c) => props.onChange(props.mode, c ?? '#ffe500')} />
        </>
      )}
    </>
  );
}

function CaptionKaraokeSection({ text }: { text: TextItem }) {
  const kit = useBrand();
  const mode = text.karaoke?.mode ?? 'none';
  const color = text.karaoke?.color ?? kit?.accent ?? '#ffe500';
  return (
    <>
      <p className="label">Palabra por palabra</p>
      <Hint>Resalta cada palabra justo cuando se dice, como en los videos virales.</Hint>
      <KaraokePicker
        mode={mode}
        color={color}
        accent={kit?.accent}
        onChange={(m, c) => {
          checkpoint();
          editSelected((t) => {
            if (m === 'none') delete t.karaoke;
            else t.karaoke = { mode: m, color: c };
          });
        }}
      />
      <button
        className="btn-ghost tx-btn"
        onClick={() => {
          const s = useStore.getState();
          s.commit((p) => {
            for (const t of p.texts) {
              if (!t.caption) continue;
              t.styleId = text.styleId;
              t.font = text.font;
              t.size = text.size;
              if (text.fill) t.fill = text.fill;
              else delete t.fill;
              if (text.karaoke) t.karaoke = { ...text.karaoke };
              else delete t.karaoke;
            }
          });
          s.notify('Todos los subtítulos tienen ahora este estilo');
        }}
      >
        Aplicar este estilo a todos los subtítulos
      </button>
    </>
  );
}

// ---------- text panel ----------

/** In fashion right now (styles, presets and caption looks). */
function TrendTag() {
  return <em className="trend-tag">Tendencia</em>;
}

/** Text styles with the ones in fashion first. */
const STYLES_SHOWN = [...TEXT_STYLES.filter((s) => s.trend), ...TEXT_STYLES.filter((s) => !s.trend)];

const POSITIONS = [
  { label: 'Arriba', y: 0.15 },
  { label: 'Centro', y: 0.5 },
  { label: 'Abajo', y: 0.8 },
];

export function TextPanel() {
  const text = useSelected<TextItem>('text');
  const kit = useBrand();
  usePoseTime(text); // size and position follow keyframes at the playhead (not re-rendered while playing)
  // The preset tiles are drawn in their own fonts.
  useEffect(() => TEXT_PRESETS.forEach((pr) => warmFont(pr.font)), []);
  if (!text) return <NeedsSelection what="un texto" />;
  const pose = poseNow('text', text.id) ?? text;
  return (
    <>
      <textarea
        className="text-input"
        value={text.text}
        rows={2}
        autoFocus
        placeholder="Escribe aquí"
        onFocus={(e) => { checkpoint(); e.target.select(); }}
        onChange={(e) => editSelected((t) => void (t.text = e.target.value))}
      />
      <p className="label">Estilos rápidos</p>
      <div className="preset-row">
        {TEXT_PRESETS.map((pr) => {
          const st = getTextStyle(pr.styleId);
          const f = getFont(pr.font)!;
          return (
            <button
              key={pr.id}
              className="preset"
              title={pr.use}
              onClick={() => {
                checkpoint();
                warmFont(pr.font);
                editSelected((t) => {
                  t.font = pr.font;
                  t.styleId = pr.styleId;
                  t.size = pr.size;
                  t.anim = { ...pr.anim };
                  delete t.fill;
                  if (pr.y !== undefined) {
                    t.x = 0.5;
                    t.y = pr.y;
                  }
                });
              }}
            >
              <span style={{ ...styleToCss(st), fontFamily: fontFamily(f), fontWeight: f.weight }}>{pr.name}</span>
              <small>{pr.use}</small>
              {pr.trend && <TrendTag />}
            </button>
          );
        })}
      </div>
      <p className="label">Mi marca</p>
      <BrandSection text={text} />
      <p className="label">Fuente</p>
      <FontPicker value={text.font} onPick={(id) => { checkpoint(); if (id) warmFont(id); editSelected((t) => void (t.font = id)); }} />
      <p className="label">Estilo</p>
      <div className="style-grid">
        {STYLES_SHOWN.map((st) => (
          <button
            key={st.id}
            className={`style ${text.styleId === st.id ? 'active' : ''}`}
            onClick={() => { checkpoint(); editSelected((t) => void (t.styleId = st.id)); }}
          >
            <span style={styleToCss(st)}>{st.name}</span>
            {st.trend && <TrendTag />}
          </button>
        ))}
      </div>
      <p className="label">Color de las letras</p>
      <ColorRow
        value={text.fill}
        allowDefault="Del estilo"
        extra={kit?.fill ? [kit.fill] : undefined}
        onPick={(c) => { checkpoint(); editSelected((t) => { if (c) t.fill = c; else delete t.fill; }); }}
      />
      {text.caption && <CaptionKaraokeSection text={text} />}
      <Slider label="Tamaño" value={pose.size} min={0.03} max={0.2} step={0.005} format={(v) => `${Math.round(v * 1000)}`} onChange={(v) => editPose('text', text.id, { size: v })} />
      <p className="label">Posición</p>
      <div className="chips">
        {POSITIONS.map((pos) => (
          <button key={pos.label} className="chip" onClick={() => { checkpoint(); editPose('text', text.id, { x: 0.5, y: pos.y }); }}>
            {pos.label}
          </button>
        ))}
      </div>
      <Slider label="Se muestra durante" value={text.duration} min={0.5} max={30} step={0.5} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => editSelected((t) => void (t.duration = v))} />
      <TextAnimSection text={text} />
      <Hint>También puedes arrastrar el texto sobre el video para moverlo.</Hint>
    </>
  );
}

// ---------- captions panel ----------

const CAPTION_ERRORS: Record<string, string> = {
  'no-video': 'Primero agrega un video con sonido. Los subtítulos se crean a partir de lo que se dice en los videos.',
  'no-speech': 'No se escuchó a nadie hablar en los videos. Revisa que tengan sonido y que el volumen no esté en 0.',
  'empty-file': 'Ese archivo no tiene subtítulos que Clipo pueda leer. Usa un archivo .srt o .vtt.',
};

const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Style + highlight for new captions, remembered on this device. */
function CaptionLookPicker({ look, setLook }: { look: CaptionLook; setLook: (l: CaptionLook) => void }) {
  const kit = useBrand();
  const styles = [
    ...(kit ? [{ id: 'marca', name: 'Mi marca', styleId: kit.styleId, font: kit.font, fill: kit.fill }] : []),
    ...CAPTION_STYLES.map((c) => ({ ...c, fill: undefined as string | undefined })),
  ];
  useEffect(() => styles.forEach((s) => void ensureFont(s.font)), [kit]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <p className="label">Cómo se ven</p>
      <div className="style-grid">
        {styles.map((c) => {
          const f = getFont(c.font);
          return (
            <button key={c.id} className={`style ${look.style === c.id ? 'active' : ''}`} onClick={() => setLook({ ...look, style: c.id })}>
              <span style={{ ...styleToCss(getTextStyle(c.styleId)), ...(f ? { fontFamily: fontFamily(f), fontWeight: f.weight } : {}), ...(c.fill ? { color: c.fill } : {}) }}>
                {c.name}
              </span>
              {'trend' in c && c.trend && <TrendTag />}
            </button>
          );
        })}
      </div>
      <p className="label">Palabra por palabra</p>
      <KaraokePicker mode={look.karaoke} color={look.color} accent={kit?.accent} onChange={(karaoke, color) => setLook({ ...look, karaoke, color })} />
    </>
  );
}

export function CaptionsPanel() {
  const hasCaptions = useStore((s) => s.project!.texts.some((t) => t.caption));
  const running = useStore((s) => s.captioning);
  const [language, setLanguage] = useState('spanish');
  const [quality, setQuality] = useState<CaptionQuality>('rapido');
  const [look, setLookState] = useState<CaptionLook>(loadCaptionLook);
  const [progress, setProgress] = useState<CaptionProgress | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const setLook = (l: CaptionLook) => {
    setLookState(l);
    saveCaptionLook(l);
  };

  const done = (msg: string) => {
    const st = useStore.getState();
    st.setPanel(null);
    st.select(null);
    st.notify(msg);
  };

  const start = async () => {
    const s = useStore.getState();
    s.setCaptioning(true);
    setError('');
    setProgress(null);
    try {
      const n = await generateCaptions({ language, quality, look, onProgress: setProgress });
      done(`Listo: ${n} subtítulos. Toca uno para corregir el texto.`);
    } catch (e) {
      const m = (e as Error).message;
      if (m !== 'cancelled') setError(CAPTION_ERRORS[m] ?? 'No se pudieron crear los subtítulos. Revisa tu conexión (solo la primera vez) e intenta otra vez.');
      if (!CAPTION_ERRORS[m] && m !== 'cancelled') console.error(e);
    } finally {
      useStore.getState().setCaptioning(false);
    }
  };

  const importFile = async (file: File) => {
    setError('');
    try {
      const n = await importSubtitleFile(file, look);
      done(`Listo: ${n} subtítulos importados de “${file.name}”.`);
    } catch (e) {
      const m = (e as Error).message;
      setError(CAPTION_ERRORS[m] ?? 'No se pudo leer ese archivo. Usa un archivo .srt o .vtt.');
      if (!CAPTION_ERRORS[m]) console.error(e);
    }
  };

  const save = (format: 'srt' | 'vtt') => {
    const f = subtitleFile(format);
    if (f) download(f);
  };

  if (running) {
    const pct = progress?.pct ?? 0;
    const label =
      !progress || progress.phase === 'audio'
        ? 'Preparando el audio…'
        : progress.phase === 'download' && progress.pct >= 99.5
          ? 'Preparando el reconocimiento de voz…'
        : progress.phase === 'download'
          ? `Descargando el reconocimiento de voz (solo la primera vez)… ${progress.total ? `${mb(progress.loaded)} de ${mb(progress.total)}` : ''}`
          : 'Escuchando el video y escribiendo…';
    return (
      <div className="export-running">
        <div className="progress"><span style={{ width: `${pct}%` }} /></div>
        <p>
          {label} <b>{Math.round(pct)} %</b>
        </p>
        <Hint>Puedes esperar aquí. Se hace en tu dispositivo: nada se sube a internet.</Hint>
        <button className="btn-ghost" onClick={cancelCaptions}>Cancelar</button>
      </div>
    );
  }

  return (
    <>
      {error && <p className="warn"><TriangleAlert size={18} /> {error}</p>}
      <Hint>Clipo escucha lo que se dice en tus videos y lo escribe como subtítulos, en el momento justo.</Hint>
      <p className="label">¿En qué idioma hablan?</p>
      <div className="chips">
        {CAPTION_LANGUAGES.map((l) => (
          <button key={l.id} className={`chip ${language === l.id ? 'active' : ''}`} onClick={() => setLanguage(l.id)}>
            {l.label}
          </button>
        ))}
      </div>
      <p className="label">Modo</p>
      <div className="chips">
        <button className={`chip big ${quality === 'rapido' ? 'active' : ''}`} onClick={() => setQuality('rapido')}>
          Rápido <small>Recomendado · descarga de unos {captionDownloadMB('rapido')} MB</small>
        </button>
        <button className={`chip big ${quality === 'preciso' ? 'active' : ''}`} onClick={() => setQuality('preciso')}>
          Más preciso <small>Más lento · descarga de unos {captionDownloadMB('preciso')} MB</small>
        </button>
      </div>
      <CaptionLookPicker look={look} setLook={setLook} />
      <button className="btn-primary big full" onClick={start}>
        <Captions size={22} /> {hasCaptions ? 'Volver a crear subtítulos' : 'Crear subtítulos'}
      </button>
      {hasCaptions && (
        <>
          <Hint>Los subtítulos automáticos que ya tienes se reemplazarán. Puedes deshacerlo.</Hint>
          <button className="btn-ghost tx-btn" onClick={() => { const n = restyleCaptions(look); useStore.getState().notify(`Estilo aplicado a ${n} subtítulos`); }}>
            Aplicar este estilo a los subtítulos que ya tengo
          </button>
        </>
      )}
      <Hint>Todo se hace en tu dispositivo. La primera vez se descarga el reconocimiento de voz y queda guardado para la próxima.</Hint>

      <p className="label">Archivos de subtítulos</p>
      <div className="row">
        <button className="btn-ghost tx-btn" onClick={() => fileInput.current?.click()}>
          <Upload size={18} /> Abrir archivo .srt o .vtt
        </button>
        {hasCaptions && (
          <>
            <button className="btn-ghost tx-btn" onClick={() => save('srt')}>
              <Download size={18} /> Descargar .srt
            </button>
            <button className="btn-ghost tx-btn" onClick={() => save('vtt')}>
              <Download size={18} /> Descargar .vtt
            </button>
          </>
        )}
      </div>
      <Hint>
        {hasCaptions
          ? 'El archivo .srt sirve para subir los subtítulos a YouTube, Facebook o LinkedIn por separado. Al abrir un archivo, sus subtítulos reemplazan a los que tienes.'
          : 'Si ya tienes los subtítulos en un archivo .srt o .vtt, ábrelo y Clipo los pone en el video con el estilo elegido.'}
      </Hint>
      <input
        ref={fileInput}
        type="file"
        accept=".srt,.vtt,text/vtt,application/x-subrip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importFile(f);
        }}
      />
    </>
  );
}
