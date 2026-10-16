// "Publicar con la app": which way the video is handed over and what text gets copied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stub } from './helpers/hooks.ts';

stub('nativeShare', 'export const isNative = () => false; export const canShareFile = () => false; export const saveFile = async () => {}; export const shareFile = async () => {};');
stub('store', 'export const useStore = { getState: () => ({ notify() {} }) };');
const { handoffMode, postText, UPLOAD_PAGES } = await import('../src/publish/handoff.ts');
const { PLATFORM_IDS } = await import('../src/platforms.ts');

test('phones use the share sheet; computers save the file and open the upload page', () => {
  const base = { native: false, desktopApp: false, touch: false, canShare: false };
  assert.equal(handoffMode({ ...base, native: true }), 'share', 'Android/iOS app');
  assert.equal(handoffMode({ ...base, touch: true, canShare: true }), 'share', 'mobile browser that can share files');
  assert.equal(handoffMode({ ...base, touch: true, canShare: false }), 'download', 'mobile browser without file sharing');
  assert.equal(handoffMode({ ...base, canShare: true }), 'download', 'desktop browser (Safari/Chrome can share, but upload pages work better)');
  assert.equal(handoffMode({ ...base, desktopApp: true, canShare: true }), 'download', 'desktop app');
});

test('copied text: title only where the network has one, then description and hashtags', () => {
  const post = { title: 'Mi viaje', description: 'Un día en la playa', hashtags: 'playa, #mar mar' };
  assert.equal(postText('tiktok', post), 'Un día en la playa\n\n#playa #mar');
  assert.equal(postText('youtube', post), 'Mi viaje\n\nUn día en la playa\n\n#playa #mar');
  assert.equal(postText('x', undefined), '');
});

test('every network has an https upload page', () => {
  for (const id of PLATFORM_IDS) assert.match(UPLOAD_PAGES[id], /^https:\/\//, id);
});
