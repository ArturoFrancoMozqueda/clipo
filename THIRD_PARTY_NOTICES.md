# Avisos de terceros

Clipo incluye o descarga al usarlos estos componentes de terceros. La lista completa, con revisiones
y análisis, está en [docs/video-editor/LICENSES.md](docs/video-editor/LICENSES.md).

## GPL-3.0-or-later: espeak-ng (dentro de piper-phonemize)

`@diffusionstudio/piper-wasm` (`piper_phonemize.wasm` y `.data`) contiene **espeak-ng** y sus
datos de idioma, con licencia GNU GPL v3 o posterior. Código fuente:

- espeak-ng: <https://github.com/espeak-ng/espeak-ng>
- piper-phonemize: <https://github.com/rhasspy/piper-phonemize>
- Compilación a WASM: <https://github.com/diffusionstudio/piper-wasm>
- Texto de la licencia: <https://www.gnu.org/licenses/gpl-3.0.html>

## Voces y modelos (se descargan la primera vez que se usan)

- **Voces Piper** (`rhasspy/piper-voices`, MIT), por Michael Hansen y colaboradores.
  - *Daniela* (es_AR): dataset OpenSLR 61, de Google. Licencia **CC BY-SA 4.0**: <https://creativecommons.org/licenses/by-sa/4.0/>
  - *Lucía / Martín* (es_ES, sharvard): corpus Sharvard, de la Universidad de Edimburgo. Licencia **CC BY 3.0**: <https://creativecommons.org/licenses/by/3.0/>
  - *Claudia*, *Aldo* y *David*: datasets Apache-2.0, Unlicense y CC0.
- **Supertonic TTS 2** (Supertone): **BigScience OpenRAIL-M**, <https://huggingface.co/Supertone/supertonic-2>. Al usar estas voces aplican sus restricciones de uso (Anexo A): no suplantar a personas, no desinformar y no hacer usos ilegales.
- **Whisper** (OpenAI): MIT / Apache-2.0.
- **OpenVoice tone color converter** (MyShell): MIT.
- **MediaPipe Selfie Segmenter** (Google): Apache-2.0.

## Bibliotecas y recursos incluidos

- ONNX Runtime Web (MIT), transformers.js (Apache-2.0), MediaPipe Tasks (Apache-2.0), mediabunny (MPL-2.0), React (MIT), lucide (ISC), zustand (MIT).
- Fuentes de Google Fonts vía Fontsource: SIL OFL 1.1 o Apache-2.0 (detalle en LICENSES.md).
- Efectos de sonido de Kenney: CC0 1.0. Stickers Fluent Emoji de Microsoft: MIT.
