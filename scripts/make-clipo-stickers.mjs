// Draws Clipo's own stickers (arrows, highlights, speech bubbles, price badges, calls to action) as SVG
// into public/stickers/clipo/ and adds them to src/stickerCatalog.json. All shapes are original work for
// Clipo, with no logos or third-party art. Run with: node scripts/make-clipo-stickers.mjs
// Safe to re-run: it rebuilds the folder and replaces its own catalog entries.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const FONT = 'font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900"';
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${body}</svg>\n`;
const label = (t, x, y, size, fill = '#fff', extra = '') =>
  `<text x="${x}" y="${y}" text-anchor="middle" ${FONT} font-size="${size}" fill="${fill}" ${extra}>${t}</text>`;

const arrow = (rot, color) =>
  svg(`<g transform="rotate(${rot} 64 64)"><path d="M16 50h56V26l44 38-44 38V78H16z" fill="${color}" stroke="#111" stroke-width="6" stroke-linejoin="round"/></g>`);
const curved = (flip) =>
  svg(`<g ${flip ? 'transform="translate(128 0) scale(-1 1)"' : ''}><path d="M18 100C18 52 52 28 98 34" fill="none" stroke="#111" stroke-width="20" stroke-linecap="round"/><path d="M18 100C18 52 52 28 98 34" fill="none" stroke="#ffe500" stroke-width="10" stroke-linecap="round"/><path d="M84 12l30 24-32 20z" fill="#ffe500" stroke="#111" stroke-width="6" stroke-linejoin="round"/></g>`);
const badge = (pts, fill, text, size, ink = '#fff') => {
  const star = Array.from({ length: pts * 2 }, (_, i) => {
    const a = (Math.PI * i) / pts - Math.PI / 2;
    const r = i % 2 ? 46 : 60;
    return `${(64 + r * Math.cos(a)).toFixed(1)},${(64 + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return svg(`<polygon points="${star}" fill="${fill}" stroke="#111" stroke-width="5" stroke-linejoin="round"/>${label(text, 64, 64 + size * 0.36, size, ink)}`);
};
const pill = (fill, text, size, ink = '#fff') =>
  svg(`<rect x="6" y="34" width="116" height="60" rx="30" fill="${fill}" stroke="#111" stroke-width="5"/>${label(text, 64, 64 + size * 0.36, size, ink)}`);
const bubble = (fill, ink, text, size) =>
  svg(`<path d="M20 16h88a14 14 0 0 1 14 14v50a14 14 0 0 1-14 14H64L36 118V94H20a14 14 0 0 1-14-14V30a14 14 0 0 1 14-14z" fill="${fill}" stroke="#111" stroke-width="5" stroke-linejoin="round"/>${text ? label(text, 64, 62 + size * 0.36, size, ink) : ''}`);

const STICKERS = [
  // Flechas
  ['flecha-derecha', 'Flecha a la derecha', 'Señalar', arrow(0, '#ffe500')],
  ['flecha-abajo', 'Flecha hacia abajo', 'Señalar', arrow(90, '#ffe500')],
  ['flecha-izquierda', 'Flecha a la izquierda', 'Señalar', arrow(180, '#ffe500')],
  ['flecha-arriba', 'Flecha hacia arriba', 'Señalar', arrow(270, '#ffe500')],
  ['flecha-roja', 'Flecha roja', 'Señalar', arrow(0, '#ff3b30')],
  ['flecha-curva', 'Flecha curva', 'Señalar', curved(false)],
  ['flecha-curva-izq', 'Flecha curva invertida', 'Señalar', curved(true)],
  // Resaltar
  ['circulo', 'Círculo para resaltar', 'Señalar',
    svg('<ellipse cx="64" cy="64" rx="54" ry="44" fill="none" stroke="#111" stroke-width="16" transform="rotate(-8 64 64)"/><ellipse cx="64" cy="64" rx="54" ry="44" fill="none" stroke="#ff3b30" stroke-width="8" transform="rotate(-8 64 64)"/>')],
  ['subrayado', 'Subrayado', 'Señalar',
    svg('<path d="M10 76q18-14 36 0t36 0 36-4" fill="none" stroke="#111" stroke-width="18" stroke-linecap="round"/><path d="M10 76q18-14 36 0t36 0 36-4" fill="none" stroke="#ffe500" stroke-width="9" stroke-linecap="round"/>')],
  ['tachado', 'Equis grande', 'Señalar',
    svg('<path d="M24 24l80 80M104 24l-80 80" stroke="#111" stroke-width="26" stroke-linecap="round"/><path d="M24 24l80 80M104 24l-80 80" stroke="#ff3b30" stroke-width="14" stroke-linecap="round"/>')],
  ['palomita', 'Palomita grande', 'Señalar',
    svg('<path d="M20 68l32 32 56-70" fill="none" stroke="#111" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 68l32 32 56-70" fill="none" stroke="#22c55e" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>')],
  ['destello', 'Destellos', 'Señalar',
    svg('<path d="M64 10l10 38 38 10-38 10-10 38-10-38-38-10 38-10z" fill="#fff6b0" stroke="#111" stroke-width="5" stroke-linejoin="round"/><path d="M104 8l4 14 14 4-14 4-4 14-4-14-14-4 14-4zM22 88l3 10 10 3-10 3-3 10-3-10-10-3 10-3z" fill="#fff6b0" stroke="#111" stroke-width="3" stroke-linejoin="round"/>')],
  ['reloj', 'Cuenta atrás', 'Señalar',
    svg('<circle cx="64" cy="68" r="46" fill="#fff" stroke="#111" stroke-width="7"/><rect x="50" y="8" width="28" height="12" rx="4" fill="#111"/><path d="M64 68V38M64 68l22 14" stroke="#111" stroke-width="9" stroke-linecap="round"/><circle cx="64" cy="68" r="6" fill="#ff3b30"/>')],
  // Globos de texto
  ['globo', 'Globo de texto', 'Globos', bubble('#ffffff', '#111', '', 0)],
  ['globo-hola', 'Globo "Hola"', 'Globos', bubble('#ffffff', '#111', 'HOLA', 26)],
  ['globo-wow', 'Globo "WOW"', 'Globos', bubble('#ffe500', '#111', 'WOW', 28)],
  ['globo-que', 'Globo "¿QUÉ?"', 'Globos', bubble('#ffffff', '#111', '¿QUÉ?', 24)],
  ['globo-pensar', 'Globo de pensamiento', 'Globos',
    svg('<ellipse cx="68" cy="48" rx="54" ry="36" fill="#fff" stroke="#111" stroke-width="5"/><circle cx="30" cy="98" r="10" fill="#fff" stroke="#111" stroke-width="4"/><circle cx="14" cy="118" r="6" fill="#fff" stroke="#111" stroke-width="3"/>')],
  ['grito', 'Globo de grito', 'Globos',
    svg('<polygon points="64,6 76,30 102,16 98,44 124,50 104,70 120,94 90,92 84,120 64,102 44,120 38,92 8,94 24,70 4,50 30,44 26,16 52,30" fill="#ff3b30" stroke="#111" stroke-width="5" stroke-linejoin="round"/>' + label('¡YA!', 64, 74, 28))],
  // Ofertas y etiquetas
  ['oferta', 'Sello de oferta', 'Ofertas', badge(12, '#ff3b30', 'OFERTA', 19)],
  ['nuevo', 'Sello "Nuevo"', 'Ofertas', badge(10, '#2563eb', 'NUEVO', 21)],
  ['descuento', 'Sello "-20%"', 'Ofertas', badge(14, '#ffd60a', '-20%', 30, '#111')],
  ['gratis', 'Sello "Gratis"', 'Ofertas', badge(12, '#22c55e', 'GRATIS', 20)],
  ['top', 'Sello "Top"', 'Ofertas', badge(8, '#7c5cff', 'TOP', 30)],
  ['etiqueta-precio', 'Etiqueta de precio', 'Ofertas',
    svg('<path d="M10 64L54 18h64v92H54z" fill="#ffd60a" stroke="#111" stroke-width="5" stroke-linejoin="round"/><circle cx="44" cy="64" r="8" fill="#fff" stroke="#111" stroke-width="4"/>' + label('$', 86, 82, 44, '#111'))],
  ['ultimos', 'Últimos días', 'Ofertas', pill('#ff3b30', 'ÚLTIMOS DÍAS', 15)],
  ['envio', 'Envío gratis', 'Ofertas', pill('#22c55e', 'ENVÍO GRATIS', 15)],
  // Redes
  ['sigueme', 'Botón "Sígueme"', 'Redes', pill('#7c5cff', 'SÍGUEME', 20)],
  ['suscribete', 'Botón "Suscríbete"', 'Redes', pill('#e11d48', 'SUSCRÍBETE', 16)],
  ['link-bio', 'Botón "Link en bio"', 'Redes', pill('#ffffff', 'LINK EN BIO', 16, '#111')],
  ['comparte', 'Botón "Comparte"', 'Redes', pill('#0ea5e9', 'COMPARTE', 19)],
  ['guardalo', 'Botón "Guárdalo"', 'Redes', pill('#f59e0b', 'GUÁRDALO', 19, '#111')],
  ['like', 'Corazón de me gusta', 'Redes',
    svg('<path d="M64 112C20 80 8 56 8 38 8 22 20 12 36 12c12 0 22 6 28 16 6-10 16-16 28-16 16 0 28 10 28 26 0 18-12 42-56 74z" fill="#ff2d55" stroke="#111" stroke-width="6" stroke-linejoin="round"/><path d="M30 34c-6 2-10 8-10 14" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/>')],
  ['campana', 'Campana de avisos', 'Redes',
    svg('<path d="M64 10c-22 0-34 16-34 38v22L16 92h96L98 70V48C98 26 86 10 64 10z" fill="#ffd60a" stroke="#111" stroke-width="6" stroke-linejoin="round"/><path d="M50 98a14 14 0 0 0 28 0z" fill="#111"/>')],
  ['en-vivo', 'En vivo', 'Redes',
    svg('<rect x="6" y="38" width="116" height="52" rx="12" fill="#e11d48" stroke="#111" stroke-width="5"/><circle cx="32" cy="64" r="9" fill="#fff"/>' + label('EN VIVO', 80, 74, 22))],
  ['parte', 'Parte 1', 'Redes', pill('#111111', 'PARTE 1', 20)],
];

const dir = 'public/stickers/clipo';
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });

const entries = [];
for (const [id, name, group, art] of STICKERS) {
  await writeFile(`${dir}/${id}.svg`, art);
  // A private-use character stands in for the emoji of these stickers (they are pictures, not emoji).
  entries.push({ glyph: String.fromCodePoint(0xe000 + entries.length), file: `clipo/${id}.svg`, name, group });
}
await writeFile(`${dir}/LICENSE.txt`, 'Original artwork made for Clipo. Same license as the app.\n');

const catalog = JSON.parse(await readFile('src/stickerCatalog.json', 'utf8')).filter((s) => !s.file.startsWith('clipo/'));
await writeFile('src/stickerCatalog.json', JSON.stringify([...catalog, ...entries], null, 1) + '\n');
console.log(`saved ${entries.length} own stickers`);
