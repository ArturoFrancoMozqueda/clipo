// "Publicar con la app": for networks Clipo can't post to by itself, hand the video and its text
// to the network's own app or website, where the user is already signed in. No API keys, no
// review by the network: the user taps "Publicar" there.
import type { PlatformId, PostText } from '../types';
import { PLATFORMS, postCaption } from '../platforms';
import { canShareFile, isNative, saveFile, shareFile } from '../nativeShare';
import { useStore } from '../store';

/** Where each network's upload starts on the web. */
export const UPLOAD_PAGES: Record<PlatformId, string> = {
  tiktok: 'https://www.tiktok.com/tiktokstudio/upload',
  instagram_reels: 'https://www.instagram.com/',
  youtube_shorts: 'https://studio.youtube.com/',
  youtube: 'https://studio.youtube.com/',
  facebook: 'https://www.facebook.com/reels/create',
  x: 'https://x.com/compose/post',
  linkedin: 'https://www.linkedin.com/feed/?shareActive=true',
};

/** The text to paste: title (where the network has one), then description and hashtags. */
export function postText(platform: PlatformId, post?: Partial<PostText>): string {
  const caption = postCaption(post?.description ?? '', post?.hashtags ?? '');
  const title = PLATFORMS[platform].hasTitle ? post?.title?.trim() : '';
  return [title, caption].filter(Boolean).join('\n\n');
}

export type HandoffMode = 'share' | 'download';

/**
 * Phones (the app, or a mobile browser that can share files) use the share sheet, which lists
 * TikTok, Instagram… Computers save the file and open the network's upload page.
 */
export function handoffMode(env: { native: boolean; desktopApp: boolean; touch: boolean; canShare: boolean }): HandoffMode {
  if (env.desktopApp) return 'download';
  if (env.native) return 'share';
  return env.touch && env.canShare ? 'share' : 'download';
}

/** Call it straight from the tap: clipboard, popups and the share sheet need the user's gesture. */
export async function publishWithApp(platform: PlatformId, file: File, post?: Partial<PostText>) {
  const notify = useStore.getState().notify;
  const name = PLATFORMS[platform].name;
  const text = postText(platform, post);
  const mode = handoffMode({
    native: isNative(),
    desktopApp: !!window.clipoDesktop,
    touch: matchMedia('(pointer: coarse)').matches,
    canShare: canShareFile(file),
  });

  // Start copying before anything takes the focus away (a new tab, the share sheet).
  const copied = text ? navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false) : Promise.resolve(false);

  if (mode === 'share') {
    const ok = await copied;
    await shareFile(file, file.name);
    notify(ok ? `Elige ${name} en la lista. El texto ya está copiado: pégalo en la descripción.` : `Elige ${name} en la lista.`);
    return;
  }

  // Desktop: open the upload page now (popup blockers allow it only during the tap), then save.
  window.open(UPLOAD_PAGES[platform], '_blank', 'noopener,noreferrer');
  await saveFile(file);
  const ok = await copied;
  notify(
    `Se abrió ${name} en tu navegador y el video se guardó en Descargas. Arrástralo a la página${ok ? ' y pega el texto, que ya está copiado' : ''}.`,
  );
}
