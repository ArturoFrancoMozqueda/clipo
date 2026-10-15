# INSTRUCCIONES PARA CLAUDE CODE: AUDITAR E IMPLEMENTAR UN EDITOR DE VIDEO CON CAPACIDADES TIPO CAPCUT PRO

Actúa como Staff Full-Stack Engineer, Video Processing Engineer, Audio DSP Engineer, Product Designer y Tech Lead.

**Objetivo:** en ESTE repositorio existente implementar —sin destruir funcionalidades— un editor de video/audio/texto potente, inspirado funcionalmente en herramientas modernas como CapCut, con activos con licencia legítima. No quiero demos cosméticas, componentes mock vacíos ni listas de efectos que no funcionen. Tu trabajo debe dejar código ejecutable, pruebas, documentación, scripts de despliegue y una evaluación honesta de qué se implementó.

## Entradas que debes leer
- `INVESTIGACION_CAPCUT_PRO.md`: funcionalidades, taxonomías, hallazgos, fuentes y prioridades.
- `catalogo_editor_video.json`: listado de categorías de fuentes, música, SFX, efectos, presets de texto, transiciones y contrato de metadata. IMPORTANTE: los nombres de sonidos son TÉRMINOS DE BÚSQUEDA, no recursos descargados de CapCut; los nombres de fuentes son EJEMPLOS de Google Fonts, no inventario propietario de CapCut.

## Límites no negociables
1. NO descargar, extraer, hacer scraping, distribuir ni intentar reutilizar assets/código/marcas propietarias de CapCut (incluidas fuentes, canciones, efectos, presets, templates y archivos Pro) ni inventar una API pública de CapCut.
2. Construir capacidades propias o integrar proveedores con licencia clara. Para cualquier asset no propio, conservar metadata de licencia/procedencia/atribución/uso permitidos/fecha. **Deny-by-default** ante licencia desconocida.
3. NO asumir que una pista gratuita para usar en YouTube se pueda redistribuir dentro de nuestro SaaS. Mixkit prohíbe redistribución en herramientas; no cargar su contenido como stock integrado. Google Fonts: verificar licencia individual antes de alojar archivos. Freesound: filtrar CC0 y revisar condiciones de API + del asset.
4. Evitar copiar identidad visual, marcas, pantallas o nombres distintivos de CapCut. Inspiración funcional sin imitación confusoria.
5. No subir audio/video privado a servicios externos sin configuración/consentimiento explícito. No usar secrets en cliente.
6. No romper rutas, componentes, usuarios, cuentas, esquemas, tests o pipelines ya existentes.
7. NO prometer soporte 4K/60, tiempo real o IA si no existen pipelines reales. Mostrar limitaciones y feature flags.

## Fase 0 — Inspección del repo (obligatoria)
- Identifica framework, lenguajes, monorepo, rutas, editor actual, backend, DB, cola, storage, autenticación, infra, tests, componentes UI, métodos de export y restricciones de runtime.
- Enumera TODOS los features relacionados existentes y localiza módulos/puntos de extensión para evitar duplicación.
- Distingue frontend/browser versus servidores de render y costes de operación.
- Verifica si es aplicación web, desktop o móvil: adapta soluciones al stack real. NO migres arquitectura sin motivación.
- Escribe `docs/video-editor/AUDIT.md`: mapa de arquitectura, gaps, riesgos, plan por fases, dependencias y decisiones ADR.
- Escribe matriz `docs/video-editor/FEATURE_MATRIX.md`: feature | estado actual | prioridad | implementación | pruebas | dependencias | estado final.
- No interrumpas por decisiones menores: selecciona defaults seguros. Pregunta solo decisiones bloqueantes (e.g., proveedor de IA de pago, derechos de assets, costes de infraestructura), y mientras avanza en funciones que no dependan de ellas.

## Fase 1 — Arquitectura real
- Modelo de proyecto **no destructivo**: `Project`, `MediaAsset`, `Track`, `Clip`, `TextLayer`, `AudioLayer`, `EffectInstance`, `TransitionInstance`, `CaptionCue`, `Keyframe`, `ExportJob`, `LicensedAsset`, `Version`, `Favorite`.
- Todo clip debe usar startTime, sourceIn, sourceOut, duration, trackId; usar unidad de tiempo consistente (ms o frames con conversión precisa).
- Separar editor state, render specification, media files y preview; fuente de verdad única serializable y versionada.
- Motor de catálogo genérico (taxonomías y búsqueda) con filtros es/en, preview, tags, favoritos, paginación, permisos y licencia.
- Engine de efectos por procesador + JSON Schema de parámetros; implementar cada efecto que declares disponible en la interfaz; los no implementados deben quedar detrás de feature flags, nunca botones falsos.
- Render determinista: preview y MP4 export deben reflejar el mismo orden de capas, animaciones, transiciones, fuentes, subtítulos y mezclas de audio. Documentar discrepancias inevitables.
- Puntos de extensión: ASR/TTS, library provider, renderer, storage, queue. Implementar sin crear deuda indebida.

## Fase 2 — Funciones P0 prioritarias
1. Importar videos/imágenes/audio con validación, thumbnails, metadatos `ffprobe` y manejo de errores.
2. Timeline multicapa: trim, split, drag, reorder, select, move, snap, zoom, undo/redo, playhead, scrubbing, atajos, controles básicos.
3. Canvas 9:16 / 16:9 / 1:1 (añadir 4:5 si fácil), safe zones, overlay text; keyframes base para position/scale/opacity.
4. Texto con panel tipográfico real: font family, weight, italic, size, fill, outline, shadow, tracking, line-height, alignment, positioning, rotation, opacity, background. Persistir en formato portable; fonts fallback para ñ y tildes.
5. Tipografías: categorías de `catalogo_editor_video.json`, búsqueda y muestras; integrar API de Google Fonts (o catálogo estático seed confiable con posibilidad de actualizar) y licencias, NO copiar fuentes de CapCut.
6. Música y SFX: importar assets del usuario, colocar en pistas, waveform, volume, mute/solo, fade, trim, pan, preview en tiempo correcto; crear interfaz de catálogo de SFX por categorías, pero NO rellenarla con sonidos sin licencia.
7. Efectos y transiciones P0 REALMENTE renderizables: fade, dissolve, slide, zoom, blur, grain, basic brightness/contrast/saturation, sepia, black-and-white, vignette, drop-shadow text; presets de texto simple, outline, highlighted, typewriter.
8. Export de verdad en MP4/H.264 si codec está disponible legal/técnicamente, resolución 1080p, 30fps y orientación correcta; worker con progreso, cancelación, manejo de fallos, limpieza y enlace de descarga firmado.
9. Autosave y recuperar proyecto, media durable y documentación operacional.

## Fase 3 — Bibliotecas P1 y profesionalización
- Conectar biblioteca de fuentes con API Google Fonts; almacenar solo si licencia permite uso y distribución prevista.
- SFX: source adapter (solo uploads propios, CC0 expresamente verificado o licencia negociada para **biblioteca dentro de SaaS**). Freesound API v2 para discover/search, revisar términos antes de ofrecer dentro de producto; incluir attribution fields.
- Biblioteca de música con taxonomía JSON sin pistas fake. Conectar proveedor comercial cuando exista contrato correcto.
- Añadir subtítulos manuales + SRT/VTT, ASR opcional mediante interfaz configurable; word highlight si timestamps lo permiten.
- Panel de audio avanzado: normalización LUFS, noise reduction, ducking, voice effects DSP realizables (robot, pitch, echo, telephone, megaphone) y tests auditivos/de render.
- Keyframes y easing, presets text animation in/out/loop, looks de color, fades de volumen y waveform.
- UI con búsqueda, filtros por tipo y género, favoritos y previsualización legible. Funciones no soportadas se etiquetan 'planeado', sin prometerlas.

## Fase 4 — Funciones P2/P3 por factibilidad
Implementar tras P0/P1 y medición: beat sync, speed ramps, HSL/curves/LUT, masks/chroma, auto-reframe, tracking, transcript editing, auto-cuts, long-to-shorts, translation, TTS, background removal, generated SFX, IA. Toda integración de IA requiere proveedor/configuración/coste/cuotas/tratamiento de datos documentados. Evita proveedores pagados sin autorización.

## Criterios de aceptación obligatorios
- Al importar 2 videos, 1 imagen, 1 audio y 1 texto: timeline/preview/export aplican las mismas posiciones y duraciones; guardar/abrir reproduce exactamente la edición.
- Fuente con acentos y ñ: preview y export iguales, con fallback determinista.
- Subtítulo con 2 líneas y preset: respeta safe zones 9:16 y 16:9.
- Clip de 5 s con 1 transition, 1 SFX y fade: export refleja timing y audio en frame correcto, sin clipping inesperado.
- Invalid media, codec no disponible, asset sin licencia, servidor caído, job cancelado: errores reales y recuperación segura.
- No se expone un asset cuando `availability_status != active` o permisos/licencia no habilitan uso previsto.
- Unit tests + integration tests + mínimo 1 golden export test por preset; CI lint/typecheck/build/test; accesibilidad de controles.
- Log de export jobs con tiempos, tamaños, coste estimado; protecciones por límite de archivo, duración, concurrencia y cuotas.
- Responsive, teclado, seguridad de uploads, sanear paths, bloquear SSRF y URL remotas no permitidas.

## Entregables finales
A. Código implementado con cambios pequeños y explicados, migraciones y tests.
B. `docs/video-editor/ARCHITECTURE.md`, `FEATURE_MATRIX.md`, `LICENSES.md`, `RUNBOOK.md`, `VALIDATION.md`.
C. Registro `LICENSES.md` con fuente legal de cada asset efectivamente incluido. NO afirmar que nombres en catálogo equivalen a archivos.
D. Evidencia de `build`, `lint`, `tests` y exports verificables, con comandos/resultados; si hay limitaciones, listarlas.
E. Resumen claro de implementado, parcialmente implementado, no implementado, bloqueos y siguientes pasos.

**Regla de ejecución:** tras auditar, implementar tanto como sea posible de las fases habilitadas sin limitarte a elaborar un plan. Priorizar funcionalidad real y verificable frente a cantidad de botones.
