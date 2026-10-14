import type { AspectId, FitMode } from '../types';

/** A gap in the template that the user fills with one photo or video. */
export interface TemplateSlot {
  /** Hint shown to the user, e.g. "Foto del plato terminado". */
  label: string;
  /** Seconds. Videos shorter than this keep their own length. */
  duration: number;
  filter: string;
  fit: FitMode;
}

/** A value the user types before opening the editor; texts use it as `{key}`. */
export interface TemplateField {
  key: string;
  label: string;
  default: string;
  multiline?: boolean;
}

export interface TemplateText {
  /** May contain `{key}` placeholders from the template fields. */
  text: string;
  /** Slot the text belongs to, or 'all' to span the whole video. */
  slot: number | 'all';
  /** Seconds after the start of the slot (or of the video). */
  offset: number;
  /** Seconds; defaults to the rest of the slot (or of the video). */
  duration?: number;
  x: number;
  y: number;
  size: number;
  styleId: string;
}

/** Generic decoration drawn in the gallery preview (solid colors and simple shapes only). */
export type Motif = 'confetti' | 'stripes' | 'waves' | 'grid' | 'bubbles' | 'split' | 'stars' | 'bars';

export interface Template {
  version: 1;
  id: string;
  name: string;
  description: string;
  aspect: AspectId;
  slots: TemplateSlot[];
  fields: TemplateField[];
  texts: TemplateText[];
  look: { colors: string[]; motif: Motif };
  /** Made by the user with "Guardar como plantilla". */
  custom?: boolean;
  createdAt?: number;
}

export const templateDuration = (t: Template) => t.slots.reduce((s, x) => s + x.duration, 0);
