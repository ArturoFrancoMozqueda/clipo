# Auditoría de Clipo — 15 oct 2026

## Estado tras los arreglos

Casi todos los puntos de abajo quedaron resueltos. `tsc` (src y tests) da 0 errores, pasan **143/143 tests** (26 nuevos) y `vite build` sale bien. En el navegador se probó a 375×812, 812×375 y 1440×900:
- Exportar cabe en la cabecera.
- La vista previa en horizontal pasó de ~60 px a ~260 px de alto.
- Escape cierra los modales.
- Las miniaturas de plantillas cargan.
- La vista previa no redibuja en pausa.

**Requiere acción tuya:**
1. `npm install && npx cap sync`. Instala `@capacitor/filesystem` y `@capacitor/share`, deja un solo onnxruntime-web (hoy siguen saliendo 2 `.wasm` asyncify en `dist/`) y actualiza el lockfile. Hasta entonces, guardar y compartir en la app nativa muestra un aviso.
2. Certificado de firma de Windows (`CSC_LINK`/`CSC_KEY_PASSWORD` o Azure Trusted Signing); ver PUBLICAR.md §3b. El auto-update está documentado pero no activado, porque falta un destino de publicación.
3. Revisar licencias (`docs/video-editor/LICENSES.md`):
   - ⚠️ espeak-ng (dentro de piper-phonemize) es **GPL-3.0**.
   - ⚠️ Voces Piper derivadas de un dataset de investigación.
   - ⚠️ Supertonic es OpenRAIL-M: hay que trasladar sus restricciones a los términos de Clipo.

**Sin verificar (necesita dispositivo real o la app empaquetada):**
- Grabar voz y compartir en Android.
- iPhone: interruptor de silencio, teclado virtual y guardar en Fotos.
- Límite de decodificadores en iOS.
- WebGL del color en Safari.
- Las fuses en el `.exe`.
- CSP y COOP/COEP una vez publicado.
- `minifyEnabled` en release.

**Quedó parcial:**
- La segmentación (Quitar fondo) no corre en un worker, pero ya no bloquea dentro del frame.
- El audio de los SFX se sigue decodificando completo (son de pocos KB).
- No se activó `noUncheckedIndexedAccess`: da 445 errores.
- El JS inicial sigue en ~205 KB gzip: la carga diferida de paneles ahorró ~30 KB, pero las funciones nuevas sumaron casi lo mismo.
- El motor de subtítulos todavía baja de jsDelivr.

---

Cuatro agentes revisaron el código (rendimiento, móvil/UX, calidad de código y seguridad) y además se probó la app en vivo en el navegador a 1440×900 (PC), 375×812 (teléfono vertical) y 812×375 (teléfono horizontal).

**Estado general:** `tsc --noEmit` sin errores · **117/117 tests pasan** · sin vulnerabilidades obvias en el código (no hay `innerHTML`/`eval`, OAuth con PKCE, Electron con `contextIsolation` + `sandbox`). La base es buena; los problemas están en el uso real en móvil y en sesiones largas.

---

## 🔴 Prioridad 1 — Roto o casi roto en móvil

| # | Problema | Dónde | Arreglo |
|---|---|---|---|
| 1 | **El botón Exportar se sale de la pantalla** en teléfonos de 375px (su borde derecho queda en 445px). La acción principal no se ve. *Confirmado en vivo.* | `.topbar` en `src/styles.css`, `Toolbar.tsx` | En móvil, dejar solo el icono en Exportar, o meter Plantillas/Ayuda en un menú "⋯". |
| 2 | **Descargar/Compartir no funcionan en la app Android/iOS**: el WebView ignora `<a download>` con blob y Android no tiene `navigator.share`. | `Panels.tsx:318`, `SocialPanel.tsx:410,465` | Con `Capacitor.isNativePlatform()`, usar `@capacitor/filesystem` + `@capacitor/share` (o un plugin de galería). |
| 3 | **Android no puede grabar voz**: falta `RECORD_AUDIO` en el manifest. | `android/app/src/main/AndroidManifest.xml:41` | Añadir `RECORD_AUDIO` y `MODIFY_AUDIO_SETTINGS`. |
| 4 | **Un `<video preload=auto>` por cada clip**, no por archivo. Si se divide un video en 20 trozos, hay 20 decodificadores → pantalla negra o la pestaña se cae en iOS. | `engine.ts:110-133` | Pool de 2-3 elementos por archivo; `preload="metadata"` para los inactivos. |
| 5 | **El export guarda el MP4 entero en RAM y lo duplica** (~600 MB de pico para 3 min a 1080p). | `exporter.ts:141,260` | `StreamTarget` a OPFS. |
| 6 | **Se decodifica el audio del archivo completo** en el hilo principal (subtítulos, sonido, export). | `captions.ts:59`, `sound.ts:347`, `exporter.ts:436` | Extraer solo el rango in/out con mediabunny, en un worker. |
| 7 | **Notch tapa controles en horizontal**: solo se usan los safe-area de arriba y abajo. | `styles.css:101-159`, `templates.css:43` | `padding-left/right: env(safe-area-inset-left/right)`. |

## 🟠 Prioridad 2 — Batería, estabilidad y UX

- **El preview redibuja a 60 fps estando en pausa** (`engine.ts:83-88, 317-348`). Es lo que más batería gasta. → Flag `dirty`; sin reproducción ni cambios, no programar el siguiente rAF. *(Lo detectaron dos agentes.)*
- **Fallback de color con `getImageData` por frame en iOS** (`color.ts:220`). → Usar el pipeline WebGL de `lut.ts` en un solo shader (también elimina la ida y vuelta 2D→GL→2D del LUT, `lut.ts:283`).
- **Fuga de nodos de audio**: `dispose()` no desconecta `src`/`gain` (`engine.ts:188-209`). → `r.src?.disconnect(); r.gain?.disconnect()`.
- **El historial hace `structuredClone` del proyecto completo en cada `pointermove`**, con thumbs y LUTs en base64 (hasta 100 copias) (`store.ts:73-116`). → `immer` y sacar `thumb`/`luts` del snapshot.
- **No hay ErrorBoundary** (`App.tsx`): un proyecto guardado dañado deja la pantalla en blanco cada vez que se abre.
- **El autoguardado falla en silencio** (`main.tsx:15,20`, `.catch(() => {})`): con la cuota llena se pierde trabajo sin aviso.
- **Paneles re-renderizan a 60 fps** al reproducir por `useStore(s => s.time)` (`TextPanels.tsx:234`, `VisualPanels.tsx:418`, `AdvancedPanels.tsx:49,239`, `SocialPanel.tsx:513`, `Preview.tsx:226`). → Suscripción por ref como en `Timeline.tsx:176`.
- **Asas de recorte de 18px** y filas de 26px (`styles.css:139`, `Timeline.tsx:17-19`): imposibles de usar con el dedo. Varios botones bajo 44px (`.icon-btn`, `.chip`, `.small-btn`, transiciones de 30px). → Zonas táctiles ≥44px con `@media (pointer:coarse)`.
- **El teclado virtual tapa los campos de texto** del sheet en iOS. → `visualViewport.resize` + `interactive-widget=resizes-content`.
- **Zoom accidental y menú de pulsación larga** en el editor. → `touch-action:manipulation; user-select:none; -webkit-touch-callout:none`.
- **iOS: preview en silencio con el interruptor de silencio** (Web Audio). → `navigator.audioSession.type = 'playback'`.
- **Teléfono horizontal: el preview mide ~60px** y la timeline queda apretada. *Visto en vivo.* → Layout de dos columnas (preview | timeline) en `orientation: landscape` con poca altura.
- **PC: la rueda en la timeline siempre desplaza en horizontal**, y las pistas de abajo quedan inalcanzables (`Timeline.tsx:193`). → Horizontal solo con Shift o si no hay scroll vertical.
- **Modales sin Escape, sin `role="dialog"` y sin trampa de foco** (`Home.tsx:112`, `CapcutImport.tsx:97`, `MyVoiceSetup.tsx:106`, `Onboarding.tsx:44`). *Confirmado en vivo: Escape no cierra el de CapCut.* → Componente `<Modal>` con `<dialog>.showModal()`.
- **Cancelar el export en los primeros 500 ms no hace nada**, y en segundo plano el export real-time se cuelga (`engine.ts:594`). Cualquier error del export rápido cae al modo lento (`exporter.ts:66`).
- **El micrófono queda encendido si `MediaRecorder` falla** (`VoicePanels.tsx:91`, `voice.ts:104`).
- **La cola de publicación puede atascarse** si falla IndexedDB (`publish/queue.ts:213`, fuera del `try`).
- **Dividir un audio deja los fundidos en las dos mitades** (`ops.ts:107`).
- **Subtítulos automáticos desfasados** si se edita mientras transcribe (`captions.ts:149,226`).

## 🟡 Prioridad 3 — Bundle, caché y arranque

| Recurso | gzip |
|---|---|
| JS inicial | **206 KB** (incluye todos los paneles) |
| Precache del Service Worker | **7,5 MB en la primera visita** |

- **Dos copias de onnxruntime-web** (1.30 y 1.31-dev de transformers) → un WASM extra de ~14 MB. → `overrides` en `package.json`.
- **El SW precachea 3,8 MB de fuentes y los workers de IA** que casi nadie usa (`scripts/swPrecache.ts:21`). → Precachear solo el shell; el resto en runtime-cache.
- **La caché `clipo-runtime` nunca se purga** (`public/sw.js:13`): cada versión deja WASM huérfanos de 11-26 MB.
- **El SW hace network-first sin timeout**: con mala señal la app no abre. → Timeout de 3 s y luego caché.
- **`React.lazy` para los paneles y el Editor**: -60/90 KB gzip estimados en el arranque.
- **WASM sin hilos fuera de Electron** (sin COOP/COEP): Whisper/Piper 2-4× más lentos en web y móvil.
- **El autoguardado clona todo el proyecto cada 600 ms** y Home hace `getAll()` (`db.ts:38`).

## 🔵 Seguridad y publicación en tiendas

- **Electron**: faltan los *fuses* (`RunAsNode`, `NODE_OPTIONS`, `--inspect`) → cualquiera puede ejecutar código con acceso a los tokens de YouTube. Sin firma de código ni auto-update.
- **Sin CSP** en web (`netlify.toml`, `index.html`) ni en Electron (`main.cjs:37`).
- **El video completo viaja por IPC en memoria** al subirlo a YouTube (`youtube.cjs:314`), sin validar `metadata`/`mime`.
- **Modelos de IA desde la rama `main`** sin hash (`toneConvert.ts:14`, `captions.ts:22`, `voice.ts:167`). → Fijar el commit y comprobar SHA-256.
- **Licencias de modelos sin documentar**: OpenVoice v1 y algunas voces Piper podrían ser **no comerciales**. Revisar antes de vender.
- **Android**: `allowBackup="true"` y un FileProvider que expone toda la raíz del almacenamiento externo (`file_paths.xml:3`). `versionCode 1` no sigue a la 0.4.0. `minifyEnabled false`.
- **iOS**: falta `PrivacyInfo.xcprivacy`; `NSPhotoLibraryAddUsageDescription` promete guardar en la galería y nada lo hace (riesgo de rechazo).
- Menores: `serve()` usa `startsWith(DIST)` sin separador (`main.cjs:32`); el permiso `media` se concede a cualquier origen (`main.cjs:132`); el scope `youtube.readonly` probablemente sobra.

## ⚪ Pulido

- `:hover` pegado en táctil (envolver en `@media (hover:hover)`), sin `prefers-reduced-motion`, texto de 10-11px, contraste del degradado rosa de Exportar < 3:1.
- Elementos del timeline son `<div onClick>` sin teclado ni rol.
- Toast monta y desmonta su `role="status"`; falta `apple-mobile-web-app-title` y `screenshots` en el manifest.
- 5 errores `ERR_FILE_NOT_FOUND` de blob URLs al crear desde una plantilla (miniaturas revocadas antes de tiempo). *Visto en vivo.*
- TS: añadir `noUncheckedIndexedAccess`; `tests/` no está en el `tsconfig`; falta `engines` (los tests requieren Node ≥22.18).
- `engine.ts` (1000 líneas) mezcla reproducción, audio, grabación y render, y crea canvas al importarse → separar `render.ts`/`playback.ts`/`recorder.ts`.
- Sin tests: undo/redo del store, `ops.ts` (split/delete), `captions.ts`, `visuals.ts`, la mezcla del exporter.
- Dependencias: `lucide-react` 0.468 muy antigua; React 19, Vite 7 y TS 5.9 disponibles. No se pudo correr `npm audit` (no hay `npm` en el PATH).

---

## Orden recomendado

1. **Móvil roto**: botón Exportar (#1), descargar/compartir nativo (#2), permiso de micrófono (#3), safe-areas (#7).
2. **Estabilidad y memoria**: pool de videos (#4), render solo si `dirty`, fuga de audio, historial con immer, ErrorBoundary.
3. **Táctil**: asas y botones de 44px, teclado virtual, zoom accidental, layout horizontal.
4. **Bundle/SW**: deduplicar onnxruntime, precache ligero, purga de caché, `React.lazy`.
5. **Antes de distribuir**: fuses + firma de Electron, CSP, licencias de modelos, ajustes de tiendas.
