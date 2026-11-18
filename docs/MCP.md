# Editar Clipo con un agente de IA

Clipo incluye un servidor MCP local. Un agente conectado puede preparar un proyecto
en la app de escritorio y dejar sus cortes, textos, subtítulos, música y estilos
editables en la misma línea de tiempo que usas a mano. Cada lote tiene un paso de
Deshacer y se guarda en el almacenamiento habitual de Clipo.

## Conectar

Requiere Node.js 22.18 o superior. Para desarrollar: `npm install`. Para distribuir:
`npm run build` genera servidores autónomos con el SDK incluido en `mcp/standalone/`.
El paquete de escritorio los copia fuera del ASAR, a `resources/mcp/`.

1. Abre la versión actualizada de Clipo normalmente. Para desarrollar puedes ejecutar:

   ```sh
   npm run app:agent
   ```

   El arranque normal ya habilita el puente local autenticado. `--clipo-agent`
   sigue siendo compatible; no es necesario para conectarse. Para deshabilitarlo
   explícitamente usa `CLIPO_AUTOMATION=0` o `--disable-clipo-agent`.
   En desarrollo usa `mcp/server.mjs`; en una instalación usa
   `resources/mcp/server.mjs`, que no requiere el repositorio ni `node_modules`.
   `node resources/mcp/config.mjs` genera la configuración con su ruta absoluta.

2. Genera la configuración con las rutas reales de tu equipo:

   ```sh
   npm run --silent mcp:config
   ```

   Copia el objeto `clipo` a la configuración MCP de tu cliente. Usa el ejecutable
   de Node como `command` y la ruta absoluta a `mcp/server.mjs` como único argumento.
   El cliente inicia ese proceso; no hace falta ejecutar `npm run mcp` en otra terminal.

Para Codex también puedes registrar el servidor desde la raíz del repositorio:

```sh
codex mcp add clipo -- node "C:/ruta/al/repositorio/clipo/mcp/server.mjs"
```

Sustituye la ruta por la real. En `config.toml`, el equivalente es:

```toml
[mcp_servers.clipo]
command = "node"
args = ["C:/ruta/al/repositorio/clipo/mcp/server.mjs"]
tool_timeout_sec = 130
```

Recarga la conexión MCP del cliente después de agregarla. Codex admite servidores
locales por STDIO y configuración en TOML: [OpenAI Docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Si estás en un chat que todavía no ha recargado sus herramientas, puedes usar el
cliente MCP incluido desde ese mismo chat o una terminal:

```sh
node mcp/control.mjs tools
node mcp/control.mjs clipo_status - release/mcp/status.json
node mcp/control.mjs clipo_edit solicitud.json release/mcp/resultado.json
```

`solicitud.json` contiene los argumentos de la herramienta. `-` significa argumentos
vacíos. El último archivo recibe el resultado; las capturas se guardan junto a él.
Este cliente usa el protocolo MCP por STDIO y no necesita reiniciar el chat.

También hay transporte **Streamable HTTP**, con las mismas herramientas y contratos.
Define `CLIPO_MCP_TOKEN` con al menos 32 caracteres aleatorios y ejecuta
`npm run mcp:http` (o `node resources/mcp/http-server.mjs`). Escucha en
`http://127.0.0.1:3939/mcp`; `CLIPO_MCP_PORT` permite cambiar el puerto. El cliente
envía `Authorization: Bearer …`. Se rechazan peticiones con `Origin` y hosts ajenos
al loopback. No se expone públicamente ni se crea un túnel automáticamente.

Un cliente en la nube necesita además una pasarela HTTPS accesible y compatible
con su autenticación. El servidor local no implementa un proveedor OAuth ni
configura cuentas de clientes externos. El acceso local desde este chat sí usa MCP
real mediante `mcp/control.mjs`, sin Computer Use.

`npm run mcp:doctor` comprueba Node, descubrimiento, conexión, proyecto y guardado
sin mostrar el secreto de conexión.

## Qué pedirle al agente

> Conéctate a Clipo. Crea un reel vertical con los archivos de esta carpeta.
> Conserva estos fragmentos, agrega estos títulos y usa esta música al 25 %.
> Revisa la composición y deja el proyecto guardado y abierto para que yo lo ajuste.

El MCP proporciona operaciones; las decisiones de edición las toma el agente a
partir de tus instrucciones. No incorpora un modelo de IA ni necesita una API key.

## Herramientas

| Herramienta | Resultado |
| --- | --- |
| `clipo_connect` | Conecta o inicia la instalación conocida de Clipo, sin comandos ni rutas proporcionadas por el agente |
| `clipo_close_editor` | Guarda y cierra normalmente; conserva también preferencias, plantillas y perfiles de voz |
| `clipo_status` | Estado, revisión y catálogo real de filtros, transiciones, efectos, estilos y fuentes |
| `clipo_list_projects` | Proyectos guardados en la app de escritorio |
| `clipo_get_project` | Proyecto abierto, IDs, línea de tiempo, estado de guardado e historial |
| `clipo_preview` | Captura PNG de la ventana actual y estado del proyecto |
| `clipo_inspect_media` | Fotogramas de originales, hoja de contacto y candidatos de cambios de escena, sin mover el cabezal |
| `clipo_review_export` | Muestras visuales y audio del video exportado, mediciones y límites explícitos |
| `clipo_query_project` | Resumen o sección paginada con búsqueda e intervalo temporal |
| `clipo_get_request` | Recibo persistente de una solicitud con `requestKey`, para recuperar respuestas perdidas |
| `clipo_get_audio` | Audio original por intervalos de hasta 60 s para comparar voz, transcripción y tiempos, sin mezclar música |
| `clipo_review_audio` | Reanaliza un fragmento original de hasta 28 s sin modificar subtítulos; devuelve texto y marcas de palabra en el trabajo |
| `clipo_refresh_editor` | Tras compilar cambios locales, guarda y recarga Clipo conservando el proyecto y el cabezal |
| `clipo_generate_captions` | Inicia Whisper local con tiempos por palabra y estilo dinámico |
| `clipo_get_caption_job`, `clipo_cancel_caption_job` | Consulta progreso/errores/guardado o cancela una transcripción |
| `clipo_editor` | Selección, reproducción, zoom, modo avanzado y acceso a todos los paneles |
| `clipo_get_ui` | Controles semánticos reales, sus IDs, valores, opciones y archivos aceptados |
| `clipo_ui_action` | Acciona botones y cambia campos, listas o sliders del editor por sus IDs |
| `clipo_set_input_files` | Entrega medios, SRT/VTT, LUTs .cube y proyectos JSON a un selector del editor |
| `clipo_create_project` | Crea, guarda y abre un proyecto |
| `clipo_open_project` | Guarda el actual y abre otro; informa archivos ausentes |
| `clipo_import_media` | Importa archivos locales a la biblioteca y devuelve sus IDs |
| `clipo_import_capcut` | JSON y medios de CapCut → nuevo proyecto editable, guardado y con limitaciones informadas |
| `clipo_edit` | Aplica un lote completo como un paso de Deshacer |
| `clipo_plan_edit` | Valida un lote sin modificar el proyecto |
| `clipo_action` | 34 acciones directas de edición, análisis, generación, organización y exportación |
| `clipo_list_jobs`, `clipo_get_job`, `clipo_cancel_job` | Trabajos persistentes; progreso, resultados, error, cancelación e interrupción |
| `clipo_read_artifact`, `clipo_export_file` | Archivos persistentes, copia local por partes y verificación SHA-256; no sobrescribe |
| `clipo_audit` | Operaciones, revisiones y digest del proyecto; encolado no implica finalización |
| `clipo_undo`, `clipo_redo` | Deshace/rehace y guarda |
| `clipo_seek` | Pausa y coloca el cabezal en un segundo de la línea de tiempo |
| `clipo_save_project` | Guarda, o reintenta un guardado fallido |

`clipo_edit` admite agregar y modificar clips, texto, audio, stickers y
superposiciones; dividir, reordenar y eliminar elementos; cambiar nombre, formato,
mezcla de audio, encuadre, color, filtros, efectos, transiciones, animación y
keyframes. Los subtítulos suministrados se agregan como textos con `caption: true`,
con tiempos de palabras y karaoke opcionales.

Los clips principales son consecutivos: su duración es `(out-in)/speed`. `in` y
`out` se refieren al archivo original. Textos, música y superposiciones usan un
`start` absoluto en la línea de tiempo; `split_clip.at` también es absoluto.
Al cambiar la longitud o el orden de los clips, el agente debe ajustar esos tiempos
explícitamente. El lote preciso no aplica desplazamientos automáticos a otras pistas.

Para reproducir el desplazamiento automático de la interfaz, usa las acciones
`split_selection`, `duplicate_selection`, `delete_selection` y `move_clip`.
Estas llaman a las operaciones nativas: textos, subtítulos y otras pistas siguen
sus clips. Para dividir una animación existente usa `split_selection`.

`clipo_edit` también acepta fondo de persona, efecto de voz, LUT, congelado,
ruta de reencuadre y metadatos de redes. `clear` elimina campos opcionales;
`duplicate` y `split_item` operan sobre las pistas auxiliares.

## Ejemplo de lote

Lee primero `clipo_status` o `clipo_get_project`. Usa el `projectId`, la `revision`
y los IDs de archivos reales que devolvieron. Los siguientes valores son ejemplos:

```json
{
  "projectId": "ID_DEL_PROYECTO_ABIERTO",
  "expectedRevision": 7,
  "operations": [
    { "op": "settings", "name": "Reel listo para revisar", "aspect": "9:16" },
    {
      "op": "add_clip",
      "clip": { "assetId": "ID_VIDEO_IMPORTADO", "in": 2, "out": 8, "fit": "fill", "filter": "warm" }
    },
    {
      "op": "add_text",
      "text": { "text": "Así empezó todo", "start": 0, "duration": 3, "styleId": "titulo" }
    },
    {
      "op": "add_audio",
      "audio": { "assetId": "ID_MUSICA_IMPORTADA", "start": 0, "out": 6, "volume": 0.25, "role": "music", "fadeOut": 0.5 }
    }
  ]
}
```

La respuesta incluye la nueva revisión y los IDs de los elementos creados. Para
modificar uno, usa por ejemplo `{"op":"update_clip","id":"ID_CLIP","changes":{"volume":0}}`.
Los campos omitidos conservan su valor. Un lote inválido se rechaza completo.

## Usar las demás funciones del editor

El agente dispone de dos vías por MCP. Las operaciones de edición y los subtítulos
tienen herramientas directas. Las demás funciones usan los controles semánticos
del propio editor: no requieren Computer Use, coordenadas ni ejecutar JavaScript
proporcionado por el agente.

Abre el panel y selecciona el clip/texto/audio con `clipo_editor`; lee sus controles
con `clipo_get_ui`; acciona el botón o campo con `clipo_ui_action`. Cada observación
devuelve `viewId` y controles con IDs efímeros. Una acción consume la observación;
los controles obsoletos o deshabilitados se rechazan. Para archivos usa
`clipo_set_input_files` sobre el ID de una entrada `type: file`.

Esto permite recorrer las funciones de texto, fuentes, estilos, subtítulos,
stickers, biblioteca musical, sonidos, voz/TTS, mezcla y audio inteligente,
velocidad, filtros, efectos, transiciones, recorte, fondo, superposiciones,
keyframes, LUTs, reencuadre, plantillas, formatos, exportación y publicación.
Los controles ejecutan los mismos manejadores de la aplicación que usa una persona;
las operaciones asíncronas pueden seguir trabajando después de responder. Consulta
el estado y los mensajes antes de continuar. Un clic aceptado no demuestra por sí
solo que una exportación o proceso haya terminado correctamente.

Para subtítulos, `clipo_generate_captions` devuelve `job.id` inmediatamente. Consulta
`clipo_get_caption_job` hasta `completed`, `error` o `cancelled`. Los estados
intermedios incluyen descarga, preparación, reconocimiento y guardado. Por defecto
usa español, modelo preciso, frases cortas, entrada pop y palabra activa amarilla.
La finalización confirma el guardado; un error de disco se informa como error.

Para revisar palabras dudosas se puede pedir `quality: "revision"`: usa Whisper
large-v3-turbo local con pesos cuantizados (aproximadamente 1 GB la primera vez).
`clipo_get_audio` devuelve la grabación original para clientes con entrada de audio.
Conserva una lectura del proyecto antes de regenerar para comparar textos y tiempos.

## Límites y privacidad

- Esta versión controla la app de escritorio. Los proyectos del navegador/PWA y
  del teléfono tienen almacenamiento independiente.
- La importación acepta hasta 8 medios por llamada, de hasta 8 GiB cada uno,
  leídos localmente en bloques de 8 MiB. Detecta cambios del archivo durante la
  lectura y conserva los originales. Se usan rutas locales absolutas. Los documentos
  de edición mantienen 128 MiB. Para medios mayores, impórtalos desde la
  interfaz y deja que el agente use sus IDs.
- Hasta 200 operaciones por lote y 1 MiB por comando. Una sola llamada se procesa
  a la vez; el plazo normal del puente es de 120 segundos.
- `clipo_import_media` acepta `normalize: true` para crear una copia de trabajo
  H.264 de hasta 1080p/30 fps. Requiere FFmpeg y ffprobe en PATH. Detecta HLG/PQ,
  convierte HDR a SDR BT.709 con tone mapping y verifica códec y duración. Conserva
  el archivo original, devuelve recibos por medio y borra el temporal tras guardar.
  Esta llamada permite hasta diez minutos; el cliente MCP debe admitir ese plazo.
  `mcp/control.mjs` ya lo configura. Un timeout obliga a releer antes de reintentar.
  `ranges: [{from, to}, ...]` permite convertir sólo los fragmentos necesarios,
  en segundos del original y con un intervalo por ruta. El recibo conserva
  `sourceFrom`/`sourceTo`; los clips de la copia comienzan en cero. La conversión
  HDR utiliza Hable con pico explícito y transforma primarias antes del tone mapping.
- Los trabajos en segundo plano mantienen activo el procesamiento del editor
  aunque el chat esté delante. Al terminar y quedar inactivo, vuelve el ahorro
  de recursos. Consultar otro catálogo no pausa una exportación pendiente.
- Los cambios requieren la revisión actual y el proyecto abierto. Si editas
  mientras el agente importa o prepara cambios, el comando se detiene antes de
  modificar el proyecto. El agente debe volver a leerlo.
- Ante un error o timeout, consulta el estado antes de repetir una mutación.
  Un fallo de guardado puede dejar cambios aplicados en la interfaz; se informa
  expresamente y `clipo_save_project` permite reintentar.
- Transcripción, exportación, síntesis y análisis tienen trabajos MCP consultables.
  Los controles semánticos cubren también los diálogos portados fuera del editor;
  al abrirse un modal se exponen únicamente sus controles activos.
  Permisos del micrófono, grabación en vivo y el inicio de sesión OAuth de terceros
  pueden requerir intervención de la persona. No son capacidades del modelo.
  Publicar o subir contenido requiere instrucciones explícitas del usuario.
- El puente escucha únicamente en `127.0.0.1`, con puerto aleatorio y un secreto
  nuevo por sesión. Rechaza orígenes de navegador y no ofrece shell, ejecución de
  JavaScript ni lectura general del disco. Los controles semánticos no aceptan
  selectores arbitrarios, scripts ni IDs que el editor no haya devuelto.
- Las operaciones locales no suben medios; `publish` puede subirlos con autorización
  explícita del usuario. Los textos, metadatos y capturas
  que solicite el agente sí son visibles para su cliente/proveedor de IA.
- La conexión se descubre en `automation.json` dentro del perfil de Clipo
  (`%APPDATA%/clipo` en Windows). No copies ese archivo a un repositorio ni lo
  publiques. Se elimina al cerrar normalmente. Un cierre forzado puede dejarlo
  obsoleto; reiniciar Clipo en modo agente lo renueva.
- Para perfiles personalizados, define la misma variable `CLIPO_BRIDGE_FILE`
  en la app y en el proceso MCP. Cerrar Clipo desactiva el acceso.

## Verificación

```sh
npm test
npm run typecheck:tests
npm run build
npm run mcp:smoke
```

La prueba MCP abre Electron con un perfil temporal, conecta un cliente por STDIO,
importa imagen/audio, edita varias pistas, comprueba conflictos y lotes inválidos,
deshace/rehace, obtiene una captura, guarda, reinicia la app y vuelve a abrir el
proyecto con sus medios. También prueba exportación y decodificación final,
todos los catálogos visuales, fondo/reencuadre, proxy real y grabación con un
micrófono simulado. No usa los proyectos personales ni el micrófono físico del equipo.

Para incluir TTS y Whisper locales reales, con descarga de modelos:

```powershell
$env:CLIPO_MCP_FULL = '1'
npm run mcp:validate
```

FFmpeg y ffprobe deben estar en el PATH. `CLIPO_MCP_APP` permite probar un
ejecutable empaquetado; `CLIPO_MCP_SERVER` permite probar su servidor autónomo.
Para probar también el arranque automático de la distribución, define ambas
variables con el ejecutable y `resources/mcp/server.mjs` del mismo paquete. Una
copia del servidor en `mcp/standalone/` dentro del repositorio no tiene un
ejecutable instalado junto a ella y no sirve por sí sola para esa prueba de arranque.
El resultado se guarda en `release/mcp-validation/latest.json`, incluyendo
el estado global y cada flujo. MediaPipe intenta enviar diagnósticos opcionales
a `odml.pa.googleapis.com`; la CSP los bloquea. La prueba registra exclusivamente
esas denegaciones conocidas y falla ante cualquier otro error de consola.

## Acciones y resultados

`clipo_action` recibe `request: { action: …, … }`, además de proyecto y revisión.
`catalog` devuelve los IDs reales y las acciones admitidas. Hay 34 acciones directas:

| Dominio | Acciones |
| --- | --- |
| Línea de tiempo nativa | `split_selection`, `duplicate_selection`, `delete_selection`, `move_clip` |
| Proyectos/biblioteca | `duplicate_project`, `delete_project`, `remove_asset` |
| Imagen | `auto_color`, `import_lut`, `delete_lut`, `freeze`, `reframe`, `prepare_background` |
| Audio | `music`, `sfx`, `narration`, `analyze_audio`, `silences` |
| Subtítulos | `import_subtitles`, `restyle_captions`, `export_subtitles` |
| Archivos/redes | `export_video`, `export_project`, `capture_cover`, `check_social` |
| Personalización | `save_template`, `delete_template`, `apply_template`, `brand` |
| Publicación | `publishing_status`, `cancel_publication`, `retry_publication`, `publish` |

Las tareas largas devuelven `job.id`. Consulta `clipo_get_job` hasta un estado
terminal; un trabajo encolado no demuestra finalización. Los trabajos persisten;
un reinicio marca los incompletos como `interrupted`, sin repetir escrituras.
Cancelar impide insertar un resultado todavía no aplicado. Una escritura ya
aplicada puede terminar correctamente; se puede deshacer. La síntesis puede
necesitar terminar su cálculo antes de observar la cancelación.

`silences` con `apply: false` propone cortes sin aplicarlos. `auto_color` es
explícito: importar, consultar, subtitular y exportar no lo activan. Los cambios
guardados se verifican por relectura. Los videos exportados se decodifican otra vez
y se comprueba su duración. Los artefactos incluyen tamaño y SHA-256;
`clipo_export_file` verifica la copia completa, rechaza sobrescribir y elimina
copias incompletas. `export_project` contiene solo JSON, sin medios, y no es una
copia portátil completa. Borrar un proyecto conserva una copia de recuperación.

Recursos de solo lectura: `clipo://project`, `clipo://jobs`. Prompt: `edit-and-review`.
La matriz y los requisitos externos están en [MCP-COVERAGE.md](MCP-COVERAGE.md).

## Inspección y revisión visual

`clipo_inspect_media` recibe proyecto/revisión, `assetId`, `from`, `to`, `samples`
(1–24, por defecto 12) y `sceneThreshold` (0.05–1, por defecto 0.3). Lee el original
persistido mediante un decodificador independiente. Devuelve una hoja de contacto
como imagen MCP y tiempos en segundos de fuente. Una sola muestra corresponde al
punto medio del intervalo. Para fotos devuelve una imagen. El máximo por llamada
es 120 segundos; se pueden consultar ventanas sucesivas.

Cada muestra incluye luminancia, fracción oscura, diferencia de histograma y
diferencia de píxeles respecto a la anterior. `sceneChanges` propone intervalos
entre muestras, no tiempos exactos de corte. `DARK_SAMPLE` y `STATIC_SAMPLE_PAIR`
son candidatos: un plano negro o estático puede ser intencional. El informe
declara que no se comprobaron todos los fotogramas ni la legibilidad, la
sincronización audiovisual o si un congelado es inesperado.

`clipo_review_export` recibe `artifactId` y los mismos parámetros visuales. Revisa
el blob exportado, no un nuevo render de la línea de tiempo. `includeAudio: true`
(predeterminado) añade audio WAV y mediciones de la mezcla decodificada; limita
el intervalo a 60 segundos. LUFS y pico de muestras corresponden solo a ese
intervalo; no se mide true peak. Si no se pudo decodificar audio se informa
`decoded: false`, sin afirmar que el archivo es silencioso. Con
`expectedDuration` se contrasta la duración completa del artefacto; omitirlo
produce `durationCheck.measured: false`. Ambas herramientas conservan el proyecto,
la selección y el cabezal.

## Contexto y contratos de salida

El formato completo anterior sigue siendo el predeterminado. `response: "summary"`
en estado, proyecto, trabajos y operaciones con proyecto/revisión elimina el
proyecto completo y la lista de posiciones, conservando `projectSummary`, revisión,
IDs creados, recibos y resultados específicos. Se recomienda en consultas repetidas
de trabajos. `clipo_status` sigue incluyendo su catálogo.

`clipo_query_project` exige proyecto y revisión. `section` permite `summary`,
`assets`, `clips`, `texts`, `audios`, `overlays` o `stickers`. Acepta `search`,
`offset`, `limit` (1–100, por defecto 50) e intersección `[from,to)` en segundos de
línea de tiempo; los assets ignoran el intervalo. Las páginas devuelven `total`
y `nextOffset` (null al terminar). Si cambia el proyecto, la siguiente consulta
con la revisión anterior se rechaza. `clipo_list_projects` añade búsqueda y
paginación opcional; `clipo_list_jobs` añade filtros de proyecto/estado y
paginación opcional. Sin límite, estas dos listas conservan el comportamiento anterior.

Todas las herramientas anuncian `outputSchema` y devuelven `structuredContent`
equivalente al JSON del bloque de texto. Las imágenes y audios se mantienen en
sus bloques MCP. Los resultados heredados permiten campos adicionales de cada
acción. Los errores de concurrencia y del diario llevan códigos explícitos a
través de Electron; los mensajes antiguos de funciones nativas mantienen un
adaptador de clasificación para compatibilidad.

## Solicitudes recuperables y planes

`requestKey` es opcional en edición, acciones, importación, creación/apertura de
proyecto, guardado, deshacer/rehacer y trabajos de subtítulos/revisión de audio.
Elige una clave única por operación antes de enviarla. El diario se guarda antes
de ejecutar; al finalizar conserva un recibo compacto y la huella de los
argumentos, sin los argumentos originales ni el proyecto completo.

Si se pierde la respuesta, consulta `clipo_get_request` con esa clave. `completed`
significa que la solicitud devolvió un resultado persistido: para tareas largas
ese resultado es un ID de trabajo que todavía debe consultarse. Un reintento con
la misma clave y argumentos devuelve `replayed: true` y `requestResult`, sin
ejecutar otra escritura. La revisión actual aparece aparte en `projectSummary`.
`response` no cambia la identidad de la solicitud; `expectedRevision` sí.
Otros argumentos producen `REQUEST_KEY_REUSED`.

`running` o `unknown` exigen revisar proyecto, auditoría y trabajos. Un reinicio
convierte solicitudes en curso a `unknown`; nunca las repite. Una solicitud
registrada que falló puede haber aplicado cambios y se trata conservadoramente
como incierta. Las claves no se eliminan automáticamente: el diario admite hasta
1000, y rechaza nuevas claves al alcanzar ese límite. Esta recuperación no se
aplica a controles semánticos, cierre/recarga del editor o copias locales de artefactos.

Los planes detallan elementos agregados/eliminados/modificados, campos cambiados,
rangos anteriores/nuevos, ajustes y diferencias de duración total y de la pista
principal. Advierten sobre pistas auxiliares cuyos tiempos no cambian y elementos
que terminan después de la pista principal. No aplican ripple; los IDs nuevos
siguen siendo ilustrativos hasta ejecutar `clipo_edit`.

## Evaluaciones de tareas

Para actualizar una instalación local de Windows después de validar el paquete:
`node scripts/install-local-mcp.mjs release/mcp-packaged-validation/win-unpacked`.
El script respalda los binarios y la configuración MCP, cierra la app normalmente,
copia y verifica la instalación, y conserva el perfil de proyectos.

`node scripts/verify-installed-mcp.mjs ID_PROYECTO` abre una conexión nueva al
servidor instalado, comprueba las herramientas y consulta el proyecto real. La
inspección y el plan no alteran el original; edición, recuperación y exportación
usan una copia guardada llamada «Prueba MCP». Al terminar restaura el proyecto
original y el cabezal. Guarda evidencias locales en `release/mcp-validation/`.

`npm run mcp:eval` abre Electron con perfil temporal y ejecuta las tareas de
`evals/mcp-tasks.json`: montaje, conflicto con edición de la persona, recuperación
de respuesta perdida y revisión del exportado. El informe se guarda en
`release/mcp-validation/evaluations.json`, con llamadas, errores, bytes y tiempos.
El modo predeterminado es `scripted-reference`; no mide calidad de un LLM.

Para evaluar un agente real: `npm run mcp:eval -- --driver C:/ruta/adaptador.mjs`.
El módulo exporta `async function runTask({ prompt, tools, call, context })`.
`call(nombre, argumentos)` da acceso acotado a MCP; `context` contiene IDs y la clave
de solicitud. Devuelve `{ answer, model? }`. El adaptador elige proveedor y modelo;
no se instala uno ni se consumen APIs de pago automáticamente. Se comprueba el
estado final independientemente de la respuesta, y se inyectan conflictos y
pérdidas de respuesta. `modelQualityMeasured` permanece false: estos oráculos
miden cumplimiento técnico, no la calidad creativa de la edición.

## Referencias utilizadas

- [Aedelon/davinci-mcp: arquitectura](https://github.com/Aedelon/davinci-mcp/blob/main/ARCHITECTURE.md): ejecución centralizada, relectura, trabajos persistentes y recuperación sin repetir escrituras.
- [guycochran/resolve-mcp-server](https://github.com/guycochran/resolve-mcp-server): separar pruebas reales y simuladas, y comprobar el render final.

Clipo usa su propio motor y no depende de DaVinci Resolve.

El contrato compartido está en `src/automation/schema.ts`; la edición en
`src/automation/edits.ts`; la integración con el editor en
`src/automation/bridge.ts`; el puente de escritorio en `electron/automation.cjs`;
y el servidor MCP en `mcp/server.mjs`. Se usa el
[SDK oficial de MCP](https://github.com/modelcontextprotocol/typescript-sdk).
