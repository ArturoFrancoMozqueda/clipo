# Análisis del estudio "CapCut Pro" frente a Clipo

Fecha: 15 de octubre de 2026. Fuente: `INVESTIGACION_CAPCUT_PRO.md`,
`catalogo_editor_video.json` y `PROMPT_PARA_CLAUDE_CODE.md` (en esta carpeta).

**Objetivo de Clipo:** editar videos, adaptarlos a cada red social y
publicarlos en todas las cuentas del usuario desde la misma app.

## 1. Conclusión corta

1. **Clipo ya cubre casi todo el P0 del estudio y buena parte del P1/P2.**
   No hace falta rehacer la arquitectura que propone el prompt.
2. **El estudio no habla de publicar en redes.** Es la parte central del
   objetivo de Clipo y la que más trabajo nuevo exige.
3. **El prompt del estudio supone un SaaS con servidor** (workers de render,
   colas, URLs firmadas, cuotas, SSRF). Clipo es local: renderiza en el
   dispositivo, sin cuenta. Esa parte no aplica tal cual. Lo único que
   obliga a tener servidor es la publicación en redes (ver sección 4).
4. Las reglas de licencias del estudio son correctas y Clipo ya las cumple:
   fuentes OFL vía Fontsource, efectos Kenney CC0 o sintetizados, sin
   recursos de CapCut.

## 2. Qué ya tiene Clipo (v0.4.0) frente al estudio

| Área | Ya hecho en Clipo | Falta (del estudio) que vale la pena |
| --- | --- | --- |
| Timeline | Pista magnética, overlays (PiP), audio, texto, stickers; dividir, recortar, duplicar, mover; velocidad; deshacer/rehacer | Congelar imagen, reversa, recortar/voltear/rotar clip, curva de velocidad |
| Composición | Opacidad, 8 modos de fusión, quitar fondo (MediaPipe), fondos color/desenfoque/media, keyframes con easing | Chroma key, máscaras, **reencuadre automático** |
| Color | 30+ filtros, brillo/contraste/saturación/temperatura/tinte/luces/sombras/viñeta | LUT `.cube`, HSL, curvas |
| Texto | 14 fuentes, 8 estilos, animaciones entrada/salida/bucle, subtítulos automáticos (Whisper local, 6 idiomas) | **Resaltado palabra por palabra (karaoke)**, export/import SRT/VTT, más fuentes del catálogo, kit de marca |
| Audio | Música con volumen/fundidos, 115 efectos, TTS (Piper), Mi voz (clonación local) | **Ducking automático**, **normalización de volumen (LUFS)**, efectos de voz DSP (robot, teléfono, eco…), ritmo/beat sync |
| Transiciones / efectos | 5 transiciones, 5 efectos | Fundido a negro/blanco, empujar, iris, flash, glitch, giro, desenfoque |
| IA | Subtítulos, quitar fondo, TTS, clonación de voz | Quitar silencios y muletillas, "video largo → shorts" |
| Proyecto / export | Autosave, plantillas, importar proyectos de CapCut, export rápido WebCodecs MP4 720p/1080p 30 fps, PWA + Windows + Android/iOS | **Perfiles por red**, varias versiones en un solo export, portada, 60 fps |
| Publicar | Solo "Compartir" con la hoja del sistema (`navigator.share`) | **Todo: cuentas, publicación múltiple, programación, estado** |

No recomiendo por ahora (costo alto, poco valor para el objetivo):
generación de video/imagen/música, avatar, lip sync, borrar objetos,
colaboración en la nube, 4K.

## 3. Hoja de ruta propuesta

### Fase A: adaptar a cada red (sin servidor, 100 % local)

1. **Perfiles de destino**: TikTok, Instagram Reels, YouTube Shorts,
   YouTube, Facebook, X, LinkedIn. Cada uno con formato, resolución, fps,
   duración máxima y peso máximo (validar cifras vigentes antes de fijarlas).
2. **Zonas seguras por red** en la vista previa: dónde tapan los botones y el
   texto de cada app, para que subtítulos y títulos no queden debajo.
3. **Un proyecto, varias versiones**: exportar 9:16, 1:1 y 16:9 a la vez.
4. **Reencuadre automático**: seguir a la persona con la segmentación que ya
   existe para pasar de horizontal a vertical sin cortarla.
5. **Validación antes de publicar**: duración, peso, audio muy bajo o
   saturado, texto fuera de zona segura.
6. **Portada y texto de la publicación** (descripción y hashtags por red),
   guardados con el proyecto.

### Fase B: centro de publicación

1. Conectar cuentas (OAuth) de cada red.
2. Una publicación → varias redes y cuentas, con texto propio por red.
3. Programar fecha y hora.
4. Estado por red (subiendo, publicado, error con motivo) y reintento.

### Fase C: funciones del estudio que más ayudan en redes

1. Subtítulos palabra por palabra (karaoke) con las marcas de tiempo de Whisper.
2. Exportar e importar SRT/VTT.
3. Ducking automático (bajar la música cuando hay voz) y normalizar volumen.
4. 6–8 transiciones nuevas y 4–6 efectos (canvas, baratos de agregar).
5. Más fuentes del catálogo (todas OFL en Fontsource) con buscador por categoría.
6. Quitar silencios automáticamente (videos de una persona hablando).
7. Efectos de voz DSP con Web Audio.
8. Más adelante: beat sync y "video largo → varios shorts".

## 4. Publicar en redes: lo que hay que decidir

Publicar requiere las API oficiales de cada red. Los puntos que condicionan
el diseño (verificar los detalles vigentes de cada API al implementar):

- **Credenciales de la app**: cada red exige registrar una app de
  desarrollador. Los secretos de cliente no pueden ir dentro de la PWA.
- **Revisión de la plataforma**: TikTok, Meta (Instagram/Facebook) y
  YouTube revisan la app antes de permitir publicar en público. Sin esa
  revisión, lo subido suele quedar privado o en modo prueba. Esto lleva
  semanas y no depende del código.
- **Instagram y Facebook**: solo cuentas profesionales (Empresa/Creador)
  vinculadas a una página de Facebook.
- **YouTube**: cuota diaria de la API; cada subida gasta una parte grande.
- **X**: publicar video por API requiere un plan de pago.
- **Programar publicaciones**: si la app está cerrada a la hora programada,
  alguien tiene que publicar. Eso exige un servidor (o usar la programación
  nativa de cada red, donde la API la ofrezca).

Tres caminos:

| Camino | Ventajas | Desventajas |
| --- | --- | --- |
| **Servicio intermediario** (p. ej. Ayrshare, Upload-Post o similar) | Funciona en días, ya tiene la revisión de cada red, programación incluida | Pago mensual, el video pasa por un tercero |
| **API directas + servidor pequeño propio** | Sin intermediario, control total | Hay que registrar y pasar la revisión de cada red; mantener servidor y tokens |
| **API directas solo desde la app de escritorio** (sin servidor) | Más privado, sin costos de servidor | Sin programación con la app cerrada; no sirve en la PWA; igual requiere revisión de cada red |

Recomendación: empezar por la Fase A (no depende de esta decisión) y elegir
el camino de publicación en paralelo. Si la meta es usarlo pronto con tus
propias cuentas, el intermediario es lo más rápido; si Clipo se va a
distribuir a otros usuarios, conviene planear las API directas con servidor.
