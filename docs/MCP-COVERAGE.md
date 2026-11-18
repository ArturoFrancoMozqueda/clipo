# Cobertura del MCP de Clipo

Implementación local para Windows, validada el 18 de noviembre de 2026. No se
considera que abrir un panel o aceptar una solicitud pruebe su resultado final.
El servidor tiene 37 herramientas y 34 acciones directas; el contrato se comparte
entre servidor y editor en `src/automation/schema.ts`.

| Función | Acceso MCP | Verificación |
| --- | --- | --- |
| Inspección visual de originales | `clipo_inspect_media` | Video rojo/azul/negro → hoja de contacto, intervalos candidatos y muestras negras; proyecto, revisión y cabezal sin cambios |
| Revisión del archivo exportado | `clipo_review_export` | Exportación real → muestras decodificadas, audio WAV, LUFS del intervalo y duración; comprobaciones no medidas explícitas |
| Consultas pequeñas y paginadas | `clipo_query_project`, `response: summary`, filtros y páginas | Intersecciones temporales, búsqueda, rechazo de páginas con revisión obsoleta y compatibilidad del formato completo |
| Contratos estructurados | `outputSchema` y `structuredContent` | Cliente MCP real compara JSON legado y salida estructurada; esquemas de resultados y errores tipados por el puente |
| Recuperación por clave | `requestKey`, `clipo_get_request` | Respuesta descartada → recibo persistente → reintento sin duplicar; rechazo de otros argumentos y recuperación tras reinicio |
| Diferencias de planes | `clipo_plan_edit` | Rangos anteriores/nuevos, cambios de campos, duración total/principal y avisos de pistas auxiliares; sin modificar estado |
| Conexión normal y arranque automático | `clipo_status`, `clipo_connect` | Proceso único, arranque normal, conexión autenticada y relectura |
| Proyectos, guardado e historial | Herramientas de proyecto y acciones nativas | Electron real, IndexedDB, deshacer/rehacer y reapertura tras reinicio |
| Copia/borrado recuperable | `duplicate_project`, `delete_project` | Copia persistida y proyecto de recuperación que conserva medios |
| Importar fotos, video y audio | `clipo_import_media` | Metadatos, blobs persistidos, reproducción/render y rutas acotadas |
| Importar CapCut | `clipo_import_capcut` | Borrador y medios sintéticos → proyecto guardado → video decodificable; limitaciones informadas |
| Cortes, reordenación, duplicación y eliminación | `clipo_edit`, acciones nativas | Lotes atómicos, conflicto de revisiones, ripple y render final |
| Color, filtros y LUT | Edición, `auto_color`, acciones LUT | Importación/aplicación/eliminación de LUT, 33 filtros y corrección explícita |
| Efectos y transiciones | Edición | 32 efectos y 26 transiciones en una secuencia exportada y decodificada |
| Encuadre, giro y proporciones | Edición y editor | Validación de recorte/pose y exportación 9:16, 16:9, 1:1, 4:5 |
| Congelar imagen | `freeze`, división de clips | Video real sintético → congelado editable, deshacer y render |
| Fondo de persona | Edición y `prepare_background` | Fotografía de referencia, segmentación local y píxel verde comprobado en el video final |
| Reencuadre automático | `reframe` | Persona detectada, ruta guardada, eliminación de ruta y exportación |
| Texto, fuentes y animación | Edición y controles semánticos | 33 estilos, fuentes cargadas, animación y exportación; lógica adicional en pruebas unitarias |
| Keyframes, stickers y superposiciones | Edición y acciones nativas | Pistas animadas y ocho mezclas exportadas; catálogo y matemáticas en pruebas unitarias |
| Subtítulos suministrados | Acciones de subtítulos | SRT/VTT importado, restilizado, exportado y guardado por checksum |
| Subtítulos automáticos | `clipo_generate_captions` | TTS real → video → Whisper local → palabras temporizadas, guardado y SRT; prueba extendida |
| Revisión de audio original | `clipo_get_audio`, `clipo_review_audio` | WAV mono 16 kHz por intervalo y trabajo independiente que no modifica subtítulos |
| Música y efectos de sonido | `music`, `sfx`, controles semánticos | Síntesis real, audio no vacío, pista guardada y análisis del mix |
| Efectos de voz, ducking, normalización y silencios | Edición, análisis y `silences` | DSP unitario, análisis real, plan de silencios sin cambios y aplicación con ripple |
| Narración | `narration` | Motor local real y audio persistido en la prueba extendida; no se evalúa cada voz/modelo por separado |
| Grabar voz | Controles del panel | MediaRecorder real con micrófono sintético; nunca se abre el dispositivo físico en las pruebas |
| Perfil “Mi voz” | Diálogo semántico y `narration` con ID `my-…` | Alta/persistencia/borrado con audio sintético; semejanza con una voz humana no evaluada |
| Marca y plantillas | Acciones directas y controles | Persistencia, aplicación deshacible, eliminación de plantilla y marca |
| Proxies de vista previa | `clipo_editor`, estado/catálogo | Video 2560×1440 → proxy real → exportación con el original |
| Portada y adaptación social | `capture_cover`, `check_social`, metadatos | Captura espera al fotograma decodificado; audio y zonas seguras calculados con las funciones nativas |
| Exportación por versiones | `export_video` | Cuatro proporciones, metadatos decodificados, duración, FFmpeg/ffprobe y SHA-256 |
| Publicación/programación/cancelación | Acciones de publicación y controles | Cola y adaptadores YouTube/Meta con servicios simulados; rechazo real de cuentas inexistentes |
| Favoritos, búsquedas, recientes y ayuda | Controles semánticos | Lógica de la aplicación en pruebas unitarias; no se presenta cada combinación visual como un flujo E2E |
| Trabajos, auditoría y recuperación | Herramientas de trabajos/auditoría | Persistencia, cancelación por ID, errores de guardado, interrupción y ausencia de repetición automática |
| STDIO y Streamable HTTP | SDK oficial MCP | Clientes reales, herramientas/recursos/prompts, autenticación, límites de cuerpo y rechazo de orígenes web |
| Distribución autónoma | `resources/mcp/` | Servidor empaquetado sin TypeScript ni dependencias externas del SDK |

Los informes ejecutados se guardan en `release/mcp-validation/`. La prueba usa un
perfil temporal y dispositivos de audio simulados. “Probado” en una fila no implica
que cada valor de cada parámetro, cada modelo de IA o cada combinación entre efectos
haya sido probado. Los conteos de catálogo corresponden a la versión actual de Clipo.

## Requisitos y límites externos

- La publicación real necesita configuración de proveedor, OAuth y cuentas
  compatibles. Las pruebas no publican en las redes del usuario ni demuestran
  que esas cuentas estén conectadas. `pending`/`scheduled` no es `published`.
- TikTok, X y LinkedIn heredan las restricciones de la aplicación: no se inventa
  un adaptador de subida donde Clipo solo ofrece entrega manual.
- Las pruebas de micrófono no demuestran permisos o calidad del micrófono físico.
  Un perfil de voz humana requiere el consentimiento que pide la interfaz nativa.
- La conversión de timbre con una voz humana y cada modelo alternativo de TTS
  requieren validación específica; el MCP da acceso, sin prometer calidad no medida.
- La conexión remota desde un cliente en la nube necesita una pasarela HTTPS
  y la autenticación que ese cliente admita. El transporte HTTP local no publica
  automáticamente esta computadora ni implementa por sí solo un proveedor OAuth.
- `export_project` exporta JSON; los medios siguen en el almacenamiento local y no
  se incluyen en ese archivo. Los artefactos exportados deben gestionarse según
  el espacio disponible.

La prueba extendida se activa con `CLIPO_MCP_FULL=1`. Se separan sus resultados de
las pruebas sin descarga de modelos; consultar el campo `full` de cada informe.

`npm run mcp:eval` ejecuta cuatro tareas con oráculos de estado final, incluyendo
una edición concurrente y una respuesta perdida después del commit. Es una
referencia programada, no una evaluación de la capacidad de un modelo. Con
`npm run mcp:eval -- --driver C:/ruta/adaptador.mjs` se puede ejecutar un agente
externo con los mismos proyectos aislados, presupuestos y comprobaciones.
El informe `release/mcp-validation/evaluations.json` separa el modo, llamadas,
errores, tiempos y tamaño de respuestas. La suite no publica ni usa proyectos del usuario.

Referencias: [Aedelon](https://github.com/Aedelon/davinci-mcp/blob/main/ARCHITECTURE.md)
y [guycochran](https://github.com/guycochran/resolve-mcp-server). Se reutilizan
criterios de arquitectura/verificación, no la API ni el código del motor de Resolve.
