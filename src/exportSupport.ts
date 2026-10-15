// What this device can do to save a video. Kept apart from exporter.ts so panels can ask
// without loading the whole export pipeline.

const hasRecorder = () => typeof MediaRecorder !== 'undefined';

/** WebCodecs + offline audio: everything the fast path needs (missing on older iOS Safari). */
export const canFastExport = () =>
  typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof OfflineAudioContext !== 'undefined';

export const canExport = () => canFastExport() || hasRecorder();

export { hasRecorder };

/**
 * Why a format other than the open one couldn't be saved: the fast path didn't work here
 * (`reason`), and the real-time recorder can only film the project's own format.
 */
export class UnsupportedAspectError extends Error {
  constructor(readonly reason: 'decode' | 'encoder') {
    super('unsupported-aspect');
  }
}
