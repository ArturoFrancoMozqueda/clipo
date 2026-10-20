// Sound levels for the timeline's waveforms. They come from the same per-asset analysis the ducking
// uses (decoded once, chunk by chunk), one file at a time so the timeline never floods the decoder.
import { useEffect, useState } from 'react';
import { analyzeAsset } from './audioFx';

/** dBFS per FRAME of source time; null when the file has no sound we can read. */
const done = new Map<string, Float32Array | null>();
let chain: Promise<unknown> = Promise.resolve();

function levelsOf(assetId: string, url: string): Promise<Float32Array | null> {
  const p = chain.then(() => (done.has(assetId) ? done.get(assetId)! : analyzeAsset(assetId, url).then((a) => a?.levels ?? null)));
  chain = p.catch(() => {});
  return p.then((l) => {
    done.set(assetId, l);
    return l;
  });
}

/** Levels of an asset's sound, undefined while they're being computed. */
export function useLevels(assetId: string, url: string | undefined) {
  const [lv, setLv] = useState(() => done.get(assetId));
  useEffect(() => {
    if (done.has(assetId)) return void setLv(done.get(assetId));
    if (!url) return;
    let on = true;
    levelsOf(assetId, url).then((l) => on && setLv(l), () => on && setLv(null));
    return () => {
      on = false;
    };
  }, [assetId, url]);
  return lv;
}
