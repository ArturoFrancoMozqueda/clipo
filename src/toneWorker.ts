// Runs the OpenVoice tone converter off the main thread so the editor never freezes.
import { convertTone, loadTone, toneColor } from './toneConvert';

export type ToneIn = {
  type: 'convert';
  id: number;
  /** Speech to re-timbre, mono 22.05 kHz. */
  audio: Float32Array;
  /** Cache keys: tone colors are computed once per voice. */
  srcKey: string;
  /** A longer sample of the base voice, for a steadier tone color. */
  srcSample: Float32Array;
  destKey: string;
  /** The user's recording, mono 22.05 kHz. */
  dest: Float32Array;
  tau: number;
};

export type ToneOut =
  | { type: 'download'; id: number; loaded: number; total: number }
  | { type: 'audio'; id: number; samples: Float32Array }
  | { type: 'error'; id: number; message: string };

const post = (m: ToneOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
const tones = new Map<string, Float32Array>();

async function tone(key: string, audio: Float32Array) {
  let t = tones.get(key);
  if (!t) {
    t = await toneColor(audio);
    tones.set(key, t);
  }
  return t;
}

let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<ToneIn>) => {
  const m = e.data;
  queue = queue.then(async () => {
    try {
      await loadTone((loaded, total) => post({ type: 'download', id: m.id, loaded, total }));
      const src = await tone(m.srcKey, m.srcSample);
      const dest = await tone(m.destKey, m.dest);
      const samples = await convertTone(m.audio, src, dest, m.tau);
      post({ type: 'audio', id: m.id, samples }, [samples.buffer]);
    } catch (err) {
      post({ type: 'error', id: m.id, message: String((err as Error)?.message ?? err) });
    }
  });
};
