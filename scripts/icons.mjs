// Renders the PNG app icons from public/icon.svg. Run with: npm run icons
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

// Full-bleed square variant: the gradient fills every pixel (iOS and maskable icons are cropped by the OS),
// and the glyph shrinks toward the centre so it stays inside the maskable safe zone (inner 80% circle).
const square = (scale) =>
  svg
    .replace(/<rect width="512" height="512" rx="112"/, '<rect width="512" height="512"')
    .replace(/(<rect x="120"[\s\S]*?Z" fill="#fff"\/>)/, `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">$1</g>`);

const render = (src, size, name) => sharp(Buffer.from(src), { density: 384 }).resize(size, size).png().toFile(out(name));

await Promise.all([
  render(svg, 192, 'icon-192.png'),
  render(svg, 512, 'icon-512.png'),
  render(square(0.8), 512, 'icon-maskable-512.png'),
  render(square(0.9), 180, 'apple-touch-icon.png'),
]);
console.log('Icons written to public/');

// Native projects (only if generated with `npx cap add`): replace Capacitor's default icons and splash
// screens with Clipo's, keeping each file's original size.
const root = (p) => out(`../${p}`);
const bg = { r: 14, g: 14, b: 18, alpha: 1 };

async function walk(dir) {
  const list = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) list.push(...(await walk(p)));
    else if (e.name.endsWith('.png')) list.push(p);
  }
  return list;
}

async function replace(file, makeSrc) {
  const { width, height } = await sharp(file).metadata();
  const buf = await makeSrc(width, height);
  await sharp(buf).toFile(file + '.tmp.png');
  await rename(file + '.tmp.png', file);
}

// Splash: the rounded icon at a third of the short side, centred on the app's background colour.
const splash = async (w, h) => {
  const s = Math.round(Math.min(w, h) / 3);
  const icon = await sharp(Buffer.from(svg), { density: 384 }).resize(s, s).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: bg } }).composite([{ input: icon, gravity: 'center' }]).png().toBuffer();
};
const plain = (src) => (w) => sharp(Buffer.from(src), { density: 384 }).resize(w, w).png().toBuffer();
// Adaptive-icon foreground: only the white glyph, scaled into the 66% safe zone; the gradient is the background layer.
const glyph = svg.replace(/<rect width="512" height="512" rx="112" fill="url\(#g\)"\/>/, '').replace(
  /(<rect x="120"[\s\S]*?Z" fill="#fff"\/>)/,
  '<g transform="translate(256 256) scale(0.62) translate(-256 -256)">$1</g>',
);

const res = root('android/app/src/main/res');
if (existsSync(res)) {
  for (const f of await walk(res)) {
    const name = f.split('/').pop();
    if (name === 'splash.png') await replace(f, splash);
    else if (name === 'ic_launcher_foreground.png') await replace(f, plain(glyph));
    else if (name === 'ic_launcher_round.png') await replace(f, plain(svg.replace('rx="112"', 'rx="256"')));
    else if (name === 'ic_launcher.png') await replace(f, plain(svg));
  }
  // Adaptive icon background: the gradient as a drawable instead of Capacitor's flat white.
  await mkdir(`${res}/drawable`, { recursive: true });
  await writeFile(
    `${res}/drawable/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient android:angle="315" android:startColor="#8B7BFF" android:endColor="#FF5FA2" />
</shape>
`,
  );
  for (const v of ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml']) {
    const p = `${res}/${v}`;
    if (existsSync(p)) {
      await writeFile(p, (await readFile(p, 'utf8')).replace('@color/ic_launcher_background', '@drawable/ic_launcher_background'));
    }
  }
  console.log('Android icons and splash updated');
}

const xc = root('ios/App/App/Assets.xcassets');
if (existsSync(xc)) {
  // iOS rejects icons with transparency, so use the full-bleed square.
  await replace(`${xc}/AppIcon.appiconset/AppIcon-512@2x.png`, async (w) => sharp(await plain(square(0.9))(w)).flatten({ background: bg }).png().toBuffer());
  for (const f of await walk(`${xc}/Splash.imageset`)) await replace(f, splash);
  console.log('iOS icon and splash updated');
}
