// Keyframe animation of position, size, rotation and opacity for overlays, stickers and texts
// (advanced mode). Pure math, shared by the preview, the export and the editing tools.
import type { Easing, Keyframe } from './types';

export interface Pose {
  x: number;
  y: number;
  size: number;
  rotation: number;
  opacity: number;
}

/** Anything that can be posed: base values plus optional keyframes. */
export interface Animatable {
  x: number;
  y: number;
  size: number;
  rotation?: number;
  opacity?: number;
  keyframes?: Keyframe[];
}

/** Two keyframes closer than this (seconds) count as the same one: about one frame. */
export const KF_EPS = 1 / 60;

export const EASINGS: { id: Easing; name: string }[] = [
  { id: 'linear', name: 'Constante' },
  { id: 'ease', name: 'Suave' },
];

export const basePose = (it: Animatable): Pose => ({
  x: it.x,
  y: it.y,
  size: it.size,
  rotation: it.rotation ?? 0,
  opacity: it.opacity ?? 1,
});

const easeInOut = (k: number) => k * k * (3 - 2 * k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The pose `local` seconds after the item starts. Holds the first/last keyframe outside their range. */
export function poseAt(it: Animatable, local: number): Pose {
  const kf = it.keyframes;
  if (!kf?.length) return basePose(it);
  const sorted = isSorted(kf) ? kf : [...kf].sort((a, b) => a.t - b.t);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (local <= first.t) return pick(first);
  if (local >= last.t) return pick(last);
  let i = 0;
  while (i < sorted.length - 2 && sorted[i + 1]!.t <= local) i++;
  const a = sorted[i]!;
  const b = sorted[i + 1]!;
  const raw = (local - a.t) / Math.max(1e-6, b.t - a.t);
  const k = a.ease === 'ease' ? easeInOut(raw) : raw;
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    size: lerp(a.size, b.size, k),
    rotation: lerp(a.rotation, b.rotation, k),
    opacity: lerp(a.opacity, b.opacity, k),
  };
}

const pick = (k: Keyframe): Pose => ({ x: k.x, y: k.y, size: k.size, rotation: k.rotation, opacity: k.opacity });

function isSorted(kf: Keyframe[]) {
  for (let i = 1; i < kf.length; i++) if (kf[i]!.t < kf[i - 1]!.t) return false;
  return true;
}

/** Index of the keyframe at `local` (within KF_EPS), or -1. */
export const keyframeAt = (it: Animatable, local: number) => (it.keyframes ?? []).findIndex((k) => Math.abs(k.t - local) < KF_EPS);

/** Add a keyframe at `local` holding the current pose. Returns false if there already is one. */
export function addKeyframe(it: Animatable, local: number): boolean {
  if (keyframeAt(it, local) >= 0) return false;
  const kf: Keyframe = { t: local, ...poseAt(it, local), ease: 'ease' };
  it.keyframes = [...(it.keyframes ?? []), kf].sort((a, b) => a.t - b.t);
  return true;
}

/** Remove the keyframe at `local`. With none left the item keeps the pose it had there. */
export function removeKeyframe(it: Animatable, local: number) {
  const i = keyframeAt(it, local);
  if (i < 0) return;
  const pose = poseAt(it, local);
  const rest = it.keyframes!.filter((_, j) => j !== i);
  if (rest.length) it.keyframes = rest;
  else {
    delete it.keyframes;
    Object.assign(it, pose);
  }
}

/** Drop every keyframe; the item keeps the pose it has at `local`. */
export function clearKeyframes(it: Animatable, local: number) {
  if (!it.keyframes) return;
  const pose = poseAt(it, local);
  delete it.keyframes;
  Object.assign(it, pose);
}

/**
 * Change part of the pose at `local`. Without keyframes this edits the item itself; with
 * keyframes it edits (or creates) the keyframe at that moment, like most editors do.
 */
export function setPose(it: Animatable, local: number, patch: Partial<Pose>) {
  if (!it.keyframes?.length) {
    Object.assign(it, patch);
    return;
  }
  const i = keyframeAt(it, local);
  if (i >= 0) Object.assign(it.keyframes[i]!, patch);
  else {
    it.keyframes = [...it.keyframes, { t: local, ...poseAt(it, local), ...patch, ease: 'ease' as Easing }].sort((a, b) => a.t - b.t);
  }
}

/** Keyframes of the second half when an item is split `cut` seconds after its start. */
export const shiftKeyframes = (kf: Keyframe[] | undefined, cut: number) => kf?.map((k) => ({ ...k, t: k.t - cut }));
