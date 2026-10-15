// Publishing center: the shapes shared by the queue, the adapters and the UI.
// Nothing here talks to a network; adapters (Publisher) do that.

/** Same ids as src/platforms.ts (Fase A). */
export type NetworkId = 'tiktok' | 'instagram_reels' | 'youtube_shorts' | 'youtube' | 'facebook' | 'x' | 'linkedin';

export type Privacy = 'public' | 'unlisted' | 'private';

/** Text of one post. Same shape as Fase A's PostText; `hashtags` is free text ("#viaje playa, #mar"). */
export interface PostText {
  title?: string;
  description: string;
  hashtags: string;
}

export interface PostOptions {
  privacy: Privacy;
  madeForKids: boolean;
  /**
   * Epoch ms. The network itself publishes at this time (YouTube `publishAt`), so it works with Clipo closed.
   * The video is uploaded right away as private until then.
   */
  nativePublishAt?: number;
}

export interface VideoInfo {
  name: string;
  /** MIME type, e.g. video/mp4. */
  type: string;
  bytes: number;
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
}

/** An account the user connected on this device. Tokens never leave the desktop app's main process. */
export interface ConnectedAccount {
  id: string;
  provider: 'google';
  networks: NetworkId[];
  name: string;
  avatar?: string;
  connectedAt: number;
}

export type JobStatus =
  /** Waiting for its local time (`scheduledAt`); needs Clipo open. */
  | { kind: 'scheduled' }
  /** Queued, will start as soon as the previous upload ends. */
  | { kind: 'pending' }
  | { kind: 'uploading'; pct: number }
  | { kind: 'published'; url: string; remoteId: string; at: number; note?: string }
  | { kind: 'error'; reason: string; retryable: boolean; at: number }
  /** Clipo was closed when it should have run. Never sent on its own: the user decides. */
  | { kind: 'missed'; reason: string }
  | { kind: 'cancelled' };

export type JobKind = JobStatus['kind'];

export interface PublishJob {
  id: string;
  /** Jobs created by the same "Publicar" click share a batch and a stored video. */
  batchId: string;
  network: NetworkId;
  accountId: string;
  accountName: string;
  /** Key of the video blob in the publish storage. */
  videoId: string;
  video: VideoInfo;
  /** Key of the cover image blob, if the user picked one. */
  thumbnailId?: string;
  post: PostText;
  options: PostOptions;
  /** Epoch ms for local scheduling. */
  scheduledAt?: number;
  createdAt: number;
  attempts: number;
  status: JobStatus;
}

export interface UploadInput {
  jobId: string;
  accountId: string;
  network: NetworkId;
  video: Blob;
  videoInfo: VideoInfo;
  thumbnail?: Blob;
  post: PostText;
  options: PostOptions;
}

export interface UploadResult {
  remoteId: string;
  url: string;
  /** Something the user should know even though it worked (e.g. the cover could not be set). */
  note?: string;
}

export interface RemoteStatus {
  state: 'processing' | 'ready' | 'failed' | 'unknown';
  /** Plain-language explanation for the history. */
  detail: string;
}

export type Availability = { ok: true } | { ok: false; reason: string };

/**
 * One way to publish to one or more networks. Implementations: the YouTube desktop adapter today;
 * a paid intermediary or an own server could implement the same interface later.
 */
export interface Publisher {
  readonly id: string;
  readonly networks: NetworkId[];
  /** Whether it can be used on this device right now (desktop app, configured, …). */
  availability(): Promise<Availability>;
  listAccounts(): Promise<ConnectedAccount[]>;
  /** Opens the network's sign-in; resolves with the connected account. */
  connect(): Promise<ConnectedAccount>;
  cancelConnect(): void;
  disconnect(accountId: string): Promise<void>;
  /** Problems that block publishing this video on this network (empty = fine). Plain Spanish. */
  check(network: NetworkId, video: VideoInfo, post: PostText): string[];
  /** Throws PublishError with a reason the user can understand. `pct` is 0..100. */
  upload(input: UploadInput, onProgress: (pct: number) => void, signal: AbortSignal): Promise<UploadResult>;
  status(accountId: string, remoteId: string): Promise<RemoteStatus>;
}
