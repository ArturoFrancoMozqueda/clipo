# Recursos de Clipo

Todo lo que viene incluido en Clipo se puede usar en videos personales y
comerciales. Esta página dice de dónde sale cada recurso, su licencia y dónde
conseguir más.

> Regla de oro: solo metemos en la app recursos cuya licencia permite
> **redistribuirlos dentro de un programa**. Muchos sitios "gratis" (Pixabay,
> Mixkit, YouTube Audio Library) dejan usar sus archivos *en tus videos*, pero
> prohíben incluirlos en otra app. Por eso esos sitios aparecen abajo como
> "para importar tú", no dentro de Clipo.

## Incluido en la app

| Recurso | Cantidad | Origen | Licencia |
| --- | --- | --- | --- |
| Tipografías | 99 | [Fontsource](https://fontsource.org) (Google Fonts, alojadas en la app, se descargan al usarlas y quedan guardadas) | SIL Open Font License 1.1 / Apache 2.0 |
| Estilos rápidos de texto | 12 | Combinaciones propias de fuente + color + animación | Propias |
| Stickers | 152 | [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (estilo plano) | MIT. Aviso en `public/stickers/fluent/LICENSE.txt` |
| Filtros | 22 | Valores propios | Propios |
| Efectos de sonido | 115 en 11 categorías | 47 sintetizados por Clipo (`src/sound.ts`) + 68 grabaciones de [Kenney](https://kenney.nl/assets/category:Audio) | Propios + CC0 (dominio público) |
| Voces de texto a voz | 6 naturales + 2 de estudio | [Piper](https://github.com/rhasspy/piper) (`rhasspy/piper-voices`), se descargan la primera vez | Ver abajo |
| Música | 6 estilos, versiones ilimitadas | Compuesta por Clipo en el dispositivo, del largo del video | Propia: sin atribución |

### Tipografías incluidas

99 familias en 12 categorías (Modernas, Condensadas, Serif, Manuscritas, Caligrafía, Retro,
Cómic, Redondeadas, Elegantes, Tecnología, Máquina de escribir, Decorativas y terror). Todas
OFL 1.1 salvo seis Apache 2.0. Lista completa, licencia por familia y verificación de ñ/acentos
en [docs/video-editor/LICENSES.md](docs/video-editor/LICENSES.md).

Para agregar otra: `npm install @fontsource/<nombre>`, agrega sus archivos woff2 (latin y
latin-ext del peso elegido) en `src/fontFiles.ts`, la familia en la lista `FONTS` de
`src/fonts.ts` y su fila en `LICENSES.md`.

### Stickers

`node scripts/fetch-fluent-emoji.mjs` vuelve a descargar los stickers. Para
agregar más, añade el nombre en inglés del emoji (como aparece en la carpeta
`assets/` del repositorio de Fluent Emoji) a la lista `GROUPS` del script.

### Efectos de sonido

`node scripts/fetch-kenney-sfx.mjs` vuelve a descargar los paquetes de Kenney
y copia la selección a `public/sfx/kenney/`. Para agregar más, añade el
archivo a la lista `PICKS` del script. Los efectos sintetizados están en
`src/sound.ts` (lista `SYNTH`).

No hay risas, voces ni sonidos de animales: no se pueden sintetizar con buena
calidad y los paquetes CC0 no los traen. Para eso, importa un archivo propio
(ver "Para importar tú").

### Voces de texto a voz

| Voz en Clipo | Modelo Piper | Licencia del modelo |
| --- | --- | --- |
| Claudia | es_MX-claude-high | Apache 2.0 |
| Aldo | es_MX-ald-medium | Unlicense (dominio público) |
| Daniela | es_AR-daniela-high | CC BY-SA 4.0: requiere atribución |
| David | es_ES-davefx-medium | CC0 |
| Lucía y Martín | es_ES-sharvard-medium | CC BY 3.0: requiere atribución |
| Sofía y Mateo | Supertonic TTS 2 | Licencia del modelo en Hugging Face |

### Mi voz (tu propia voz)

Clipo lee el texto con una voz natural de Piper (Claudia o Aldo, según el tono de tu grabación) y
le cambia el timbre por el tuyo con el convertidor de tono de
[OpenVoice V2](https://github.com/myshell-ai/OpenVoice) de MyShell (**licencia MIT**), en versión
ONNX ([seasonstudio/openvoice_tone_clone_onnx](https://huggingface.co/seasonstudio/openvoice_tone_clone_onnx)).
Pesa 131 MB, se descarga la primera vez y tarda unos segundos por frase en el dispositivo.

Conserva la entonación de la voz base: suena a tu timbre, pero con el ritmo de la voz de Clipo.

Reglas de uso que Clipo aplica:

- Solo se puede crear una voz **grabándola en ese momento** con el micrófono (no subiendo audios de
  otras personas) y leyendo en voz alta una frase de autorización con tu nombre.
- Hay que marcar que es tu propia voz y que no la usarás para hacerte pasar por otra persona.
- La grabación se guarda solo en tu dispositivo y se puede borrar desde el panel "Texto a voz".

El motor que convierte texto en fonemas (`@diffusionstudio/piper-wasm`) incluye
datos de **espeak-ng, licencia GPL-3.0**. Para uso personal no hay problema; si
distribuyes Clipo, incluye el aviso de espeak-ng y un enlace a su código fuente
(https://github.com/espeak-ng/espeak-ng).

## Para importar tú (no se incluyen en la app)

Descárgalos y agrégalos con "Música → Tu propia música" o "Agregar". Lee
siempre la licencia de cada archivo: puede cambiar de uno a otro.

| Sitio | Qué tiene | Condiciones clave |
| --- | --- | --- |
| [YouTube Audio Library](https://studio.youtube.com) | Música y efectos | Algunas pistas piden atribución; pensada para YouTube |
| [Pixabay Music](https://pixabay.com/music/) | Música y efectos | Gratis en tus videos, sin atribución; no se puede redistribuir sola |
| [Mixkit](https://mixkit.co/free-stock-music/) | Música, efectos, video | Licencia Mixkit: uso comercial permitido, sin redistribuir |
| [Musopen](https://musopen.org) | Música clásica | Muchas grabaciones de dominio público (revisa cada una) |
| [Kenney](https://kenney.nl/assets/category:Audio) | Efectos y jingles | CC0 (dominio público): se pueden incluir hasta en la app |
| [Freesound](https://freesound.org) | Efectos de sonido | Filtra por CC0; las CC-BY piden atribución |
| [Pexels](https://www.pexels.com/videos/) / [Pixabay Video](https://pixabay.com/videos/) | Videos y fotos de stock | Uso gratuito en tus videos; no venderlos sin modificar |
| [Google Fonts](https://fonts.google.com) | Más tipografías | OFL / Apache: se pueden incluir en la app |
| [OpenMoji](https://openmoji.org) | Emojis alternativos | CC BY-SA 4.0: requiere atribución y compartir igual |

**Ojo con la música de artistas conocidos**: aunque la tengas comprada, subirla
a TikTok, Instagram o YouTube puede silenciar o bloquear tu video. Usa la
música de Clipo o la de la biblioteca de cada red social.

## Lo que no hacemos

No extraemos plantillas, efectos, música ni stickers de CapCut ni de otras
apps: son obras protegidas de sus dueños. Todo lo de esta lista es propio o
tiene una licencia que permite incluirlo.
