// Downloads Kenney's CC0 audio packs and copies a curated set of sounds into public/sfx/kenney/,
// writing src/sfxCatalog.json. Run with: node scripts/fetch-kenney-sfx.mjs
// All packs are Creative Commons Zero (public domain): https://kenney.nl
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PACKS = [
  'impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds',
  'interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds',
  'casino-audio/2472606a04-1721639069/kenney_casino-audio',
  'sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds',
  'rpg-audio/8e99002d76-1677590336/kenney_rpg-audio',
  'digital-audio/216eac4753-1677590265/kenney_digital-audio',
  'ui-audio/490d233f68-1677590494/kenney_ui-audio',
  'music-jingles/f37e530b9e-1677590399/kenney_music-jingles',
];

/** [source file name, Spanish name, when to use it, category] */
const PICKS = [
  // Transiciones
  ['glitch_002.ogg', 'Glitch', 'Corte con falla digital', 'Transiciones'],
  ['glitch_004.ogg', 'Glitch corto', 'Cambio rápido de escena', 'Transiciones'],
  ['phaserUp1.ogg', 'Subida', 'Algo aparece', 'Transiciones'],
  ['phaserDown1.ogg', 'Bajada', 'Algo desaparece', 'Transiciones'],
  ['scratch_002.ogg', 'Raspón', 'Pausa con humor', 'Transiciones'],
  ['maximize_006.ogg', 'Abrir', 'Zoom hacia adentro', 'Transiciones'],
  ['minimize_006.ogg', 'Cerrar', 'Zoom hacia afuera', 'Transiciones'],
  // Impactos
  ['impactPunch_heavy_000.ogg', 'Puñetazo', 'Golpe fuerte', 'Impactos'],
  ['impactPunch_medium_002.ogg', 'Golpe', 'Golpe medio', 'Impactos'],
  ['impactSoft_heavy_001.ogg', 'Caída', 'Algo cae al suelo', 'Impactos'],
  ['impactMetal_heavy_002.ogg', 'Metal', 'Golpe metálico', 'Impactos'],
  ['impactWood_heavy_001.ogg', 'Madera', 'Golpe en madera', 'Impactos'],
  ['impactGlass_heavy_002.ogg', 'Vidrio', 'Golpe de vidrio', 'Impactos'],
  ['impactPlate_heavy_001.ogg', 'Plato', 'Plato que choca', 'Impactos'],
  ['impactBell_heavy_000.ogg', 'Campanazo', 'Momento importante', 'Impactos'],
  ['explosionCrunch_000.ogg', 'Explosión', 'Revelación explosiva', 'Impactos'],
  ['lowFrequency_explosion_000.ogg', 'Explosión grave', 'Impacto dramático', 'Impactos'],
  // Interfaz
  ['click_001.ogg', 'Clic', 'Tocar un botón', 'Interfaz'],
  ['mouseclick1.ogg', 'Clic de ratón', 'Tutoriales en PC', 'Interfaz'],
  ['confirmation_001.ogg', 'Confirmar', 'Algo salió bien', 'Interfaz'],
  ['confirmation_003.ogg', 'Listo', 'Tarea completada', 'Interfaz'],
  ['error_004.ogg', 'Error suave', 'Algo no salió', 'Interfaz'],
  ['question_001.ogg', 'Pregunta', 'Duda o pregunta', 'Interfaz'],
  ['select_005.ogg', 'Seleccionar', 'Elegir una opción', 'Interfaz'],
  ['scroll_003.ogg', 'Desplazar', 'Pasar una lista', 'Interfaz'],
  ['toggle_002.ogg', 'Interruptor', 'Activar algo', 'Interfaz'],
  ['rollover1.ogg', 'Pasar por encima', 'Resaltar algo', 'Interfaz'],
  ['pluck_001.ogg', 'Pluck', 'Aparece un texto', 'Interfaz'],
  ['bong_001.ogg', 'Bong', 'Dato curioso', 'Interfaz'],
  // Juegos
  ['powerUp1.ogg', 'Power up', 'Subir de nivel', 'Juegos'],
  ['powerUp7.ogg', 'Power up 2', 'Mejora o bonus', 'Juegos'],
  ['threeTone1.ogg', 'Logro', 'Logro desbloqueado', 'Juegos'],
  ['highDown.ogg', 'Perdiste', 'Fallo divertido', 'Juegos'],
  ['highUp.ogg', 'Ganaste', 'Victoria rápida', 'Juegos'],
  ['pepSound1.ogg', 'Pep', 'Saltito', 'Juegos'],
  ['zap1.ogg', 'Zap', 'Descarga', 'Juegos'],
  ['dice-throw-1.ogg', 'Dados', 'Suerte, azar', 'Juegos'],
  ['card-shuffle.ogg', 'Barajar', 'Cartas, sorpresa', 'Juegos'],
  ['chips-stack-1.ogg', 'Fichas', 'Apuesta, dinero', 'Juegos'],
  // Ciencia ficción
  ['laserRetro_000.ogg', 'Láser retro', 'Disparo de juguete', 'Ciencia ficción y magia'],
  ['laserLarge_000.ogg', 'Láser', 'Rayo potente', 'Ciencia ficción y magia'],
  ['forceField_000.ogg', 'Campo de fuerza', 'Escudo mágico', 'Ciencia ficción y magia'],
  ['computerNoise_000.ogg', 'Computadora', 'Tecnología, datos', 'Ciencia ficción y magia'],
  ['doorOpen_000.ogg', 'Puerta futurista', 'Entrada épica', 'Ciencia ficción y magia'],
  ['thrusterFire_000.ogg', 'Propulsor', 'Despegue', 'Ciencia ficción y magia'],
  ['slime_000.ogg', 'Slime', 'Algo asqueroso', 'Ciencia ficción y magia'],
  // Objetos y acciones
  ['doorOpen_1.ogg', 'Abrir puerta', 'Llegar a un lugar', 'Objetos'],
  ['doorClose_1.ogg', 'Cerrar puerta', 'Salir de un lugar', 'Objetos'],
  ['creak1.ogg', 'Crujido', 'Suspenso, casa vieja', 'Objetos'],
  ['bookFlip1.ogg', 'Pasar página', 'Siguiente paso', 'Objetos'],
  ['handleCoins.ogg', 'Monedas', 'Dinero, ahorro', 'Tiempo y dinero'],
  ['knifeSlice.ogg', 'Cuchillo', 'Cocina, cortar', 'Objetos'],
  ['chop.ogg', 'Picar', 'Recetas', 'Objetos'],
  ['metalPot1.ogg', 'Olla', 'Cocina', 'Objetos'],
  ['cloth1.ogg', 'Ropa', 'Moda, vestirse', 'Objetos'],
  ['footstep_concrete_000.ogg', 'Pasos', 'Caminar', 'Objetos'],
  ['footstep_grass_000.ogg', 'Pasos en pasto', 'Naturaleza', 'Objetos'],
  ['footstep_snow_000.ogg', 'Pasos en nieve', 'Invierno', 'Objetos'],
  // Cortinillas musicales
  ['jingles_HIT00.ogg', 'Cortinilla pop', 'Inicio de video', 'Cortinillas'],
  ['jingles_HIT05.ogg', 'Cortinilla pop 2', 'Final de video', 'Cortinillas'],
  ['jingles_NES00.ogg', 'Cortinilla 8-bit', 'Gamer, retro', 'Cortinillas'],
  ['jingles_NES08.ogg', 'Cortinilla 8-bit 2', 'Nivel completado', 'Cortinillas'],
  ['jingles_PIZZI00.ogg', 'Pizzicato', 'Divertido, travieso', 'Cortinillas'],
  ['jingles_PIZZI03.ogg', 'Pizzicato 2', 'Sorpresa', 'Cortinillas'],
  ['jingles_SAX00.ogg', 'Saxofón', 'Elegante, jazz', 'Cortinillas'],
  ['jingles_SAX04.ogg', 'Saxofón 2', 'Romántico', 'Cortinillas'],
  ['jingles_STEEL00.ogg', 'Steel drum', 'Verano, playa', 'Cortinillas'],
  ['jingles_STEEL06.ogg', 'Steel drum 2', 'Vacaciones', 'Cortinillas'],
];

const work = await mkdtemp(join(tmpdir(), 'kenney-'));
const files = new Map();
async function index(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await index(p);
    else if (e.name.endsWith('.ogg')) files.set(e.name, p);
  }
}
for (const pack of PACKS) {
  const name = pack.split('/').pop();
  const zip = join(work, `${name}.zip`);
  const res = await fetch(`https://kenney.nl/media/pages/assets/${pack}.zip`);
  if (!res.ok) throw new Error(`download ${name}: ${res.status}`);
  await writeFile(zip, Buffer.from(await res.arrayBuffer()));
  const dest = join(work, name);
  await mkdir(dest);
  // bsdtar (Windows 10+, macOS) reads zip. On Windows use the system one: Git Bash's GNU tar can't.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', zip, '-C', dest]);
  await index(dest);
}

const out = 'public/sfx/kenney';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const catalog = [];
const missing = [];
for (const [src, name, use, category] of PICKS) {
  const from = files.get(src);
  if (!from) {
    missing.push(src);
    continue;
  }
  const id = src.replace(/\.ogg$/, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
  await copyFile(from, join(out, `${id}.ogg`));
  catalog.push({ id, name, use, category, file: `${id}.ogg` });
}
await writeFile(
  join(out, 'LICENSE.txt'),
  'Sound effects by Kenney (www.kenney.nl), Creative Commons Zero (CC0 1.0).\nhttp://creativecommons.org/publicdomain/zero/1.0/\n',
);
await writeFile('src/sfxCatalog.json', JSON.stringify(catalog, null, 1) + '\n');
await rm(work, { recursive: true, force: true });
console.log(`saved ${catalog.length} sounds`);
if (missing.length) console.log('not found:', missing.join(', '));
