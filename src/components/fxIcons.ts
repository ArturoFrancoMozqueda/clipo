// Icons of transitions and effects, shared by the panels and the timeline.
import {
  Aperture, Ban, Blend, ChevronsLeft, CircleDot, Columns2, Contrast, Droplets, Film, FlipHorizontal2, Grid3x3, Layers,
  Moon, MoveLeft, RotateCw, ScanLine, Sparkles, Sun, SunMedium, Tv, Vibrate, Zap, ZoomIn, type LucideIcon,
} from 'lucide-react';
import type { EffectId, TransitionId } from '../types';

export const TRANSITION_ICONS: Record<TransitionId, LucideIcon> = {
  none: Ban, fade: Blend, slide: MoveLeft, zoom: ZoomIn, wipe: Columns2,
  fadeBlack: Moon, fadeWhite: Sun, push: ChevronsLeft, iris: CircleDot, flash: Zap, spin: RotateCw, blur: Droplets, glitch: ScanLine,
};

export const EFFECT_ICONS: Record<EffectId, LucideIcon> = {
  none: Ban, kenburns: ZoomIn, shake: Vibrate, glitch: Zap, blur: Droplets, vignette: Aperture,
  grain: Film, vhs: Tv, rgb: Layers, pixelate: Grid3x3, mirror: FlipHorizontal2, glow: Sparkles, lightleak: SunMedium, bwdrama: Contrast,
};
