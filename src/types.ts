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
  createdAt: number;
  updatedAt: number;
}

export type SelectionKind = 'clip' | 'text' | 'audio';
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
  | 'export'
  | 'help';
