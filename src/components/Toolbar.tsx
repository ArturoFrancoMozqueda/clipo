import {
  BellRing,
  ArrowLeft, ArrowLeftRight, ArrowRight, AudioLines, Captions, Copy, Crop, Diamond, Eraser, Gauge, Layers,
  Maximize, Mic, Minimize, Music, Palette, Pencil, Plus, RectangleHorizontal, Scissors,
  Send, SlidersHorizontal, Smile, Snowflake, Sparkles, Trash2, Type, Undo2,
  Volume2, WandSparkles, type LucideIcon,
} from 'lucide-react';
import { useStore } from '../store';
import { addText, deleteSelected, duplicateSelected, moveClip, splitAtPlayhead } from '../ops';
import { freezeAtPlayhead } from '../visualOps';
import type { PanelId } from '../types';

interface Tool {
  icon: LucideIcon;
  label: string;
  run: () => void;
  danger?: boolean;
}

const open = (p: PanelId) => () => useStore.getState().setPanel(p);

/** Bottom bar whose tools change with what is selected, so only relevant actions show. */
export function Toolbar() {
  const sel = useStore((s) => s.selection);
  const clip = useStore((s) => (s.selection?.kind === 'clip' ? s.project!.clips.find((c) => c.id === s.selection!.id) : undefined));
  const kind = useStore((s) => (clip ? s.project!.assets[clip.assetId]?.kind : undefined));
  const isLast = useStore((s) => !!clip && s.project!.clips[s.project!.clips.length - 1]?.id === clip.id);
  const advanced = useStore((s) => s.advanced);
  const overlayKind = useStore((s) => {
    const sel = s.selection;
    const o = sel?.kind === 'overlay' ? s.project!.overlays?.find((x) => x.id === sel.id) : undefined;
    return o ? s.project!.assets[o.assetId]?.kind : undefined;
  });
  // Advanced tools only show up when the advanced mode is on (Ayuda → Modo avanzado).
  const adv = (...t: Tool[]) => (advanced ? t : []);
  const deselect = () => useStore.getState().select(null);

  let title = '';
  let tools: Tool[];
  if (!sel) {
    tools = [
      { icon: Plus, label: 'Agregar', run: open('media') },
      ...adv({ icon: Layers, label: 'Superponer', run: open('overlay') }),
      { icon: Type, label: 'Texto', run: addText },
      { icon: Captions, label: 'Subtítulos', run: open('captions') },
      { icon: Smile, label: 'Stickers', run: open('stickers') },
      { icon: Music, label: 'Música', run: open('audio') },
      { icon: BellRing, label: 'Sonidos', run: open('sfx') },
      { icon: Mic, label: 'Grabar voz', run: open('record') },
      { icon: AudioLines, label: 'Texto a voz', run: open('tts') },
      { icon: WandSparkles, label: 'Audio inteligente', run: open('smartAudio') },
      { icon: Scissors, label: 'Dividir', run: splitAtPlayhead },
      { icon: RectangleHorizontal, label: 'Formato', run: open('format') },
      { icon: Send, label: 'Redes', run: open('social') },
    ];
  } else if (sel.kind === 'clip') {
    const frozen = clip?.freeze != null;
    const moving = kind === 'video' && !frozen;
    title = frozen ? 'Imagen congelada' : kind === 'image' ? 'Foto' : 'Video';
    tools = [
      { icon: Scissors, label: 'Dividir', run: splitAtPlayhead },
      ...(moving ? [{ icon: Gauge, label: 'Velocidad', run: open('speed') }] : []),
      ...(moving ? [{ icon: Volume2, label: 'Volumen', run: open('volume') }] : []),
      ...(moving ? [{ icon: Snowflake, label: 'Congelar', run: freezeAtPlayhead }] : []),
      { icon: Palette, label: 'Filtros', run: open('filters') },
      { icon: Crop, label: 'Recortar', run: open('crop') },
      ...adv({ icon: SlidersHorizontal, label: 'Color', run: open('color') }),
      { icon: Sparkles, label: 'Efectos', run: open('effects') },
      { icon: Eraser, label: 'Quitar fondo', run: open('background') },
      ...(!isLast ? [{ icon: ArrowLeftRight, label: 'Transición', run: open('transition') }] : []),
      {
        icon: clip?.fit === 'fill' ? Minimize : Maximize,
        label: clip?.fit === 'fill' ? 'Ajustar' : 'Rellenar',
        run: () => {
          const s = useStore.getState();
          s.commit((p) => {
            const c = p.clips.find((x) => x.id === sel.id);
            if (c) c.fit = c.fit === 'fill' ? 'fit' : 'fill';
          });
          s.notify(clip?.fit === 'fill' ? 'Se ve completo, con fondo difuminado' : 'Llena toda la pantalla');
        },
      },
      { icon: ArrowLeft, label: 'Mover antes', run: () => moveClip(-1) },
      { icon: ArrowRight, label: 'Mover después', run: () => moveClip(1) },
      { icon: Copy, label: 'Duplicar', run: duplicateSelected },
      { icon: Trash2, label: 'Eliminar', run: deleteSelected, danger: true },
    ];
  } else if (sel.kind === 'text') {
    title = 'Texto';
    tools = [
      { icon: Pencil, label: 'Editar', run: open('text') },
      { icon: AudioLines, label: 'Leer en voz', run: open('tts') },
      { icon: Sparkles, label: 'Animación', run: open('text') },
      ...adv({ icon: Diamond, label: 'Fotogramas clave', run: open('keyframes') }),
      { icon: Scissors, label: 'Dividir', run: splitAtPlayhead },
      { icon: Copy, label: 'Duplicar', run: duplicateSelected },
      { icon: Trash2, label: 'Eliminar', run: deleteSelected, danger: true },
    ];
  } else if (sel.kind === 'sticker') {
    title = 'Sticker';
    tools = [
      { icon: Pencil, label: 'Editar', run: open('stickers') },
      ...adv({ icon: Diamond, label: 'Fotogramas clave', run: open('keyframes') }),
      { icon: Scissors, label: 'Dividir', run: splitAtPlayhead },
      { icon: Copy, label: 'Duplicar', run: duplicateSelected },
      { icon: Trash2, label: 'Eliminar', run: deleteSelected, danger: true },
    ];
  } else if (sel.kind === 'overlay') {
    title = 'Superposición';
    tools = [
      { icon: Pencil, label: 'Ajustes', run: open('overlay') },
      { icon: Diamond, label: 'Fotogramas clave', run: open('keyframes') },
      { icon: SlidersHorizontal, label: 'Color', run: open('color') },
      ...(overlayKind === 'video' ? [{ icon: Volume2, label: 'Volumen', run: open('overlay') }] : []),
      { icon: Scissors, label: 'Dividir', run: splitAtPlayhead },

      { icon: Copy, label: 'Duplicar', run: duplicateSelected },
      { icon: Trash2, label: 'Eliminar', run: deleteSelected, danger: true },
    ];
  } else {
    title = 'Audio';
    tools = [
      { icon: Volume2, label: 'Volumen', run: open('volume') },
      { icon: Scissors, label: 'Dividir', run: splitAtPlayhead },
      { icon: Copy, label: 'Duplicar', run: duplicateSelected },
      { icon: Trash2, label: 'Eliminar', run: deleteSelected, danger: true },
    ];
  }

  return (
    <nav className="toolbar" aria-label="Herramientas">
      {sel && (
        <button className="tool back" onClick={deselect} title="Terminar de editar este elemento">
          <Undo2 size={22} />
          <span>Listo</span>
          <small>{title}</small>
        </button>
      )}
      <div className="tools">
        {tools.map((t) => (
          <button key={t.label} className={`tool ${t.danger ? 'danger' : ''}`} onClick={t.run}>
            <t.icon size={24} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
