# Cómo publicar Clipo

Esta guía explica cómo poner Clipo en internet (web/PWA), cómo generar la app de Android (APK/AAB)
y qué se necesita para iOS. **Nada de esto se ha publicado todavía**: cada paso de subida lo haces tú
con tus propias cuentas.

Todos los comandos se ejecutan dentro de la carpeta `clipo/`.

---

## 0. Antes de publicar: pendientes conocidos

| Pendiente | Afecta a | Por qué importa |
|---|---|---|
| **Guardar el video exportado en la app nativa.** Hoy el botón usa `<a download>` y `navigator.share`. En el WebView de Android un enlace de descarga con `blob:` no hace nada y `navigator.share` con archivos no está garantizado; en iOS pasa algo parecido. | Android, iOS | Sin esto la app de tienda no puede guardar el resultado. Solución: en la versión nativa usar `@capacitor/filesystem` (escribir el MP4) + `@capacitor/share` (hoja de compartir / guardar en galería). La web no se ve afectada. |
| **Subtítulos automáticos necesitan internet la primera vez.** El modelo Whisper se descarga de `huggingface.co` y el motor ONNX (`.mjs` + `.wasm`) de `cdn.jsdelivr.net`. | Web, Android, iOS | Dilo en la ficha de la tienda. En iOS es más seguro **incluir el motor ONNX dentro de la app** (configurar `env.backends.onnx.wasm.wasmPaths` hacia `./assets/`) para no descargar código ejecutable (norma 2.5.2 de Apple). |
| **Un solo motor ONNX.** `package.json` fija `onnxruntime-web` a la versión que pide transformers.js y la fuerza con `overrides`; Piper y OpenVoice (`src/piperEngine.ts`, `src/toneConvert.ts`) usan la misma entrada (`onnxruntime-web/webgpu`) y el mismo `ort-wasm-simd-threaded.asyncify.wasm` (26 MB) que ya iba en `dist/`, así que desaparece el segundo `.wasm` de 14 MB. Las narraciones también lo cargan del propio `dist/` en vez de jsDelivr. | Tamaño del APK/IPA | Hace falta `npm install` para que el lockfile y `node_modules` queden con una sola copia. Los subtítulos (`src/captionsWorker.ts`) siguen pidiendo el motor a jsDelivr hasta que fijen `env.backends.onnx.wasm.wasmPaths` igual que `piperEngine.ts`. |
| **`appId` definitivo.** Ahora es `app.clipo.editor` en `capacitor.config.ts`. | Android, iOS | No se puede cambiar después de la primera subida. Usa un dominio que controles (p. ej. `com.tudominio.clipo`). Tras cambiarlo: borra `android/` e `ios/` y vuelve a ejecutar `npx cap add android` / `npx cap add ios` y `npm run icons`. |
| **Nombre y marca.** Clipo es un editor original. | Todas | No uses "CapCut" ni sus logos, capturas o textos en la ficha de la tienda ni en palabras clave: es motivo de rechazo (suplantación / propiedad intelectual). |

---

## 1. Versión web (PWA)

### Qué está preparado
- **Iconos PNG** generados desde `public/icon.svg` con `npm run icons`:
  `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (con zona segura para Android) y
  `apple-touch-icon.png` (180×180, sin transparencia). El manifiesto y `index.html` ya los usan.
- **Service worker con precarga ligera** (`public/sw.js` + `scripts/swPrecache.ts`): al compilar se
  escriben dos listas dentro de `dist/sw.js`:
  - *Precarga* (la "carcasa"): el JS/CSS de entrada y los trozos que importa, iconos, manifiesto y el
    archivo `latin` de las 14 fuentes más usadas (`POPULAR_FONTS`). Con eso **abre sin conexión** desde
    la primera visita.
  - *Todos los archivos* de `dist/assets/`. Las demás fuentes, los workers de IA, los `.wasm`/`.data` y
    MediaPipe se guardan en la caché `clipo-runtime` la primera vez que se usan. Al activarse una
    versión nueva se borran de esa caché los archivos de `assets/` que ya no existen (tienen hash en el
    nombre), y la precarga anterior. Las cachés de modelos y voces (`clipo-tone-*`, `clipo-voices-*`,
    `transformers-cache`) **no se tocan** (antes se borraban en cada actualización).
  - Las páginas usan "red primero": si en **3 s** no hay respuesta (mala señal), se abre la copia guardada.
- **Configuración de hosting**: `vercel.json` y `netlify.toml` (cabeceras de caché y seguridad).

### Comprobar antes de subir
```bash
npm run build
```
```bash
npm run preview
```
Abre `http://localhost:4173`, y en Chrome → DevTools → *Application*:
- *Manifest*: sin errores, iconos 192/512 y maskable visibles.
- *Service workers*: `sw.js` activo. Marca *Offline* y recarga: la app debe abrir igual.
- En la barra de direcciones aparece el icono de **Instalar**.

> Lighthouse ya no tiene categoría "PWA" (se quitó en Lighthouse 12). La instalabilidad se revisa en
> DevTools → *Application* → *Manifest* (sección *Installability*).

### Publicar en Vercel
1. Sube el repositorio a GitHub (si no lo está).
2. En vercel.com → *Add New → Project* → importa el repositorio.
3. **Root Directory: `clipo`**. Vercel lee `vercel.json` (framework Vite, `npm run build`, salida `dist`).
4. *Deploy*. Para un dominio propio: *Settings → Domains*.

Alternativa por terminal (requiere cuenta e inicio de sesión):
```bash
npx vercel --prod
```

### Publicar en Netlify
1. app.netlify.com → *Add new site → Import an existing project* → elige el repositorio.
2. **Base directory: `clipo`**. El resto lo toma de `netlify.toml` (`npm run build`, publica `dist`).
3. *Deploy site*.

También vale arrastrar la carpeta `dist/` a app.netlify.com/drop, pero entonces no se aplican las
cabeceras de `netlify.toml` (cópialo como `dist/_headers` si lo haces así).

### Cabeceras
Las mismas en `vercel.json`, `netlify.toml` y en la app de escritorio (`serve()` de `electron/main.cjs`).

| Ruta | Cabecera | Motivo |
|---|---|---|
| `/assets/*` | `Cache-Control: public, max-age=31536000, immutable` | Tienen hash en el nombre; nunca cambian. |
| `/`, `/index.html`, `/sw.js`, `/manifest.webmanifest` | `Cache-Control: no-cache` | Para que las versiones nuevas lleguen. |
| `/`, `/index.html` | `Content-Security-Policy` (abajo), `X-Frame-Options: DENY` | Solo se ejecuta código propio; nadie puede meter Clipo en un iframe. |
| Todo | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` | Seguridad básica. |
| Todo | `Permissions-Policy: microphone=(self), camera=(self), geolocation=(), …` | Micrófono solo para Clipo; nada de ubicación, pagos, USB… |
| Todo | `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless` | Aislamiento: WebAssembly con varios hilos (Whisper, Piper, OpenVoice 2-4× más rápidos). |

**CSP de la página** (`index.html` no tiene scripts en línea, así que no hacen falta hashes):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net;
worker-src 'self' blob:; connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co
https://*.hf.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co https://cdn.jsdelivr.net;
img-src 'self' blob: data: https://yt3.ggpht.com https://*.ggpht.com https://i.ytimg.com https://*.googleusercontent.com;
media-src 'self' blob: data:; font-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; manifest-src 'self';
object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

- `huggingface.co`, `*.hf.co` (almacenamiento Xet) y `cdn-lfs*`: modelos Whisper, Supertonic, Piper y OpenVoice.
- `cdn.jsdelivr.net`: transformers.js descarga de ahí el motor ONNX de los subtítulos (ver sección 0);
  `blob:` en `script-src` porque en Firefox/Safari lo carga como `blob:`. Se puede quitar cuando los
  subtítulos usen el motor local.
- `yt3.ggpht.com`, `i.ytimg.com`, `*.googleusercontent.com`: avatar del canal y miniaturas en Publicar.
- `'unsafe-inline'` en estilos: React usa atributos `style`.
- La CSP va **solo en la página**. Los workers de IA (`/assets/*Worker-*.js`) no la reciben: el
  pegamento de ONNX Runtime crea funciones en tiempo de ejecución para WebGPU (`new Function`), que una
  CSP sin `'unsafe-eval'` bloquearía. Qué scripts pueden ser workers lo sigue limitando `worker-src`.
- Si añades un servicio nuevo que la página llame directamente, añádelo a `connect-src` en los tres sitios.

**Aislamiento (COOP/COEP)**: `credentialless` deja descargar de Hugging Face/jsDelivr sin cabeceras
CORP en Chrome, Edge y Firefox. Safari no lo soporta: ahí la app funciona igual, con 1 hilo. Clipo no
abre ventanas emergentes (el inicio de sesión de YouTube va en el navegador del sistema desde la app de
escritorio), así que `same-origin` no rompe nada. Verifica tras publicar: en la consola,
`crossOriginIsolated` debe dar `true` en Chrome.

---

## 2. Android (APK y AAB)

### Qué está preparado
- Capacitor 8 (`capacitor.config.ts`, `appId: app.clipo.editor`, `webDir: dist`).
- Proyecto `android/` generado (compileSdk/targetSdk **36**, minSdk 24), con el icono adaptable
  y la pantalla de inicio de Clipo.
- Scripts:
  - `npm run cap:sync` → compila la web y la copia a `android/` e `ios/`.
  - `npm run cap:android` → compila, sincroniza y abre Android Studio.
  - `npm run cap:ios` → lo mismo para Xcode (solo en Mac).
  - `npm run icons` → regenera iconos y pantallas de inicio (web, Android e iOS).

### Versión, copia de seguridad y archivos compartidos
- `versionCode 400` / `versionName "0.4.0"` siguen a `package.json` (`versionCode` = mayor·10000 +
  menor·100 + parche). Súbelo en cada envío a Play.
- `android:allowBackup="false"` + `res/xml/data_extraction_rules.xml`: los proyectos y grabaciones de
  voz no van a la copia en la nube de Google ni a la transferencia entre teléfonos.
- `res/xml/file_paths.xml` (FileProvider): solo se comparten archivos de la caché de la app en
  **`share/`** (`@capacitor/filesystem` con `Directory.Cache` y `path: 'share/<archivo>'`, después
  `@capacitor/share` con la `uri` devuelta) y las fotos que hace la cámara del selector de archivos
  (`Pictures/` de la carpeta privada). Antes se exponía la raíz del almacenamiento externo.
- `minifyEnabled` sigue en `false`: `proguard-rules.pro` ya tiene las reglas para Capacitor; actívalo
  solo después de probar un build *release* en un teléfono real.

### Permisos y archivos de video
- Permisos declarados: `INTERNET` (modelos de IA), `RECORD_AUDIO` y `MODIFY_AUDIO_SETTINGS` ("Grabar
  voz" y "Mi voz"; Capacitor pide el permiso en tiempo de ejecución la primera vez que se graba). El
  micrófono se marca como opcional (`uses-feature … required="false"`).
- **Abrir videos**: el `<input type="file">` de Clipo abre el selector del sistema (en Android 13+ el
  *Photo Picker*). El usuario elige el archivo y la app recibe solo ese archivo, **sin pedir
  `READ_MEDIA_VIDEO` ni `READ_EXTERNAL_STORAGE`**. Así se cumple la política de Google Play sobre
  permisos de fotos y videos sin tener que justificar nada.
- **No añadas `READ_MEDIA_VIDEO`/`READ_MEDIA_IMAGES`** salvo que la app necesite leer toda la galería
  por su cuenta; Google Play exige un formulario de justificación y suele rechazarlo si basta el selector.
- **Cámara**: no se declara. Sin el permiso `CAMERA` el selector solo ofrece la galería y archivos.
- **Guardar el resultado**: ver "Pendientes" (sección 0). Con `@capacitor/filesystem` en
  `Directory.Documents`/`Cache` + `@capacitor/share` no hace falta ningún permiso extra en Android 10+.

### Requisitos en Windows
1. **Android Studio** (incluye el JDK 21 que necesita Gradle): https://developer.android.com/studio
2. En Android Studio → *SDK Manager*: instala **Android SDK Platform 36** y *Build-Tools*.
3. Variables de entorno (si usas la terminal): `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk` y
   `JAVA_HOME` apuntando a `C:\Program Files\Android\Android Studio\jbr`.

> En este equipo no hay JDK ni Android SDK instalados, por eso el proyecto se generó pero **no se
> compiló** ningún APK.

### APK de prueba (para instalar en tu móvil)
```bash
npm run cap:sync
```
```bash
cd android && gradlew.bat assembleDebug
```
El archivo queda en `android/app/build/outputs/apk/debug/app-debug.apk`. Cópialo al móvil (o
`adb install app-debug.apk`) y permite "instalar apps de origen desconocido".

### AAB firmado (lo que pide Google Play)
1. Crea una clave de subida **una sola vez** y guárdala con copia de seguridad (si la pierdes, hay que
   pedir a Google que la restablezca):
   ```bash
   keytool -genkeypair -v -keystore clipo-upload.jks -alias clipo -keyalg RSA -keysize 2048 -validity 10000
   ```
   **No subas el `.jks` ni sus contraseñas al repositorio.**
2. Sube el número de versión en `android/app/build.gradle` en cada envío:
   `versionCode` (entero que siempre aumenta: 1, 2, 3…) y `versionName` (texto visible, p. ej. `"1.0.1"`).
3. Genera el AAB, con Android Studio (*Build → Generate Signed App Bundle / APK → Android App Bundle*)
   o con Capacitor:
   ```bash
   npx cap build android --androidreleasetype AAB --keystorepath C:/ruta/a/clipo-upload.jks --keystorealias clipo
   ```
   (usa la ruta completa del `.jks`; pedirá las contraseñas). Resultado: `android/app/build/outputs/bundle/release/app-release.aab`.
4. En Google Play Console activa **Play App Signing** (obligatorio para AAB): Google firma la versión
   final; tú solo guardas la clave de subida.

---

## 3. iOS

### Qué está preparado
- Proyecto `ios/` generado (Swift Package Manager, sin CocoaPods), con icono 1024×1024 sin
  transparencia y pantalla de inicio de Clipo.
- En `ios/App/App/Info.plist` ya están los textos de permisos (en español):
  - `NSPhotoLibraryUsageDescription` (elegir videos de Fotos),
  - `NSPhotoLibraryAddUsageDescription` (guardar el video exportado en Fotos),
  - `NSCameraUsageDescription` y `NSMicrophoneUsageDescription` (el selector de iOS ofrece "Grabar
    video"; sin estos textos **la app se cierra** al tocarlo y Apple la rechaza),
  - `ITSAppUsesNonExemptEncryption = false` (solo usa HTTPS; evita la pregunta de exportación en cada envío).

### Requisitos (no se puede hacer desde Windows)
- **Un Mac** con la versión de **Xcode** que Apple exija en ese momento (en 2026: Xcode 26 / SDK de iOS 26).
  Alternativa sin Mac propio: un Mac en la nube (MacinCloud, etc.) o un servicio de CI con macOS
  (Ionic Appflow, Codemagic, GitHub Actions `macos-latest`).
- **Apple Developer Program**: 99 USD/año, con tu Apple ID (y verificación de identidad).
- Un iPhone para probar (recomendado).

### Pasos en el Mac
```bash
npm ci
```
```bash
npm run cap:ios
```
En Xcode:
1. *Signing & Capabilities* → elige tu *Team*; el *Bundle Identifier* debe coincidir con el `appId`.
2. *General* → *Version* (`MARKETING_VERSION`, ahora `0.4.0`, igual que `package.json`) y *Build*
   (`CURRENT_PROJECT_VERSION`, ahora `400`; siempre creciente).
3. **Manifiesto de privacidad**: ya está `ios/App/App/PrivacyInfo.xcprivacy` en el target *App* (sin
   seguimiento, sin datos recopilados; APIs con motivo: `UserDefaults` CA92.1 y fechas de archivos
   C617.1). Capacitor y sus plugins traen el suyo. Compruébalo en *Product → Archive →* informe de
   privacidad antes de subir.
4. *Product → Archive* → *Distribute App → App Store Connect* → *Upload*.
5. En App Store Connect: crear la app, completar la ficha y enviarla a revisión (o a TestFlight antes).

---

## 3b. Escritorio (Windows)

### Seguridad del ejecutable (fuses)
`package.json → build.electronFuses` (electron-builder 26 los aplica al empaquetar): `runAsNode`,
`NODE_OPTIONS` y `--inspect` desactivados (nadie puede usar Clipo.exe como intérprete de Node para leer
los tokens de YouTube), verificación de integridad del `app.asar` y carga solo desde `app.asar`, y
cookies cifradas. `npm run app:dev` y `app:smoke` no se ven afectados (no empaquetan).

### Firma de código (quita el aviso de SmartScreen)
No hay certificado en el repositorio. electron-builder firma solo si encuentra uno en el entorno:

- **Certificado `.pfx`** (OV/EV de una autoridad como DigiCert, Sectigo…):
  ```powershell
  $env:CSC_LINK = "C:\ruta\clipo-firma.pfx"        # o el .pfx en base64
  $env:CSC_KEY_PASSWORD = "contraseña-del-pfx"
  npm run app:dist
  ```
  (`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` si también firmas para macOS.) La configuración ya pide
  SHA-256 con sello de tiempo (`build.win.signtoolOptions`).
- **Azure Trusted Signing** (más barato, sin token USB): crea la cuenta y el perfil en Azure y añade en
  `package.json → build.win`:
  ```json
  "azureSignOptions": { "publisherName": "…", "endpoint": "https://…codesigning.azure.net/", "certificateProfileName": "…", "codeSigningAccountName": "…" }
  ```
  y quita `signtoolOptions` (no pueden ir juntos). Las credenciales van en variables de entorno
  (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`).
- **Nunca** subas el `.pfx` ni las contraseñas al repositorio; en CI usa secretos.

### Actualizaciones automáticas (pendiente)
Hoy no hay dónde publicar las versiones, así que no se activa. Pasos cuando lo haya:
1. `npm install electron-updater` (como dependencia normal) y quita `"!node_modules/**/*"` de
   `build.files` o incluye `node_modules/electron-updater/**` (hoy no se empaqueta ningún módulo).
2. Añade en `package.json → build` un destino, p. ej. GitHub Releases:
   `"publish": [{ "provider": "github", "owner": "<usuario>", "repo": "<repo>" }]`
   (o `"provider": "generic", "url": "https://tu-dominio/descargas/"`).
3. En `electron/main.cjs`, tras `app.whenReady()` y solo si `app.isPackaged`:
   `require('electron-updater').autoUpdater.checkForUpdatesAndNotify()`.
4. Publica con `electron-builder --win --publish always` (con `GH_TOKEN` en el entorno para GitHub).
   Las actualizaciones **tienen que ir firmadas** con el mismo certificado (`verifyUpdateCodeSignature`).

## 4. Checklist de políticas de las tiendas

### Común (Google Play y App Store)
- [ ] **Política de privacidad** publicada en una URL pública (puede ser una página de la propia web).
      Ambas tiendas la exigen aunque la app no recopile datos. Contenido mínimo sugerido para Clipo:
      - Los videos, fotos y proyectos se procesan y guardan **solo en el dispositivo** (IndexedDB).
      - No hay cuentas, anuncios, analítica ni rastreo.
      - Para los subtítulos automáticos y las voces se descargan modelos desde Hugging Face (y, para los
        subtítulos, el motor desde jsDelivr); **el audio no sale del dispositivo**. Esos servidores ven la
        IP como en cualquier descarga.
      - Contacto del responsable (email).
- [ ] Nombre, icono, capturas y descripción **propios** (nada de CapCut).
- [ ] Capturas reales de la app (móvil y, si aplica, tablet).
- [ ] Indicar en la descripción que los subtítulos necesitan internet la primera vez.
- [ ] Resolver los pendientes de la sección 0 (sobre todo **guardar el video** en la app nativa).
- [ ] Música, fuentes, plantillas y efectos incluidos con licencia que permita redistribuirlos.
- [ ] **Modelos y voces de IA**: revisar los avisos ⚠️ de `docs/video-editor/LICENSES.md` ("Modelos y
      voces") antes de vender o cobrar por Clipo.

### Google Play
- [ ] Cuenta de desarrollador de Google Play (pago único de 25 USD) con identidad verificada.
- [ ] **Cuentas personales nuevas**: prueba cerrada con al menos **12 testers durante 14 días** antes
      de poder pasar a producción.
- [ ] Subir **AAB** (no APK) con **Play App Signing**.
- [ ] **Nivel de API objetivo**: el proyecto apunta a **API 36**. Google sube el mínimo cada agosto;
      revisa el requisito vigente antes de cada actualización.
- [ ] **Páginas de memoria de 16 KB**: obligatorio para apps nuevas que apuntan a Android 15+. Clipo no
      incluye librerías nativas propias; compruébalo en Play Console (*App bundle explorer*) tras subir.
- [ ] **Seguridad de los datos (Data safety)**: "No se recopilan datos" y "No se comparten datos".
      Cifrado en tránsito: sí (HTTPS). Eliminación de datos: no aplica (sin cuentas).
- [ ] **Permisos**: `INTERNET` y micrófono (`RECORD_AUDIO`, para grabar la voz; el audio no sale del
      teléfono). No declarar permisos de fotos/videos (se usa el selector del sistema), así que no hay
      que rellenar la declaración de permisos de fotos y videos.
- [ ] **Clasificación de contenido** (cuestionario IARC): editor de video; contenido generado por el
      usuario que **no se comparte dentro de la app** → normalmente "Para todos / PEGI 3".
- [ ] **Público objetivo**: mayores de 13 (o 18). Si marcas menores de 13, se aplica la política de
      Familias, con requisitos extra.
- [ ] **Anuncios**: "No contiene anuncios". **Acceso a la app**: "Toda la funcionalidad disponible sin
      restricciones" (no hay inicio de sesión).
- [ ] Declaraciones restantes: no es app de noticias, salud, finanzas ni gobierno.
- [ ] Si distribuyes el APK **fuera de Play**: Google está implantando la verificación obligatoria de
      desarrolladores también para apps instaladas fuera de la tienda; revisa si aplica en tus países.

### Apple App Store
- [ ] **Apple Developer Program** activo y acuerdos aceptados en App Store Connect (incluido el de apps
      gratuitas).
- [ ] **Privacidad de la app ("etiquetas nutricionales")**: "No se recopilan datos".
- [x] **Manifiesto de privacidad** (`PrivacyInfo.xcprivacy`) añadido al target (ver sección 3).
- [ ] **Textos de permisos** en `Info.plist` claros y en el idioma de la app (ya incluidos).
- [ ] **Norma 4.2 – Funcionalidad mínima**: Apple rechaza apps que son "solo una web metida en una app".
      Ayuda que Clipo funcione sin conexión, guarde en Fotos con la hoja nativa y no muestre
      elementos de navegador. Pruébalo bien antes de enviar.
- [ ] **Norma 2.5.2 – Código descargado**: preferible incluir el motor ONNX en la app en vez de
      descargarlo de jsDelivr (sección 0). Descargar el **modelo** (datos) sí está permitido.
- [ ] **Clasificación por edades**: completar el cuestionario (sin contenido objetable → 4+ o el
      mínimo que corresponda en el sistema de edades actual).
- [ ] **Cifrado / exportación**: ya declarado `ITSAppUsesNonExemptEncryption = false`.
- [ ] **Unión Europea (DSA)**: declarar en App Store Connect si eres "comerciante" (trader); si lo eres,
      tu dirección, teléfono y email serán públicos en la ficha.
- [ ] URL de **soporte** (página o email de contacto) y URL de la política de privacidad.
- [ ] Capturas para iPhone 6,9" (y iPad 13" si se ofrece en iPad).

---

## 5. Resumen de archivos añadidos para la publicación

| Archivo | Para qué |
|---|---|
| `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | Iconos PWA |
| `public/manifest.webmanifest`, `index.html` | Referencian los iconos PNG |
| `public/sw.js`, `scripts/swPrecache.ts`, `vite.config.ts` | Service worker con precarga en el build |
| `scripts/icons.mjs` (`npm run icons`) | Genera todos los iconos y pantallas de inicio |
| `capacitor.config.ts`, `android/`, `ios/` | Apps nativas |
| `vercel.json`, `netlify.toml` | Hosting y cabeceras (CSP, COOP/COEP, Permissions-Policy) |
| `ios/App/App/PrivacyInfo.xcprivacy` | Manifiesto de privacidad de iOS |
| `android/app/src/main/res/xml/data_extraction_rules.xml` | Sin copia de seguridad de los datos de la app |
