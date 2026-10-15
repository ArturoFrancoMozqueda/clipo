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

export type TransitionId =
  | 'none' | 'fade' | 'slide' | 'zoom' | 'wipe'
  | 'fadeBlack' | 'fadeWhite' | 'push' | 'iris' | 'flash' | 'spin' | 'blur' | 'glitch';
/** Direction the new clip comes from (push transition). */
export type Direction = 'left' | 'right' | 'up' | 'down';
export interface Transition {
  type: TransitionId;
  /** Seconds, 0.2..1.5. Centered on the cut, so the timeline length does not change. */
  duration: number;
  /** For 'push'; 'left' when missing. */
  dir?: Direction;
}

export type EffectId =
  | 'none' | 'glitch' | 'blur' | 'vignette' | 'shake' | 'kenburns'
  | 'grain' | 'vhs' | 'rgb' | 'pixelate' | 'mirror' | 'glow' | 'lightleak' | 'bwdrama';
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

/**
 * Manual color correction (advanced mode). Every value is -1..1 and 0 means "unchanged",
 * so a missing field or a missing object both leave the picture as it was.
 */
export interface ColorAdjust {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  /** Negative = cooler (blue), positive = warmer (orange). */
  temperature?: number;
  /** Negative = greener, positive = more magenta. */
  tint?: number;
  highlights?: number;
  shadows?: number;
  /** Positive darkens the corners, negative lightens them. */
  vignette?: number;
}

export type Easing = 'linear' | 'ease';

/** A saved pose of an overlay, sticker or text (advanced mode). */
export interface Keyframe {
  /** Seconds from the item's start. */
  t: number;
  x: number;
  y: number;
  size: number;
  /** Radians, clockwise. */
  rotation: number;
  /** 0..1 */
  opacity: number;
  /** How the motion from this keyframe to the next one moves. */
  ease: Easing;
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'soft-light' | 'difference';

/** A video or photo on an extra track above the main one (picture-in-picture). */
export interface OverlayItem {
  id: string;
  assetId: string;
  /** Timeline position in seconds. */
  start: number;
  /** Source in/out in seconds. For photos `in` is 0 and `out` is how long it shows. */
  in: number;
  out: number;
  volume: number;
  /** Center as a fraction of the frame (0..1). */
  x: number;
  y: number;
  /** Width as a fraction of the frame width. */
  size: number;
  rotation: number;
  opacity: number;
  blend: BlendMode;
  filter?: string;
  color?: ColorAdjust;
  keyframes?: Keyframe[];
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
  color?: ColorAdjust;
  bgRemoval?: BgRemoval;
  /** Imported 3D LUT (id in `Project.luts`) applied after the filter and color. */
  lut?: ClipLut;
  flipH?: boolean;
  flipV?: boolean;
  /** Part of the source picture that is shown (fractions 0..1); the whole picture when missing. */
  crop?: Crop;
  /** Freeze frame: always shows this source time (seconds), silent. `in` is 0 and `out` its length. */
  freeze?: number;
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClipLut {
  id: string;
  /** 0..1 mix with the uncorrected picture. */
  amount: number;
}

/** A .cube look imported by the user, stored with the project (resampled to at most 33³). */
export interface LutData {
  id: string;
  name: string;
  /** Points per side. */
  size: number;
  /** Base64 of size³ RGB bytes, red changing fastest (the .cube order). */
  data: string;
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
  /** Bundled typeface id (src/fonts.ts); the style's default font when missing. */
  font?: string;
  anim?: TextAnim;
  /** Radians (advanced mode). */
  rotation?: number;
  /** 0..1 (advanced mode). */
  opacity?: number;
  keyframes?: Keyframe[];
  /** When each word is said (captions). Missing in older projects and typed texts. */
  words?: CaptionWord[];
  /** Highlight the word being said. */
  karaoke?: Karaoke;
  /** Text color chosen by the user (or the brand kit) instead of the style's. */
  fill?: string;
}

/** A spoken word of a caption. Seconds from the text's start. */
export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export type KaraokeMode = 'color' | 'box' | 'scale';
export interface Karaoke {
  mode: KaraokeMode;
  /** Color of the highlighted word (or of its box). */
  color: string;
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
  /** 0..1 (advanced mode). */
  opacity?: number;
  keyframes?: Keyframe[];
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
  /** Picture-in-picture track (advanced mode). Missing in older projects. */
  overlays?: OverlayItem[];
  /** Imported LUTs by id. Missing in older projects. */
  luts?: Record<string, LutData>;
  createdAt: number;
  updatedAt: number;
}

export type SelectionKind = 'clip' | 'text' | 'audio' | 'sticker' | 'overlay';
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
  | 'overlay'
  | 'color'
  | 'keyframes'
  | 'sfx'
  | 'crop'
  | 'help';
