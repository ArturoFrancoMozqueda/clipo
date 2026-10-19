# Licencias de las fuentes de Clipo

Todas las fuentes vienen de [Fontsource](https://fontsource.org) (copias de Google Fonts), se
empaquetan con la app y se descargan bajo demanda (solo cuando un texto o el selector las usa).
Clipo incluye únicamente el peso indicado y los subconjuntos **latin** (y **latin-ext** cuando la
familia lo tiene), que cubren español, portugués, francés, italiano y alemán.

- **OFL-1.1** — [SIL Open Font License 1.1](https://openfontlicense.org): uso libre, también
  comercial, incrustada en apps y en videos exportados. No se puede vender la fuente sola; las
  versiones modificadas no pueden usar el nombre reservado de la fuente.
- **Apache-2.0** — [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0): uso libre,
  también comercial; conservar el aviso de licencia (está en el paquete de cada fuente, archivo
  `LICENSE`).

El texto de licencia de cada familia está en `node_modules/@fontsource/<familia>/LICENSE` y se
mantiene con la versión del paquete indicada abajo.

## Verificación

Para cada familia se revisó con fontTools que el archivo `latin` del peso usado contiene
`ñ Ñ á é í ó ú Á É Í Ó Ú ü Ü ¿ ¡`. Todas las de la lista pasan. Se descartó **Butcherman**
(catálogo: Terror / fantasía) porque no tiene el signo «¿».

Del catálogo `font_categories_open_source_examples` no se incluyeron, por ser casi iguales a otras
de la lista: Source Sans 3, Work Sans, Nunito Sans, Public Sans, Josefin Sans, Quicksand,
Questrial, Archivo Narrow, Crimson Text, Tangerine, Cedarville Cursive, Inconsolata, DM Mono,
Source Code Pro, Noto Sans Display y Noto Sans Mono. Todas existen en Fontsource con OFL-1.1 si
se quieren agregar (paquete + `src/fontFiles.ts` + `FONTS` en `src/fonts.ts`).

## Familias incluidas

| Familia | Categoría en Clipo | Peso | Licencia | Paquete | Subconjuntos |
| --- | --- | --- | --- | --- | --- |
| Montserrat | Modernas | 800 | OFL-1.1 | `@fontsource/montserrat` 5.3.0 | latin + latin-ext |
| Poppins | Modernas | 700 | OFL-1.1 | `@fontsource/poppins` 5.3.0 | latin + latin-ext |
| Inter | Modernas | 800 | OFL-1.1 | `@fontsource/inter` 5.3.0 | latin + latin-ext |
| Roboto | Modernas | 700 | OFL-1.1 | `@fontsource/roboto` 5.3.0 | latin + latin-ext |
| Open Sans | Modernas | 800 | OFL-1.1 | `@fontsource/open-sans` 5.3.0 | latin + latin-ext |
| Lato | Modernas | 900 | OFL-1.1 | `@fontsource/lato` 5.3.0 | latin + latin-ext |
| DM Sans | Modernas | 800 | OFL-1.1 | `@fontsource/dm-sans` 5.3.0 | latin + latin-ext |
| Manrope | Modernas | 800 | OFL-1.1 | `@fontsource/manrope` 5.3.0 | latin + latin-ext |
| Rubik | Modernas | 800 | OFL-1.1 | `@fontsource/rubik` 5.3.0 | latin + latin-ext |
| Urbanist | Modernas | 800 | OFL-1.1 | `@fontsource/urbanist` 5.3.0 | latin + latin-ext |
| Outfit | Modernas | 800 | OFL-1.1 | `@fontsource/outfit` 5.3.0 | latin + latin-ext |
| Jost | Modernas | 700 | OFL-1.1 | `@fontsource/jost` 5.3.0 | latin + latin-ext |
| Sora | Modernas | 800 | OFL-1.1 | `@fontsource/sora` 5.3.0 | latin + latin-ext |
| Lexend | Modernas | 700 | OFL-1.1 | `@fontsource/lexend` 5.3.0 | latin + latin-ext |
| Atkinson Hyperlegible | Modernas | 700 | OFL-1.1 | `@fontsource/atkinson-hyperlegible` 5.3.0 | latin + latin-ext |
| Noto Sans | Modernas | 800 | OFL-1.1 | `@fontsource/noto-sans` 5.3.0 | latin + latin-ext |
| Bebas Neue | Condensadas | 400 | OFL-1.1 | `@fontsource/bebas-neue` 5.3.0 | latin + latin-ext |
| Anton | Condensadas | 400 | OFL-1.1 | `@fontsource/anton` 5.3.0 | latin + latin-ext |
| Oswald | Condensadas | 700 | OFL-1.1 | `@fontsource/oswald` 5.3.0 | latin + latin-ext |
| Barlow Condensed | Condensadas | 800 | OFL-1.1 | `@fontsource/barlow-condensed` 5.3.0 | latin + latin-ext |
| Roboto Condensed | Condensadas | 800 | OFL-1.1 | `@fontsource/roboto-condensed` 5.3.0 | latin + latin-ext |
| Teko | Condensadas | 600 | OFL-1.1 | `@fontsource/teko` 5.3.0 | latin + latin-ext |
| Fjalla One | Condensadas | 400 | OFL-1.1 | `@fontsource/fjalla-one` 5.3.0 | latin + latin-ext |
| Saira Condensed | Condensadas | 800 | OFL-1.1 | `@fontsource/saira-condensed` 5.3.0 | latin + latin-ext |
| Playfair Display | Serif | 700 | OFL-1.1 | `@fontsource/playfair-display` 5.3.0 | latin + latin-ext |
| Merriweather | Serif | 900 | OFL-1.1 | `@fontsource/merriweather` 5.3.0 | latin + latin-ext |
| Lora | Serif | 700 | OFL-1.1 | `@fontsource/lora` 5.3.0 | latin + latin-ext |
| Libre Baskerville | Serif | 700 | OFL-1.1 | `@fontsource/libre-baskerville` 5.3.0 | latin + latin-ext |
| Cormorant Garamond | Serif | 700 | OFL-1.1 | `@fontsource/cormorant-garamond` 5.3.0 | latin + latin-ext |
| DM Serif Display | Serif | 400 | OFL-1.1 | `@fontsource/dm-serif-display` 5.3.0 | latin + latin-ext |
| EB Garamond | Serif | 700 | OFL-1.1 | `@fontsource/eb-garamond` 5.3.0 | latin + latin-ext |
| Bodoni Moda | Serif | 700 | OFL-1.1 | `@fontsource/bodoni-moda` 5.3.0 | latin + latin-ext |
| Prata | Serif | 400 | OFL-1.1 | `@fontsource/prata` 5.3.0 | latin |
| Noto Serif | Serif | 700 | OFL-1.1 | `@fontsource/noto-serif` 5.3.0 | latin + latin-ext |
| Dancing Script | Caligrafía | 700 | OFL-1.1 | `@fontsource/dancing-script` 5.3.0 | latin + latin-ext |
| Great Vibes | Caligrafía | 400 | OFL-1.1 | `@fontsource/great-vibes` 5.3.0 | latin + latin-ext |
| Allura | Caligrafía | 400 | OFL-1.1 | `@fontsource/allura` 5.3.0 | latin + latin-ext |
| Sacramento | Caligrafía | 400 | OFL-1.1 | `@fontsource/sacramento` 5.3.0 | latin + latin-ext |
| Parisienne | Caligrafía | 400 | OFL-1.1 | `@fontsource/parisienne` 5.3.0 | latin + latin-ext |
| Alex Brush | Caligrafía | 400 | OFL-1.1 | `@fontsource/alex-brush` 5.3.0 | latin + latin-ext |
| Italianno | Caligrafía | 400 | OFL-1.1 | `@fontsource/italianno` 5.3.0 | latin + latin-ext |
| Pinyon Script | Caligrafía | 400 | OFL-1.1 | `@fontsource/pinyon-script` 5.3.0 | latin + latin-ext |
| Caveat | Manuscritas | 700 | OFL-1.1 | `@fontsource/caveat` 5.3.0 | latin + latin-ext |
| Kalam | Manuscritas | 700 | OFL-1.1 | `@fontsource/kalam` 5.3.0 | latin + latin-ext |
| Patrick Hand | Manuscritas | 400 | OFL-1.1 | `@fontsource/patrick-hand` 5.3.0 | latin + latin-ext |
| Shadows Into Light | Manuscritas | 400 | OFL-1.1 | `@fontsource/shadows-into-light` 5.3.0 | latin + latin-ext |
| Indie Flower | Manuscritas | 400 | OFL-1.1 | `@fontsource/indie-flower` 5.3.0 | latin + latin-ext |
| Permanent Marker | Manuscritas | 400 | Apache-2.0 | `@fontsource/permanent-marker` 5.3.0 | latin |
| Satisfy | Manuscritas | 400 | Apache-2.0 | `@fontsource/satisfy` 5.3.0 | latin |
| Kaushan Script | Manuscritas | 400 | OFL-1.1 | `@fontsource/kaushan-script` 5.3.0 | latin + latin-ext |
| Righteous | Retro | 400 | OFL-1.1 | `@fontsource/righteous` 5.3.0 | latin + latin-ext |
| Lobster | Retro | 400 | OFL-1.1 | `@fontsource/lobster` 5.3.0 | latin + latin-ext |
| Pacifico | Retro | 400 | OFL-1.1 | `@fontsource/pacifico` 5.3.0 | latin + latin-ext |
| Abril Fatface | Retro | 400 | OFL-1.1 | `@fontsource/abril-fatface` 5.3.0 | latin + latin-ext |
| Alfa Slab One | Retro | 400 | OFL-1.1 | `@fontsource/alfa-slab-one` 5.3.0 | latin + latin-ext |
| Limelight | Retro | 400 | OFL-1.1 | `@fontsource/limelight` 5.3.0 | latin + latin-ext |
| Bungee | Retro | 400 | OFL-1.1 | `@fontsource/bungee` 5.3.0 | latin + latin-ext |
| Bowlby One SC | Retro | 400 | OFL-1.1 | `@fontsource/bowlby-one-sc` 5.3.0 | latin + latin-ext |
| Orbitron | Tecnología | 800 | OFL-1.1 | `@fontsource/orbitron` 5.3.0 | latin |
| Rajdhani | Tecnología | 700 | OFL-1.1 | `@fontsource/rajdhani` 5.3.0 | latin + latin-ext |
| Oxanium | Tecnología | 700 | OFL-1.1 | `@fontsource/oxanium` 5.3.0 | latin + latin-ext |
| Audiowide | Tecnología | 400 | OFL-1.1 | `@fontsource/audiowide` 5.3.0 | latin + latin-ext |
| Exo 2 | Tecnología | 800 | OFL-1.1 | `@fontsource/exo-2` 5.3.0 | latin + latin-ext |
| Chakra Petch | Tecnología | 700 | OFL-1.1 | `@fontsource/chakra-petch` 5.3.0 | latin + latin-ext |
| Space Grotesk | Tecnología | 700 | OFL-1.1 | `@fontsource/space-grotesk` 5.3.0 | latin + latin-ext |
| Space Mono | Máquina de escribir | 700 | OFL-1.1 | `@fontsource/space-mono` 5.3.0 | latin + latin-ext |
| JetBrains Mono | Máquina de escribir | 800 | OFL-1.1 | `@fontsource/jetbrains-mono` 5.3.0 | latin + latin-ext |
| IBM Plex Mono | Máquina de escribir | 700 | OFL-1.1 | `@fontsource/ibm-plex-mono` 5.3.0 | latin + latin-ext |
| Roboto Mono | Máquina de escribir | 700 | OFL-1.1 | `@fontsource/roboto-mono` 5.3.0 | latin + latin-ext |
| Special Elite | Máquina de escribir | 400 | Apache-2.0 | `@fontsource/special-elite` 5.3.0 | latin + latin-ext |
| Fredoka | Redondeadas | 700 | OFL-1.1 | `@fontsource/fredoka` 5.3.0 | latin + latin-ext |
| Baloo 2 | Redondeadas | 800 | OFL-1.1 | `@fontsource/baloo-2` 5.3.0 | latin + latin-ext |
| Comfortaa | Redondeadas | 700 | OFL-1.1 | `@fontsource/comfortaa` 5.3.0 | latin + latin-ext |
| Nunito | Redondeadas | 900 | OFL-1.1 | `@fontsource/nunito` 5.3.0 | latin + latin-ext |
| Varela Round | Redondeadas | 400 | OFL-1.1 | `@fontsource/varela-round` 5.3.0 | latin + latin-ext |
| Bubblegum Sans | Redondeadas | 400 | OFL-1.1 | `@fontsource/bubblegum-sans` 5.3.0 | latin + latin-ext |
| Sniglet | Redondeadas | 800 | OFL-1.1 | `@fontsource/sniglet` 5.3.0 | latin + latin-ext |
| Bangers | Cómic | 400 | OFL-1.1 | `@fontsource/bangers` 5.3.0 | latin + latin-ext |
| Luckiest Guy | Cómic | 400 | Apache-2.0 | `@fontsource/luckiest-guy` 5.3.0 | latin + latin-ext |
| Titan One | Cómic | 400 | OFL-1.1 | `@fontsource/titan-one` 5.3.0 | latin + latin-ext |
| Lilita One | Cómic | 400 | OFL-1.1 | `@fontsource/lilita-one` 5.3.0 | latin + latin-ext |
| Chewy | Cómic | 400 | Apache-2.0 | `@fontsource/chewy` 5.3.0 | latin |
| Comic Neue | Cómic | 700 | OFL-1.1 | `@fontsource/comic-neue` 5.3.0 | latin |
| Boogaloo | Cómic | 400 | OFL-1.1 | `@fontsource/boogaloo` 5.3.0 | latin |
| Monoton | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/monoton` 5.3.0 | latin + latin-ext |
| Press Start 2P | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/press-start-2p` 5.3.0 | latin + latin-ext |
| Black Ops One | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/black-ops-one` 5.3.0 | latin + latin-ext |
| Faster One | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/faster-one` 5.3.0 | latin + latin-ext |
| Cinzel Decorative | Decorativas y terror | 700 | OFL-1.1 | `@fontsource/cinzel-decorative` 5.3.0 | latin + latin-ext |
| Creepster | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/creepster` 5.3.0 | latin |
| Nosifer | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/nosifer` 5.3.0 | latin + latin-ext |
| Eater | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/eater` 5.3.0 | latin + latin-ext |
| Metal Mania | Decorativas y terror | 400 | OFL-1.1 | `@fontsource/metal-mania` 5.3.0 | latin + latin-ext |
| Cinzel | Elegantes | 700 | OFL-1.1 | `@fontsource/cinzel` 5.3.0 | latin + latin-ext |
| Marcellus | Elegantes | 400 | OFL-1.1 | `@fontsource/marcellus` 5.3.0 | latin + latin-ext |
| Italiana | Elegantes | 400 | OFL-1.1 | `@fontsource/italiana` 5.3.0 | latin |
| Forum | Elegantes | 400 | OFL-1.1 | `@fontsource/forum` 5.3.0 | latin + latin-ext |
| Tenor Sans | Elegantes | 400 | OFL-1.1 | `@fontsource/tenor-sans` 5.3.0 | latin + latin-ext |
| Belleza | Elegantes | 400 | OFL-1.1 | `@fontsource/belleza` 5.3.0 | latin + latin-ext |
| Instrument Serif | Serif (también en Tendencia) | 400 | OFL-1.1 | `@fontsource/instrument-serif` 5.3.0 | latin + latin-ext |
| Bricolage Grotesque | Modernas (también en Tendencia) | 800 | OFL-1.1 | `@fontsource/bricolage-grotesque` 5.3.0 | latin + latin-ext |
| Unbounded | Modernas (también en Tendencia) | 800 | OFL-1.1 | `@fontsource/unbounded` 5.3.0 | latin + latin-ext |
| Syne | Modernas (también en Tendencia) | 800 | OFL-1.1 | `@fontsource/syne` 5.3.0 | latin + latin-ext |
| Archivo Black | Modernas (también en Tendencia) | 400 | OFL-1.1 | `@fontsource/archivo-black` 5.3.0 | latin + latin-ext |
| Big Shoulders Display | Condensadas (también en Tendencia) | 900 | OFL-1.1 | `@fontsource/big-shoulders-display` 5.3.0 | latin + latin-ext |
| Fraunces | Serif (también en Tendencia) | 900 | OFL-1.1 | `@fontsource/fraunces` 5.3.0 | latin + latin-ext |
| Young Serif | Serif (también en Tendencia) | 400 | OFL-1.1 | `@fontsource/young-serif` 5.3.0 | latin + latin-ext |
| Gloock | Serif (también en Tendencia) | 400 | OFL-1.1 | `@fontsource/gloock` 5.3.0 | latin + latin-ext |
| Shrikhand | Retro (también en Tendencia) | 400 | OFL-1.1 | `@fontsource/shrikhand` 5.3.0 | latin + latin-ext |
| Rubik Mono One | Tecnología (también en Tendencia) | 400 | OFL-1.1 | `@fontsource/rubik-mono-one` 5.3.0 | latin + latin-ext |
| Bagel Fat One | Redondeadas (también en Tendencia) | 400 | OFL-1.1 | `@fontsource/bagel-fat-one` 5.3.0 | latin + latin-ext |
| Sour Gummy | Redondeadas (también en Tendencia) | 800 | OFL-1.1 | `@fontsource/sour-gummy` 5.3.0 | latin + latin-ext |
| Dela Gothic One | Decorativas y terror (también en Tendencia) | 400 | OFL-1.1 | `@fontsource/dela-gothic-one` 5.3.0 | latin + latin-ext |
| Silkscreen | Decorativas y terror (también en Tendencia) | 400 | OFL-1.1 | `@fontsource/silkscreen` 5.3.0 | latin + latin-ext |
| Rubik Glitch | Decorativas y terror (también en Tendencia) | 400 | OFL-1.1 | `@fontsource/rubik-glitch` 5.3.0 | latin + latin-ext |

---

# Modelos y voces

Revisado el 15 oct 2026 en las fichas de Hugging Face (API `huggingface.co/api/models/<repo>` y
`MODEL_CARD` de cada voz) y en los repositorios originales. Los modelos **no se incluyen** en la app:
se descargan la primera vez que se usan y quedan en la caché del navegador. Aun así, al usarlos Clipo
los "distribuye" a sus usuarios y genera audio/subtítulos con ellos, así que su licencia aplica.

Leyenda: ✅ uso comercial permitido · ⚠️ revisar antes de vender o cobrar por Clipo.

| Función en Clipo | Modelo / recurso | Origen (revisión fijada) | Licencia | Estado |
| --- | --- | --- | --- | --- |
| Subtítulos "rápido" | Whisper base (timestamped, ONNX) | `onnx-community/whisper-base_timestamped` (base: `openai/whisper-base`) | Apache-2.0 en la ficha de OpenAI (código y pesos MIT en GitHub); la conversión ONNX no declara licencia propia | ✅ |
| Subtítulos "preciso" | Whisper small (timestamped, ONNX) | `onnx-community/whisper-small_timestamped` (base: `openai/whisper-small`) | Igual que el anterior | ✅ |
| Voces "Sofía" y "Mateo" | Supertonic TTS 2 (ONNX) | `onnx-community/Supertonic-TTS-2-ONNX` (base: `Supertone/supertonic-2`) | **BigScience OpenRAIL-M** (modelo); código de ejemplo MIT | ⚠️ |
| Voz "Claudia" (México) | Piper `es_MX-claude-high` | `rhasspy/piper-voices` @ `375a0fe6` | Repo MIT; dataset Apache-2.0 | ⚠️ (ver lessac) |
| Voz "Aldo" (México) | Piper `es_MX-ald-medium` | ídem | Repo MIT; dataset Unlicense; afinada desde `davefx` | ⚠️ (ver lessac) |
| Voz "Daniela" (Argentina) | Piper `es_AR-daniela-high` | ídem | Repo MIT; dataset **CC BY-SA 4.0** (OpenSLR 61) | ⚠️ |
| Voz "David" (España) | Piper `es_ES-davefx-medium` | ídem | Repo MIT; dataset CC0 | ⚠️ (ver lessac) |
| Voces "Lucía" y "Martín" (España) | Piper `es_ES-sharvard-medium` | ídem | Repo MIT; dataset **CC BY 3.0** (Sharvard, Univ. de Edimburgo) | ⚠️ |
| "Mi voz" (cambio de timbre) | OpenVoice tone color converter (ONNX) | `seasonstudio/openvoice_tone_clone_onnx` @ `abb763f5` | Original OpenVoice V1 y V2 **MIT** desde abril de 2024 (MyShell); el repo ONNX **no declara licencia** | ⚠️ (menor) |
| Fonemas de Piper | espeak-ng compilado a WASM (`@diffusionstudio/piper-wasm`) | npm, incluido en la app | El paquete dice MIT, pero espeak-ng y sus datos son **GPL-3.0-or-later** | ⚠️ |
| Recorte de persona / fondo | MediaPipe Selfie Segmenter (`public/models/selfie_segmenter.tflite`) | Google MediaPipe, incluido en la app | Apache-2.0 (ficha del modelo de MediaPipe) | ✅ |
| Motor de IA | ONNX Runtime Web, transformers.js, MediaPipe Tasks | npm | MIT / Apache-2.0 / Apache-2.0 | ✅ |
| Efectos de sonido | Kenney (`public/sfx/kenney/`) | kenney.nl | CC0 1.0 (`LICENSE.txt` incluido) | ✅ |
| Stickers | Fluent Emoji (`public/stickers/fluent/`) | Microsoft | MIT (`LICENSE.txt` incluido) | ✅ |

Integridad: todos los modelos se piden a un **commit fijo**. Piper y OpenVoice además comparan cada
archivo con su SHA-256 antes de usarlo o guardarlo (`src/piperEngine.ts`, `src/toneConvert.ts`).
Whisper (`src/captions.ts`: base `608c49e6…`, small `65caa70f…`) y Supertonic (`src/voice.ts` y
`src/ttsWorker.ts`: `68d4d942…`) van fijados por `revision`.

## Veredicto para Clipo como app personal (uso propio, sin venta)

**Todo está permitido.** Las restricciones de abajo (⚠️) son de *uso comercial* o de *redistribución*,
y no aplican a usar Clipo uno mismo:

- Voces Piper/lessac (investigación no comercial) y Supertonic (OpenRAIL-M): el uso personal está
  dentro de lo permitido. Si publicas videos con estas voces, respeta las restricciones de uso de
  OpenRAIL-M (no suplantar a nadie, no desinformar).
- espeak-ng (GPL-3.0): la GPL no limita el uso. Como los instaladores se publican en un repositorio
  público de GitHub, se cumple igual: [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) lleva el
  aviso GPL y el enlace al código fuente, y el código de Clipo también es público.
- Daniela (CC BY-SA 4.0) y Sharvard (CC BY 3.0): la atribución está en THIRD_PARTY_NOTICES.md.

Solo habría que revisar las recomendaciones de abajo si algún día Clipo se vende, se publica en
tiendas o se cierra el código.

## ⚠️ Avisos y recomendaciones (solo si Clipo se vendiera)

1. **Voces Piper afinadas desde "lessac"** (claude, ald vía davefx, daniela, davefx, sharvard). Según
   sus fichas se entrenaron partiendo de la voz inglesa `en_US-lessac`, cuyo dataset (Blizzard 2013,
   Lessac Technologies / CSTR) tiene una licencia propia pensada para investigación **no comercial**.
   La comunidad de Piper discute si esa restricción pasa a las voces derivadas; no hay una respuesta
   firme. **Recomendación:** antes de vender Clipo, consultar con un abogado o sustituir/añadir voces
   entrenadas desde cero con datos de licencia libre; mientras tanto, no presentar las voces como
   "libres de derechos" en la tienda.
2. **Daniela (CC BY-SA 4.0) y Sharvard (CC BY 3.0)**: piden **atribución** (y, en BY-SA, compartir
   igual las obras derivadas del *modelo*). Recomendación: mostrar en "Acerca de" / créditos el autor y
   la licencia de cada voz; no modificar ni redistribuir los modelos con otra licencia.
3. **Supertonic 2 (OpenRAIL-M)**: permite uso comercial, pero con **restricciones de uso** (sin
   suplantación, desinformación, usos ilegales, etc.) que deben **trasladarse a los usuarios**.
   Recomendación: incluir esas restricciones (Anexo A de la licencia) en los términos de uso de Clipo
   y enlazar la licencia.
4. **espeak-ng (GPL-3.0)** dentro de `piper_phonemize.wasm`/`.data`: distribuirlo dentro de la app
   (web, Android, iOS, Windows) obliga a ofrecer el código fuente de esa parte y su licencia GPL.
   Recomendación: publicar el aviso GPL y el enlace al código de espeak-ng/piper-phonemize; si Clipo
   va a ser de código cerrado, valorar con un abogado si el WASM separado basta como "obra
   independiente", o cambiar a un fonemizador con licencia permisiva. Ojo también con la tienda de
   Apple: la GPL-3.0 es conflictiva con sus términos.
5. **OpenVoice ONNX sin licencia declarada**: el modelo original es MIT, pero la conversión de
   `seasonstudio` no indica licencia. Riesgo bajo; recomendación: pedir al autor que añada la licencia
   o convertir los pesos MIT originales nosotros mismos y alojarlos.
6. **"Mi voz" clona la voz del usuario**: aunque los modelos lo permitan, las tiendas y varias leyes
   piden consentimiento de la persona cuya voz se usa. Clipo ya pide consentimiento explícito al grabar;
   mantenerlo.
7. **MMS-TTS** (`ttsWorker.ts` conserva una rama para modelos `mms`): los modelos MMS de Meta son
   **CC BY-NC 4.0 (no comercial)**. Hoy no hay ninguna voz MMS en `VOICES`; no añadirlas si Clipo va
   a ser de pago.
