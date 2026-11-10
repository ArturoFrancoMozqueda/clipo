// What Clipo can honestly do on each network today. YouTube, Facebook (Pages) and Instagram Reels
// have a real adapter in the desktop app; the rest explain what is missing and are never selectable.
import type { NetworkId } from './types';

export interface NetworkInfo {
  id: NetworkId;
  name: string;
  /** 'ready' = real adapter (desktop app). 'needs-setup' = shown as "Requiere configuración". */
  state: 'ready' | 'needs-setup';
  /** The network itself can publish at a later time (so it works with Clipo closed). */
  nativeSchedule: boolean;
  /** Plain-language list of what is still needed (for 'ready' ones: what the account must have). */
  needs: string[];
  docs: string;
}

export const NETWORK_ORDER: NetworkId[] = ['youtube_shorts', 'youtube', 'tiktok', 'instagram_reels', 'facebook', 'x', 'linkedin'];

export const NETWORKS: Record<NetworkId, NetworkInfo> = {
  youtube_shorts: {
    id: 'youtube_shorts',
    name: 'YouTube Shorts',
    state: 'ready',
    nativeSchedule: true,
    needs: [],
    docs: 'https://developers.google.com/youtube/v3/guides/uploading_a_video',
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    state: 'ready',
    nativeSchedule: true,
    needs: [],
    docs: 'https://developers.google.com/youtube/v3/guides/uploading_a_video',
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    state: 'needs-setup',
    nativeSchedule: false,
    needs: [
      'TikTok todavía no permite que Clipo publique por ti.',
      'Con Clipo guardas el video y TikTok se abre con el texto copiado.',
      'Ahí eliges la música, la privacidad y publicas.',
    ],
    docs: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
  },
  instagram_reels: {
    id: 'instagram_reels',
    name: 'Instagram Reels',
    state: 'ready',
    // The API has no scheduling for Instagram: Clipo's local scheduler uploads it (Clipo open).
    nativeSchedule: false,
    needs: [
      'Una cuenta profesional de Instagram (Empresa o Creador) vinculada a una página de Facebook. Las cuentas personales no se pueden usar.',
      'Conectar tu cuenta de Instagram desde Cuentas.',
      'Instagram no deja programar desde otras apps: si programas, Clipo debe estar abierto a esa hora.',
      'Hasta 100 publicaciones al día por cuenta.',
    ],
    docs: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    state: 'ready',
    nativeSchedule: true,
    needs: [
      'Solo páginas de Facebook: los perfiles personales no se pueden usar.',
      'Conectar tu página desde Cuentas.',
    ],
    docs: 'https://developers.facebook.com/docs/video-api/guides/publishing',
  },
  x: {
    id: 'x',
    name: 'X (Twitter)',
    state: 'needs-setup',
    nativeSchedule: false,
    needs: [
      'X cobra por publicar desde otras apps, así que Clipo no lo hace por ti.',
      'Con Clipo guardas el video y X se abre con el texto copiado.',
    ],
    docs: 'https://docs.x.com/x-api/media/quickstart/media-upload-chunked',
  },
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    state: 'needs-setup',
    nativeSchedule: false,
    needs: [
      'LinkedIn limita a las apps que publican por ti.',
      'Con Clipo guardas el video y LinkedIn se abre con el texto copiado.',
    ],
    docs: 'https://learn.microsoft.com/linkedin/marketing/community-management/shares/videos-api',
  },
};
