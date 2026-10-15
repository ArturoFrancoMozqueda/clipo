// What Clipo can honestly do on each network today. Only YouTube has a real adapter;
// the rest explain what is missing and are never selectable.
import type { NetworkId } from './types';

export interface NetworkInfo {
  id: NetworkId;
  name: string;
  /** 'ready' = real adapter (desktop app). 'needs-setup' = shown as "Requiere configuración". */
  state: 'ready' | 'needs-setup';
  /** Plain-language list of what is still needed. */
  needs: string[];
  docs: string;
}

export const NETWORK_ORDER: NetworkId[] = ['youtube_shorts', 'youtube', 'tiktok', 'instagram_reels', 'facebook', 'x', 'linkedin'];

export const NETWORKS: Record<NetworkId, NetworkInfo> = {
  youtube_shorts: {
    id: 'youtube_shorts',
    name: 'YouTube Shorts',
    state: 'ready',
    needs: [],
    docs: 'https://developers.google.com/youtube/v3/guides/uploading_a_video',
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    state: 'ready',
    needs: [],
    docs: 'https://developers.google.com/youtube/v3/guides/uploading_a_video',
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    state: 'needs-setup',
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
    state: 'needs-setup',
    needs: [
      'Una cuenta profesional de Instagram (Empresa o Creador). Las cuentas personales no se pueden usar.',
      'Una app de Meta con el permiso de publicar contenido; para otras personas además hace falta la revisión de Meta y verificar el negocio.',
      'Instagram descarga el video desde una dirección pública de internet: hace falta un servidor o un intermediario.',
    ],
    docs: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    state: 'needs-setup',
    needs: [
      'Publicar por API solo funciona en páginas de Facebook (no en perfiles personales).',
      'Una app de Meta con permisos de páginas y la revisión de Meta para usarla con otras cuentas.',
    ],
    docs: 'https://developers.facebook.com/docs/video-api/guides/publishing',
  },
  x: {
    id: 'x',
    name: 'X (Twitter)',
    state: 'needs-setup',
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
    needs: [
      'Una app de LinkedIn con el producto “Share on LinkedIn” (permiso w_member_social).',
      'Para publicar en páginas de empresa, el acceso a Community Management API, que LinkedIn revisa.',
    ],
    docs: 'https://learn.microsoft.com/linkedin/marketing/community-management/shares/videos-api',
  },
};
