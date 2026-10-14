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
| **`ort-wasm-simd-threaded.asyncify.wasm` (26 MB) en `dist/`.** Vite lo copia, pero el código lo pide al CDN, así que hoy no se usa. | Tamaño del APK/IPA | O se usa (punto anterior) o se excluye del build. El service worker ya no lo precarga. |
| **`appId` definitivo.** Ahora es `app.clipo.editor` en `capacitor.config.ts`. | Android, iOS | No se puede cambiar después de la primera subida. Usa un dominio que controles (p. ej. `com.tudominio.clipo`). Tras cambiarlo: borra `android/` e `ios/` y vuelve a ejecutar `npx cap add android` / `npx cap add ios` y `npm run icons`. |
| **Nombre y marca.** Clipo es un editor original. | Todas | No uses "CapCut" ni sus logos, capturas o textos en la ficha de la tienda ni en palabras clave: es motivo de rechazo (suplantación / propiedad intelectual). |

---

## 1. Versión web (PWA)

### Qué está preparado
- **Iconos PNG** generados desde `public/icon.svg` con `npm run icons`:
  `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (con zona segura para Android) y
  `apple-touch-icon.png` (180×180, sin transparencia). El manifiesto y `index.html` ya los usan.
- **Service worker con precarga** (`public/sw.js` + `scripts/swPrecache.ts`): al compilar, la lista de
  archivos con hash de `dist/assets/` se escribe dentro de `dist/sw.js`. En la primera visita se guarda
  toda la app y desde entonces **abre sin conexión**. Al publicar una versión nueva cambia el nombre de
  la caché y la anterior se borra sola.
  - Las páginas usan "red primero, caché si no hay red", para que las actualizaciones lleguen enseguida.
  - Los archivos de `assets/` (nunca cambian) se sirven desde la caché.
  - Los archivos de más de 3 MB (el `.wasm` de 26 MB) no se precargan; se guardan la primera vez que se usan.
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

### Cabeceras: por qué NO se activan COOP/COEP
`Cross-Origin-Opener-Policy` + `Cross-Origin-Embedder-Policy` sirven para tener `SharedArrayBuffer`
(memoria compartida entre hilos). Revisado en el código:

- **Ninguna función de Clipo usa `SharedArrayBuffer`** (ni la edición, ni la exportación, ni los subtítulos).
- **Subtítulos**: en equipos con WebGPU (Chrome/Edge modernos) no hace falta. En el modo WASM,
  ONNX Runtime comprueba `crossOriginIsolated` y, si no está activo, usa **1 hilo** en vez de varios.
  Funciona igual, solo más lento.
- Activar COEP `require-corp` **rompería** la descarga del modelo desde `huggingface.co` y del motor
  desde `cdn.jsdelivr.net` si alguna respuesta no trae `Cross-Origin-Resource-Policy`. La variante
  `credentialless` evita eso en Chrome y Firefox, pero no en todos los Safari.

Conclusión: **no se envían**. Si en el futuro se quiere acelerar el modo WASM, se puede probar
añadiendo `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: credentialless`
en `vercel.json`/`netlify.toml`, verificando antes los subtítulos en Chrome, Firefox y Safari.

Cabeceras que sí se envían:

| Ruta | Cabecera | Motivo |
|---|---|---|
| `/assets/*` | `Cache-Control: public, max-age=31536000, immutable` | Tienen hash en el nombre; nunca cambian. |
| `/`, `/index.html`, `/sw.js`, `/manifest.webmanifest` | `Cache-Control: no-cache` | Para que las versiones nuevas lleguen. |
| Todo | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` | Seguridad básica. |

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

### Permisos y archivos de video
- El único permiso declarado es `INTERNET` (para descargar el modelo de subtítulos).
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
2. *General* → *Version* (`1.0.0`) y *Build* (1, 2, 3… siempre creciente).
3. **Manifiesto de privacidad**: *File → New → File → App Privacy* (`PrivacyInfo.xcprivacy`) en el
   target *App*: sin seguimiento, sin datos recopilados. Capacitor ya incluye el suyo.
4. *Product → Archive* → *Distribute App → App Store Connect* → *Upload*.
5. En App Store Connect: crear la app, completar la ficha y enviarla a revisión (o a TestFlight antes).

---

## 4. Checklist de políticas de las tiendas

### Común (Google Play y App Store)
- [ ] **Política de privacidad** publicada en una URL pública (puede ser una página de la propia web).
      Ambas tiendas la exigen aunque la app no recopile datos. Contenido mínimo sugerido para Clipo:
      - Los videos, fotos y proyectos se procesan y guardan **solo en el dispositivo** (IndexedDB).
      - No hay cuentas, anuncios, analítica ni rastreo.
      - Para los subtítulos automáticos se descarga un modelo desde Hugging Face y un motor desde
        jsDelivr; **el audio no sale del dispositivo**. Esos servidores ven la IP como en cualquier descarga.
      - Contacto del responsable (email).
- [ ] Nombre, icono, capturas y descripción **propios** (nada de CapCut).
- [ ] Capturas reales de la app (móvil y, si aplica, tablet).
- [ ] Indicar en la descripción que los subtítulos necesitan internet la primera vez.
- [ ] Resolver los pendientes de la sección 0 (sobre todo **guardar el video** en la app nativa).
- [ ] Música, fuentes, plantillas y efectos incluidos con licencia que permita redistribuirlos.

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
- [ ] **Permisos**: solo `INTERNET`. No declarar permisos de fotos/videos (se usa el selector del
      sistema), así que no hay que rellenar la declaración de permisos de fotos y videos.
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
- [ ] **Manifiesto de privacidad** (`PrivacyInfo.xcprivacy`) añadido al target (ver sección 3).
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
| `vercel.json`, `netlify.toml` | Hosting y cabeceras |
