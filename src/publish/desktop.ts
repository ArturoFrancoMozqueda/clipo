// The bridge the desktop app exposes (electron/preload.cjs). Missing in the browser and on phones.
import type { ConnectedAccount, RemoteStatus } from './types';
import type { YouTubeMetadata } from './text';

export interface YouTubeConfig {
  clientId: string;
  hasSecret: boolean;
  /** False when the OS cannot encrypt saved sessions (then connecting is refused). */
  encryption: boolean;
}

export interface YouTubeBridge {
  getConfig(): Promise<YouTubeConfig>;
  setConfig(c: { clientId: string; clientSecret?: string }): Promise<void>;
  connect(): Promise<ConnectedAccount>;
  cancelConnect(): Promise<void>;
  accounts(): Promise<ConnectedAccount[]>;
  disconnect(accountId: string): Promise<void>;
  upload(req: {
    jobId: string;
    accountId: string;
    /** Either the whole video (old builds) or the id of a file sent with uploadBegin/uploadAppend. */
    bytes?: ArrayBuffer;
    fileId?: string;
    mime: string;
    metadata: YouTubeMetadata;
    thumbnail?: { bytes: ArrayBuffer; mime: string };
  }): Promise<{ videoId: string; note?: string }>;
  cancelUpload(jobId: string): Promise<void>;
  /** Present in builds that take the video in pieces, so it never sits whole in memory. */
  chunkedUpload?: boolean;
  uploadBegin?(total: number, mime: string): Promise<{ fileId: string; chunkLimit: number }>;
  uploadAppend?(fileId: string, bytes: ArrayBuffer): Promise<void>;
  uploadDiscard?(fileId: string): Promise<void>;
  status(accountId: string, videoId: string): Promise<RemoteStatus>;
  onProgress(cb: (p: { jobId: string; sent: number; total: number }) => void): () => void;
}

export interface DesktopBridge {
  version: string;
  youtube: YouTubeBridge;
}

declare global {
  interface Window {
    clipoDesktop?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => (typeof window !== 'undefined' ? window.clipoDesktop : undefined);

/**
 * Errors thrown in the main process reach the page as "Error invoking remote method 'x': Error: <message>".
 * The main process writes "F|" before messages that retrying will not fix (see electron/publish/errors.cjs).
 */
export function bridgeError(err: unknown): { message: string; retryable: boolean } {
  const raw = (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+':\s*(\w*Error:\s*)?/, '');
  const m = /^([RF])\|([\s\S]*)$/.exec(raw);
  return m ? { message: m[2] ?? '', retryable: m[1] === 'R' } : { message: raw, retryable: true };
}
