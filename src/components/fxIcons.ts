// Icons of transitions and effects, shared by the panels and the timeline.
import {
  Aperture, Ban, Blend, ChevronsLeft, CircleDot, Clapperboard, Cloudy, Columns2, Contrast, Drum, Droplets, Film, Flame,
  FlipHorizontal2, Focus, Gem, Grid2x2, Grid3x3, Layers, Lightbulb, Moon, MoveLeft, RotateCw, ScanLine, Sparkle, Sparkles, Sun,
  SunMedium, SwatchBook, Tv, Vibrate, Video, Wind, Zap, ZoomIn, ZoomOut, type LucideIcon,
} from 'lucide-react';
import type { EffectId, TransitionId } from '../types';

export const TRANSITION_ICONS: Record<TransitionId, LucideIcon> = {
  none: Ban, fade: Blend, slide: MoveLeft, zoom: ZoomIn, wipe: Columns2,
  fadeBlack: Moon, fadeWhite: Sun, push: ChevronsLeft, iris: CircleDot, flash: Zap, spin: RotateCw, blur: Droplets, glitch: ScanLine,
  whip: Wind, zoomBlur: Focus, filmBurn: Flame, shake: Vibrate, pixelate: Grid2x2,
};

export const EFFECT_ICONS: Record<EffectId, LucideIcon> = {
  none: Ban, kenburns: ZoomIn, shake: Vibrate, glitch: Zap, blur: Droplets, vignette: Aperture,
  grain: Film, vhs: Tv, rgb: Layers, pixelate: Grid3x3, mirror: FlipHorizontal2, glow: Sparkles, lightleak: SunMedium, bwdrama: Contrast,
  zoomout: ZoomOut, beatzoom: Drum, strobe: Lightbulb, dreamy: Cloudy, y2k: Gem, cinematic: Clapperboard, camcorder: Video,
  duotone: SwatchBook, sparkle: Sparkle,
};
