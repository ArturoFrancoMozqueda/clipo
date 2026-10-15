import { create } from 'zustand';
import { ShieldCheck, X } from 'lucide-react';
import type { AspectId, PlatformId } from '../types';
import { PLATFORMS, safeZoneFor } from '../platforms';
import './social.css';

/** Which network's safe zone the preview shows. Only on screen: it is never drawn into the video. */
export const useGuide = create<{ platform: PlatformId | null; set(p: PlatformId | null): void }>()((set) => ({
  platform: null,
  set: (platform) => set({ platform }),
}));

/** Shaded margins over the preview where the network's buttons and texts go. */
export function SafeZoneGuide({ aspect, w, h }: { aspect: AspectId; w: number; h: number }) {
  const platform = useGuide((s) => s.platform);
  if (!platform || !w || !h) return null;
  const z = safeZoneFor(platform, aspect);
  const pct = (v: number) => `${v * 100}%`;
  return (
    <div className="safe-guide" style={{ width: w, height: h }}>
      <span className="safe-band" style={{ left: 0, right: 0, top: 0, height: pct(z.top) }} />
      <span className="safe-band" style={{ left: 0, right: 0, bottom: 0, height: pct(z.bottom) }} />
      <span className="safe-band" style={{ left: 0, top: pct(z.top), bottom: pct(z.bottom), width: pct(z.left) }} />
      <span className="safe-band" style={{ right: 0, top: pct(z.top), bottom: pct(z.bottom), width: pct(z.right) }} />
      <span className="safe-box" style={{ left: pct(z.left), right: pct(z.right), top: pct(z.top), bottom: pct(z.bottom) }} />
      <button className="safe-tag" onClick={() => useGuide.getState().set(null)} title="Ocultar la zona segura">
        <ShieldCheck size={14} /> Zona segura · {PLATFORMS[platform].name} <X size={14} />
      </button>
    </div>
  );
}
