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
      'Registrar una app en TikTok for Developers con el permiso “video.publish”.',
      'Pasar la auditoría de TikTok: hasta aprobarla, todo lo publicado por API queda privado (solo tú lo ves).',
      'Mostrar las opciones de privacidad que TikTok indique para cada cuenta.',
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
      'Tu propia app de Meta (en modo desarrollo) con el permiso “instagram_content_publish”: se configura una sola vez en Cuentas.',
      'Instagram no deja programar por API: si programas, Clipo debe estar abierto a esa hora.',
      'Hasta 100 publicaciones por API cada 24 horas por cuenta.',
    ],
    docs: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    state: 'ready',
    nativeSchedule: true,
    needs: [
      'Solo páginas de Facebook: los perfiles personales no se pueden usar por API.',
      'Tu propia app de Meta (en modo desarrollo) con el permiso “pages_manage_posts”: se configura una sola vez en Cuentas.',
    ],
    docs: 'https://developers.facebook.com/docs/video-api/guides/publishing',
  },
  x: {
    id: 'x',
    name: 'X (Twitter)',
    state: 'needs-setup',
    nativeSchedule: false,
    needs: [
      'La API de X ya no tiene plan gratis para publicar: se paga por uso con créditos.',
      'Una app en el portal de desarrolladores de X y subir el video en partes antes de publicarlo.',
    ],
    docs: 'https://docs.x.com/x-api/media/quickstart/media-upload-chunked',
  },
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    state: 'needs-setup',
    nativeSchedule: false,
    needs: [
      'Una app de LinkedIn con el producto “Share on LinkedIn” (permiso w_member_social).',
      'Para publicar en páginas de empresa, el acceso a Community Management API, que LinkedIn revisa.',
    ],
    docs: 'https://learn.microsoft.com/linkedin/marketing/community-management/shares/videos-api',
  },
};
