// Downloads a curated set of Microsoft Fluent Emoji (MIT license) into public/stickers/fluent/
// and writes src/stickerCatalog.json. Run with: node scripts/fetch-fluent-emoji.mjs
// Re-running is safe: it rebuilds the folder from the list below.
import { mkdir, rm, writeFile } from 'node:fs/promises';

const REPO = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets';

/** Category (Spanish label) -> Fluent folder names. */
const GROUPS = {
  Caras: [
    'Grinning face with big eyes', 'Face with tears of joy', 'Rolling on the floor laughing', 'Smiling face with heart-eyes',
    'Smiling face with hearts', 'Smiling face with sunglasses', 'Star-struck', 'Winking face with tongue', 'Thinking face',
    'Face with open mouth', 'Face screaming in fear', 'Loudly crying face', 'Pouting face', 'Partying face', 'Sleeping face',
    'Exploding head', 'Face with rolling eyes', 'Smiling face with halo', 'Hugging face', 'Shushing face', 'Zany face',
    'Nerd face', 'Pleading face', 'Melting face', 'Saluting face', 'Face with monocle', 'Skull', 'Ghost', 'Alien', 'Robot',
  ],
  Gestos: [
    'Thumbs up', 'Thumbs down', 'Clapping hands', 'Raising hands', 'Folded hands', 'Flexed biceps', 'Waving hand',
    'Victory hand', 'Crossed fingers', 'Ok hand', 'Backhand index pointing right', 'Backhand index pointing left',
    'Backhand index pointing up', 'Backhand index pointing down', 'Heart hands', 'Handshake', 'Writing hand', 'Eyes',
  ],
  Corazones: [
    'Red heart', 'Orange heart', 'Yellow heart', 'Green heart', 'Blue heart', 'Purple heart', 'Black heart', 'White heart',
    'Sparkling heart', 'Broken heart', 'Heart on fire', 'Two hearts',
  ],
  Fiesta: [
    'Party popper', 'Confetti ball', 'Balloon', 'Wrapped gift', 'Birthday cake', 'Trophy', '1st place medal', 'Crown',
    'Clinking glasses', 'Bottle with popping cork', 'Fireworks', 'Sparkler', 'Christmas tree', 'Jack-o-lantern',
  ],
  Símbolos: [
    'Fire', 'Sparkles', 'Star', 'Glowing star', 'Hundred points', 'Check mark button', 'Cross mark', 'Warning',
    'Red question mark', 'Red exclamation mark', 'Collision', 'Dizzy', 'Light bulb', 'Bell', 'Round pushpin',
    'Right arrow', 'Left arrow', 'Up arrow', 'Down arrow', 'New button', 'Free button', 'Prohibited', 'High voltage',
    'Musical notes', 'Speech balloon', 'Thought balloon', 'Money bag', 'Gem stone',
  ],
  Cosas: [
    'Clapper board', 'Camera with flash', 'Mobile phone', 'Laptop', 'Shopping cart', 'Shopping bags', 'Megaphone',
    'Rocket', 'Alarm clock', 'Hourglass done', 'Calendar', 'Graduation cap', 'Books', 'Microphone', 'Headphone',
    'Video game', 'Automobile', 'Airplane', 'House', 'Briefcase',
  ],
  Comida: [
    'Pizza', 'Hamburger', 'Taco', 'Hot dog', 'French fries', 'Hot beverage', 'Shortcake', 'Doughnut', 'Ice cream',
    'Popcorn', 'Avocado', 'Strawberry', 'Watermelon', 'Tropical drink',
  ],
  Naturaleza: [
    'Sun', 'Crescent moon', 'Rainbow', 'Cloud with rain', 'Snowflake', 'Cherry blossom', 'Sunflower', 'Palm tree',
    'Four leaf clover', 'Dog face', 'Cat face', 'Unicorn', 'Bear', 'Butterfly', 'Water wave', 'Globe showing americas',
  ],
};

// Exact SVG path of each emoji folder, from the repository index (file names are not guessable).
const tree = await fetch('https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/main?recursive=1').then((r) => r.json());
const svgPath = new Map();
for (const { path } of tree.tree) {
  const m = /^assets\/([^/]+)\/(Default\/)?Flat\/[^/]+_flat(_default)?\.svg$/.exec(path);
  if (m && (!svgPath.has(m[1]) || !m[2])) svgPath.set(m[1], path.slice('assets/'.length));
}

const out = 'public/stickers/fluent';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const catalog = [];
const missing = [];
for (const [group, names] of Object.entries(GROUPS)) {
  for (const name of names) {
    const base = `${REPO}/${encodeURIComponent(name)}`;
    const meta = await fetch(`${base}/metadata.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!meta) {
      missing.push(name);
      continue;
    }
    // Emojis with skin tones keep the neutral one under Default/.
    const rel = svgPath.get(name);
    const svg = rel ? await fetch(`${REPO}/${rel.split('/').map(encodeURIComponent).join('/')}`).then((r) => (r.ok ? r.text() : null)) : null;
    if (!svg) {
      missing.push(name);
      continue;
    }
    const file = `${[...meta.glyph].map((c) => c.codePointAt(0).toString(16)).filter((h) => h !== 'fe0f').join('-')}.svg`;
    await writeFile(`${out}/${file}`, svg);
    catalog.push({ glyph: meta.glyph, file, name, group });
  }
}

await writeFile(
  `${out}/LICENSE.txt`,
  'Fluent Emoji © Microsoft Corporation, MIT License.\nhttps://github.com/microsoft/fluentui-emoji/blob/main/LICENSE\n',
);
await writeFile('src/stickerCatalog.json', JSON.stringify(catalog, null, 1) + '\n');
console.log(`saved ${catalog.length} stickers`);
if (missing.length) console.log('not found:', missing.join(', '));
