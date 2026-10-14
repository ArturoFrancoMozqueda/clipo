export type AspectId = '9:16' | '16:9' | '1:1' | '4:5';
export type MediaKind = 'video' | 'image' | 'audio';
export type FitMode = 'fit' | 'fill';

export interface Asset {
  id: string;
  kind: MediaKind;
  name: string;
  /** Seconds. For images this is the maximum display length. */
  duration: number;
  width: number;
  height: number;
  /** Small JPEG data URL used in the timeline and library. */
  thumb?: string;
  /** Imported as a sticker image; hidden from the media library. */
  sticker?: boolean;
}

export type TransitionId = 'none' | 'fade' | 'slide' | 'zoom' | 'wipe';
export interface Transition {
  type: TransitionId;
  /** Seconds, 0.2..1.5. Centered on the cut, so the timeline length does not change. */
  duration: number;
}

export type EffectId = 'none' | 'glitch' | 'blur' | 'vignette' | 'shake' | 'kenburns';
export interface Effect {
  id: EffectId;
  /** 0..1 */
  intensity: number;
}

export type TextInAnim = 'none' | 'fade' | 'pop' | 'slideUp' | 'typewriter';
export type TextOutAnim = 'none' | 'fade' | 'pop';
export type TextLoopAnim = 'none' | 'bounce' | 'pulse';
export interface TextAnim {
  in: TextInAnim;
  out: TextOutAnim;
  loop: TextLoopAnim;
}

export type BgMode = 'color' | 'blur' | 'media';
/** "Quitar fondo": the person is cut out on-device and drawn over a new background. */
export interface BgRemoval {
  mode: BgMode;
  /** CSS color for mode 'color'. */
  color: string;
  /** Image or video asset behind the person (mode 'media'); videos loop. */
  assetId?: string;
  /** Edge smoothing, 0..1. */
  smooth: number;
}

/** A piece of the main (magnetic) track. Clips play back to back. */
export interface Clip {
  id: string;
  assetId: string;
  /** Source in/out points in seconds. */
  in: number;
  out: number;
  speed: number;
  volume: number;
  filter: string;
  fit: FitMode;
  /** Transition into the next main-track clip. */
  transition?: Transition;
  effect?: Effect;
  bgRemoval?: BgRemoval;
}

export interface TextItem {
  id: string;
  text: string;
  start: number;
  duration: number;
  /** Center position as a fraction of the frame (0..1). */
  x: number;
  y: number;
  /** Font size as a fraction of the frame's short side. */
  size: number;
  styleId: string;
  /** Made by automatic captions; regenerating replaces these. */
  caption?: boolean;
  anim?: TextAnim;
}

/** An emoji or image drawn over the video, like a text. */
export interface StickerItem {
  id: string;
  start: number;
  duration: number;
  /** Center position as a fraction of the frame (0..1). */
  x: number;
  y: number;
  /** Width as a fraction of the frame's short side. */
  size: number;
  /** Radians, clockwise. */
  rotation: number;
  emoji?: string;
  /** Image asset (kind 'image', marked `sticker`). */
  assetId?: string;
}

export interface AudioItem {
  id: string;
  assetId: string;
  start: number;
  in: number;
  out: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export interface Project {
  id: string;
  name: string;
  aspect: AspectId;
  assets: Record<string, Asset>;
  clips: Clip[];
  texts: TextItem[];
  audios: AudioItem[];
  /** Missing in projects saved before stickers existed. */
  stickers?: StickerItem[];
  createdAt: number;
  updatedAt: number;
}

export type SelectionKind = 'clip' | 'text' | 'audio' | 'sticker';
export type Selection = { kind: SelectionKind; id: string } | null;

export type PanelId =
  | 'media'
  | 'audio'
  | 'format'
  | 'speed'
  | 'volume'
  | 'filters'
  | 'text'
  | 'captions'
  | 'transition'
  | 'effects'
  | 'background'
  | 'stickers'
  | 'record'
  | 'tts'
  | 'export'
  | 'help';
