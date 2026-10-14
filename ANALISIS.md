# Clipo — Análisis y diseño de producto

> "Clipo" es un nombre provisional. No uses el nombre, logo ni diseños de
> CapCut: son marcas de ByteDance. La app toma ideas de producto, no código ni
> recursos.

## 1. Qué hace bien CapCut (análisis de la parte pública)

Fuentes: página oficial del editor de escritorio, guía oficial para
principiantes y reseñas de usuarios.

| Lo que ofrece | Por qué funciona para principiantes |
| --- | --- |
| Editor gratis en móvil, PC y web, con proyectos en la nube | El usuario empieza en el teléfono y termina en la PC sin aprender otra app |
| Pista principal "magnética": los clips se pegan solos, sin huecos | Nunca aparecen pantallas negras por error; mover un clip no rompe el resto |
| Cabezal de reproducción fijo al centro y la línea de tiempo se desliza debajo (móvil) | Con un dedo se navega el video; el punto de corte siempre está en el mismo sitio |
| Barra inferior contextual: cambia según lo que esté seleccionado | Solo se muestran 5–8 acciones relevantes en vez de 60 menús |
| Plantillas de texto, filtros y efectos con vista previa | Se elige viendo el resultado, sin saber de tipografía ni de color |
| Subtítulos automáticos con IA | La función más pedida para TikTok/Reels/Shorts |
| Formatos predefinidos (9:16, 16:9, 1:1) y reencuadre automático | El usuario piensa en "TikTok" o "YouTube", no en píxeles |
| Exportación rápida y "compartir con 1 clic" | El objetivo final es publicar, no "renderizar" |

Puntos débiles que se repiten en las reseñas (oportunidades):

- Funciones clave detrás de la suscripción Pro y marcas de agua.
- Subtítulos automáticos que fallan o dicen "demasiados usuarios".
- Interfaz de escritorio muy cargada para principiantes (fotogramas clave,
  curvas, rueda de color, IA generativa... todo a la vista).
- Requiere cuenta y sube contenido a la nube.

## 2. Posicionamiento de Clipo

**Para quién:** personas que nunca han editado video y quieren publicar un
video corto decente en minutos (negocios pequeños, docentes, creadores
principiantes).

**Promesa:** "Tu video listo en 3 pasos: agrega, ajusta, guarda". Sin cuenta,
sin marca de agua, y todo se procesa en tu dispositivo (privado).

### Principios de diseño (facilidad de uso)

1. **Etiqueta todo con palabras.** Cada botón tiene icono + texto en español
   claro ("Dividir", no "Split"; "Velocidad", no "Rate").
2. **Una decisión a la vez.** La barra inferior solo muestra acciones de lo
   seleccionado. Los ajustes se abren en un panel con pocos controles.
3. **Vista previa inmediata.** Filtros y estilos de texto se muestran como
   miniaturas; tocar = aplicar; se puede deshacer siempre.
4. **No se puede romper nada.** Deshacer/rehacer ilimitado, guardado
   automático, pista magnética sin huecos.
5. **Pensar en destinos, no en técnica.** "TikTok / Reels (vertical)",
   "YouTube (horizontal)", "Instagram (cuadrado)".
6. **Objetivos táctiles grandes** (≥ 44 px) y gestos simples: deslizar la
   línea de tiempo, arrastrar el texto sobre el video, pellizcar para zoom.
7. **Guía integrada.** Pantalla vacía con un único botón grande, consejos de
   primera vez y mensajes que dicen qué hacer, no qué falló.

## 3. Móvil y PC: decisión técnica

**Aplicación web progresiva (PWA)** con React + TypeScript + Vite.

- Un solo código para Android, iPhone, Windows, Mac y Linux.
- Se instala desde el navegador ("Agregar a pantalla de inicio" / "Instalar
  app") y funciona sin conexión.
- Todo el procesamiento es local (Canvas 2D, Web Audio, MediaRecorder): sin
  servidores ni costos de nube, y los videos del usuario no salen del equipo.
- Más adelante se puede empaquetar en tiendas con Capacitor (móvil) o
  Tauri/Electron (escritorio) sin reescribir.

**Diseño adaptable:**

| Móvil (vertical) | PC / tableta horizontal |
| --- | --- |
| Vista previa arriba, línea de tiempo en medio, barra de herramientas abajo | Biblioteca de medios a la izquierda, vista previa al centro, línea de tiempo abajo |
| Paneles como hojas inferiores | Paneles como hojas inferiores sobre la línea de tiempo |
| Gestos táctiles | Ratón, rueda y atajos de teclado (Espacio, S, Supr, Ctrl+Z) |

## 4. Alcance de la versión 1 (construida)

- Elegir formato: vertical 9:16, horizontal 16:9, cuadrado 1:1, retrato 4:5.
- Importar videos, fotos y audio (botón o arrastrar y soltar).
- Pista principal magnética con miniaturas; reordenar clips.
- Dividir en el cabezal, recortar con asas, duplicar, eliminar.
- Velocidad (0.25×–4×), volumen, filtros con vista previa, ajuste
  "Rellenar / Ajustar" con fondo desenfocado automático.
- Texto con estilos predefinidos, arrastrable sobre el video, con duración.
- Música/audio con volumen y fundidos.
- Deshacer/rehacer, guardado automático local (IndexedDB).
- Exportar a MP4 (o WebM si el navegador no admite MP4) en 720p o 1080p.
- Instalable como app (PWA), uso sin conexión.
- Consejos de primera vez y atajos de teclado.

## 5. Hoja de ruta sugerida

| Prioridad | Función | Cómo |
| --- | --- | --- |
| Alta | Subtítulos automáticos | Whisper en el navegador (transformers.js / WebGPU), 100 % local |
| Alta | Transiciones entre clips (fundido, deslizar) | Mezcla de dos fotogramas en el canvas |
| Alta | Exportación más rápida que tiempo real | WebCodecs + mp4-muxer |
| Media | Plantillas de video (ranuras para tus clips) | JSON de proyecto con espacios reemplazables |
| Media | Animaciones de texto (aparecer, escribir, rebotar) | Interpolación por tiempo en el renderizador |
| Media | Quitar fondo / pantalla verde | Segmentación con MediaPipe |
| Media | Stickers y emojis | Capa de imágenes como el texto |
| Baja | Fotogramas clave, curvas, rueda de color | "Modo avanzado" oculto por defecto |
| Baja | Sincronizar proyectos entre dispositivos | Opcional, con cuenta |

## 6. Sobre REA y CapCut

REA está instalado y funciona, pero **no se usó para descompilar CapCut**.
Los términos de uso de CapCut prohíben la ingeniería inversa, y el propio
aviso de REA limita su uso a software que poseas o estés autorizado a examinar.
Copiar su implementación también expondría el proyecto a reclamos de derechos
de autor. Todo lo de arriba sale de información pública y de cómo se comporta
el producto para cualquier usuario; el código de Clipo es original.

Usos legítimos de REA para este proyecto: estudiar editores de código abierto
(p. ej. Shotcut, Olive, OpenShot) o apps propias.
