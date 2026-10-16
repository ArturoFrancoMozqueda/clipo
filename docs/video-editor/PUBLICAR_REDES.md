# Publicar en redes desde Clipo

Estado al 15 de octubre de 2026 (Clipo 0.5.x). Las reglas de cada red
cambian seguido: revisa los enlaces oficiales antes de depender de una cifra.

## 1. Qué hace Clipo hoy

| Red | Estado en Clipo | Dónde funciona |
| --- | --- | --- |
| YouTube y YouTube Shorts | **Funciona** (adaptador real) | Solo app de escritorio |
| Facebook (páginas) | **Funciona** con tu app de Meta (sección 2b) | Solo app de escritorio |
| Instagram Reels (cuentas profesionales) | **Funciona** con tu app de Meta (sección 2b); programar solo con Clipo abierto | Solo app de escritorio |
| TikTok | Requiere configuración | — |
| X | Requiere configuración | — |
| LinkedIn | Requiere configuración | — |

- En el navegador (PWA) y en el celular, publicar directo **no** está disponible:
  el panel lo explica y deja "Compartir" y "Descargar".
- Las redes sin adaptador se muestran como tarjetas "Requiere configuración"
  con lo que falta. No se pueden marcar y no hay botones que finjan publicar.
  Se ocultan con `localStorage.setItem('clipo.publish.upcoming', '0')`.
- Nada se sube sin que la persona pulse "Publicar" y después "Sí, publicar".

### Cómo está armado

```
src/publish/types.ts      Publisher (interfaz), cuentas, trabajos y estados
src/publish/queue.ts      cola: estados puros + ejecutor (una subida a la vez)
src/publish/text.ts       hashtags, texto por red, reglas de YouTube/Shorts
src/publish/networks.ts   qué red está lista y qué le falta a cada una
src/publish/youtube.ts    Publisher de YouTube (habla con la app de escritorio)
src/publish/meta.ts       Publisher de Facebook (páginas) e Instagram Reels
src/publish/store.ts      estado de la UI, programador local, guardado
src/publish/storage.ts    IndexedDB "clipo-publish" (cola y videos pendientes)
src/components/PublishPanel.tsx   panel "Publicar en redes"
electron/preload.cjs      puente seguro página ↔ proceso main
electron/publish/*.cjs    OAuth (PKCE + loopback), subida reanudable, tokens cifrados
                          (youtube.cjs, meta.cjs, files.cjs: el video pasa en partes por un archivo temporal)
```

`Publisher` es la pieza enchufable: un intermediario de pago o un servidor
propio se agregan implementando la misma interfaz (`connect`, `disconnect`,
`upload` con progreso, `status`, `check`) sin tocar la cola ni el panel.

Estados de cada publicación: `scheduled` (programada), `pending` (en espera),
`uploading` (con %), `published` (con enlace), `error` (con motivo y si se puede
reintentar), `missed` (Clipo estaba cerrado; la persona decide) y `cancelled`.
Al abrir Clipo **nunca** se reanuda nada solo: lo cortado queda como error
reintentable y lo que no llegó a salir queda como "No se publicó".

### Programar

- **La red lo publica a la hora** (recomendado): Clipo sube el video ahora como
  privado con `status.publishAt` (YouTube) o sin publicar con
  `scheduled_publish_time` (Facebook); la red lo publica a esa hora aunque
  Clipo esté cerrado.
- **Instagram no tiene programación por API**: aunque elijas lo anterior, el
  Reel queda en la cola local de Clipo para esa hora (el panel lo avisa: "Clipo
  debe estar abierto a esa hora").
- **Clipo lo sube a la hora**: solo si Clipo está abierto, con la computadora
  encendida y con internet. Si no, queda como "No se publicó". Programar con la
  app cerrada en redes sin programación nativa exige un servidor.

## 2. Registrar Clipo en Google Cloud (YouTube)

Clipo necesita un "ID de cliente" de Google que identifique a la app. **Se crea una sola vez** y
queda integrado en los instaladores: después, en la app basta con tocar **Conectar con Google**.

1. Entra a <https://console.cloud.google.com/> y crea un proyecto (por ejemplo "Clipo").
2. **APIs y servicios → Biblioteca**: busca y activa **YouTube Data API v3**.
3. **Google Auth Platform → Branding**: nombre de la app ("Clipo"), correo de soporte y de contacto.
   **Audiencia**: tipo **Externo**.
4. **Acceso a datos**: agrega los permisos
   - `https://www.googleapis.com/auth/youtube.upload` (subir videos y portadas)
   - `https://www.googleapis.com/auth/youtube.readonly` (leer el nombre del canal y el estado del video)
5. **Clientes → Crear cliente** → tipo **App de escritorio**, nombre "Clipo". Copia el **ID de
   cliente** (termina en `.apps.googleusercontent.com`) y el **secreto**.
6. **Audiencia → Publicar app** (pasar a "En producción"). Si se queda "En prueba", Google corta
   la conexión cada 7 días. En producción y sin verificar, al conectar Google muestra
   *"Google no verificó esta app"*: como la app es tuya, entra en **Configuración avanzada → Ir a
   Clipo**. Es normal en apps personales (la verificación solo hace falta a partir de 100 usuarios).
7. Guarda el ID y el secreto como secretos del repositorio. Desde la carpeta del proyecto, cada
   comando te pide pegar el valor:

   ```bash
   gh secret set GOOGLE_CLIENT_ID
   gh secret set GOOGLE_CLIENT_SECRET
   ```

   El workflow los escribe en `electron/publish/google-client.json` (no se sube al repositorio)
   al empaquetar Windows y Mac. Para probar en local con `npm run app:dev`, exporta
   `CLIPO_GOOGLE_CLIENT_ID` y `CLIPO_GOOGLE_CLIENT_SECRET`.

Si alguien prefiere su propio proyecto de Google (por ejemplo, para tener su propia cuota), en
**Publicar → Cuentas → Usar mi propio proyecto de Google (avanzado)** pega su ID y secreto. Con
**Volver a la conexión de Clipo** se vuelve al cliente integrado. Al cambiar de cliente, los
canales conectados se desconectan (sus tokens pertenecen al cliente anterior).

Sobre el "secreto": para apps de escritorio Google lo entrega, pero dice que no
puede considerarse secreto (va dentro de la app instalada). Por eso puede ir en los instaladores
públicos: solo identifica a la app, y el acceso a cada canal sigue protegido por los tokens
cifrados de cada equipo. La documentación
lo marca como opcional en el intercambio de código; en la práctica los clientes
de tipo "App de escritorio" lo siguen pidiendo, así que Clipo lo envía si está
guardado. Se guarda cifrado con `safeStorage` igual que los tokens.

### Cómo conecta Clipo (técnico)

- OAuth 2.0 para apps instaladas (<https://developers.google.com/identity/protocols/oauth2/native-app>):
  PKCE con `S256`, `state` aleatorio y redirección **loopback** a
  `http://127.0.0.1:<puerto libre>` que el proceso main abre solo durante el inicio
  de sesión (máx. 5 minutos). El navegador es el del sistema, nunca una ventana de Clipo.
- `access_type=offline` + `prompt=consent` para obtener un refresh token.
- Si en la pantalla de Google se desmarca el permiso de subir videos, Clipo lo
  detecta (`scope` devuelto) y no conecta.
- Tokens y secreto: cifrados con Electron `safeStorage` en
  `<userData>/publish/youtube.json`. Si el sistema no ofrece cifrado, Clipo no
  conecta cuentas. La página nunca ve los tokens: solo el proceso main.
- Desconectar revoca el token en Google (`oauth2.googleapis.com/revoke`) y lo borra del equipo.
- Cambiar el ID de cliente borra los canales conectados (sus tokens son de otro cliente).

### Subida

- `videos.insert` con el protocolo **reanudable**
  (<https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol>):
  sesión con `X-Upload-Content-Length`/`X-Upload-Content-Type`, partes de 8 MiB
  (múltiplo de 256 KiB), `308` + `Range` para continuar, consulta
  `Content-Range: bytes */total` tras una caída, reintentos con espera creciente
  solo en 500/502/503/504, sesión vencida (404) → empieza de nuevo.
  "Reintentar" en el historial sigue desde donde quedó mientras Clipo siga abierto.
- Portada opcional con `thumbnails.set` (JPG/PNG). Si YouTube no la acepta
  (canal sin verificar), el video igual queda publicado y se avisa.
- Estado posterior con `videos.list?part=status,processingDetails`.
- Cerrar Clipo mientras sube pide confirmación.

### Shorts

YouTube no tiene un campo "es Short": lo decide por forma y duración. Clipo
exige video **vertical o cuadrado** y **hasta 3 minutos** para el destino
"YouTube Shorts" y agrega `#Shorts` a la descripción. El mismo canal sirve
para YouTube y Shorts.

### Límites y revisión de Google (verificado en la documentación, oct. 2026)

- **Cupo**: desde junio de 2026 `videos.insert` tiene su propio cupo: **100
  subidas por día por proyecto** (además de 10 000 unidades diarias para el resto
  de la API). `thumbnails.set` cuesta unas 50 unidades. Se puede pedir más cupo.
- **Privacidad**: la referencia de `videos.insert` dice hoy que los videos de
  proyectos sin verificar **no** quedan forzados a privado (antes sí, desde 2020).
  Algunas cuentas igual pueden quedar privadas por su propia configuración.
- **Modo de prueba**: con la app "En prueba", solo los usuarios de prueba pueden
  conectar, Google muestra el aviso "Google no verificó esta app" y **el refresh
  token vence a los 7 días**: hay que desconectar y conectar otra vez. Clipo lo
  explica cuando pasa.
- **Publicar la app** para cualquier persona: pasar a "En producción" y la
  **verificación de Google** por usar permisos sensibles (política de privacidad,
  dominio verificado, video mostrando el uso). Para uso personal no hace falta.
- YouTube puede pedir una **auditoría de cumplimiento** de la API para ampliar cupo.

## 2b. Registrar Clipo en Meta (Facebook e Instagram)

Clipo publica en **páginas de Facebook** y en **Reels de cuentas profesionales de Instagram** con
la Graph API oficial de Meta (**v26.0**, publicada el 29 de julio de 2026; Clipo usa una sola
constante, `GRAPH_VERSION` en `electron/publish/meta.cjs`). Para eso hace falta **una app de Meta
propia**, que se crea una sola vez y se queda en **modo de desarrollo**: como tú eres su
administrador, puedes usar todos los permisos sin la revisión de Meta ni verificar un negocio
(Meta da "acceso estándar" automático a quien tiene un rol en la app).

### Lo que tiene que tener tu cuenta (antes de empezar)

1. **Una página de Facebook** en la que puedas crear contenido (tener "acceso a Facebook" con
   control total o con la tarea *Contenido*). Los **perfiles personales no se pueden usar** por API.
2. **Instagram profesional** (para Reels): en la app de Instagram, **Perfil → ☰ → Configuración →
   Tipo de cuenta y herramientas → Cambiar a cuenta profesional** → *Creador* o *Empresa*. Las
   cuentas personales no se pueden usar por API.
3. **Vincular Instagram con la página**: en Facebook, entra a la página → **Configuración →
   Cuentas vinculadas → Instagram → Conectar cuenta** (o desde Instagram: **Editar perfil → Página →
   Conectar**, o en Meta Business Suite → Configuración → Cuentas de Instagram). Sin esa vinculación,
   Clipo no encuentra la cuenta de Instagram.

### Crear la app (una sola vez)

1. Entra a <https://developers.facebook.com/> con tu Facebook y pulsa **Empezar / Get started**
   para registrarte como desarrollador (pide confirmar tu correo o tu teléfono).
2. **Mis apps → Crear app** (<https://developers.facebook.com/apps/creation/>). Nombre: "Clipo";
   correo de contacto: el tuyo. **Siguiente**.
3. **Casos de uso**: marca **"Administrar todo en tu página"** (*Manage everything on your Page*)
   y **"Administrar mensajes y contenido en Instagram"** (*Manage messaging & content on
   Instagram*), en su variante **con inicio de sesión con Facebook** (*API setup with Facebook
   login*). Si la pantalla no deja combinarlos, elige **Otro** → tipo de app **Negocios**
   (*Business*) y agrega los productos a mano en el paso 5. Meta suma solo el producto
   **Inicio de sesión con Facebook para empresas** (*Facebook Login for Business*).
4. **Negocio**: puedes elegir **"No quiero conectar un portfolio comercial todavía"** (los datos son
   tuyos). Si tus páginas están en un portfolio comercial, conéctalo. **Siguiente** hasta
   **Ir al panel**.
5. **Permisos**: en el panel, en cada caso de uso → **Personalizar** (o **Revisión de la app →
   Permisos y funciones**), agrega:
   - `pages_show_list` — ver tus páginas
   - `pages_read_engagement` — leer datos básicos de la página
   - `pages_manage_posts` — publicar videos en la página
   - `business_management` — solo si las páginas están en un portfolio comercial
   - `instagram_basic` — ver la cuenta de Instagram vinculada
   - `instagram_content_publish` — publicar Reels

   No hace falta pedir "acceso avanzado" ni enviar nada a revisión.
6. **Inicio de sesión con Facebook para empresas → Configuración** (*Settings*): deja activados
   **Inicio de sesión con OAuth del cliente** y **Inicio de sesión con OAuth web**, y **Forzar
   HTTPS** y el **modo estricto** como vienen. Mientras la app esté en desarrollo, Meta acepta
   las direcciones `http://localhost` sin registrarlas. Si al conectar ves *"URL bloqueada"*,
   agrega exactamente `http://localhost:47615/` en **URI de redireccionamiento de OAuth válidos**
   y guarda (Clipo usa ese puerto siempre que esté libre).
7. *(Opcional, solo si Meta lo pide)* **Inicio de sesión con Facebook para empresas →
   Configuraciones → Crear configuración**: tipo de token **Token de acceso de usuario**, los
   permisos del paso 5 y tus páginas y cuenta de Instagram. Copia el **ID de configuración**.
   Hace falta si al conectar Meta muestra *"Invalid Scopes"* o dice que el inicio de sesión no
   está disponible para la app.
8. **Configuración de la app → Básica**: copia el **Identificador de la app** (*App ID*, solo
   números) y la **Clave secreta de la app** (*App Secret*, botón **Mostrar**; pide tu contraseña).
9. **Modo de la app**: déjalo en **Desarrollo** (*Development*). No lo pases a "Activo": entonces sí
   haría falta la revisión de Meta y una política de privacidad.

### En Clipo

**Publicar → Cuentas → Facebook e Instagram → Configuración de Meta**: pega el **App ID**, la
**clave secreta** y, si lo creaste, el **ID de configuración**. **Guardar** y **Conectar con
Facebook**.

- La **clave secreta no va dentro de los instaladores** de Clipo: con ella cualquiera podría actuar
  como tu app. Se pega una vez en tu computadora y queda cifrada con `safeStorage`.
- El **App ID sí es público** (va en cada inicio de sesión). Si lo guardas como secreto del
  repositorio, los instaladores lo traen y en Cuentas solo pegas la clave secreta:

  ```bash
  gh secret set META_APP_ID
  ```

  El workflow lo escribe en `electron/publish/meta-client.json` (no se sube al repositorio). Para
  probar en local: `CLIPO_META_APP_ID=... npm run app:dev`.

### Qué pasa al conectar

1. Se abre tu navegador en Facebook: *"Clipo solicita acceso…"*. Puede avisar que la app no está
   revisada o está en desarrollo: es normal, la app es tuya.
2. Pulsa **Editar acceso / Elegir lo que permites** y marca **tus páginas y su cuenta de
   Instagram**. Deja marcados todos los permisos.
3. Ves "Listo, ya puedes cerrar esta pestaña" y vuelves a Clipo, que muestra cada página
   ("Página de Facebook") y cada Instagram ("@cuenta · vinculada a la página…").
4. Para agregar otra página después, **Conectar de nuevo** reemplaza lo de esa cuenta de Facebook.

### Límites (verificados en la documentación, oct. 2026)

- **Instagram no tiene programación por API**: si programas un Reel, lo programa Clipo y **Clipo
  debe estar abierto a esa hora** (con internet). Si no, queda como "No se publicó". Facebook sí
  programa solo (entre 10 minutos y 6 meses), con Clipo cerrado.
- **Instagram: 100 publicaciones por API cada 24 h** por cuenta. Clipo consulta
  `content_publishing_limit` antes de subir y avisa si llegaste al tope.
- **Reels por API**: MP4 o MOV (H.264/HEVC + AAC), **3 s a 15 min**, **hasta 300 MB**, hasta
  1920 px de ancho, 23–60 fps; texto de hasta 2200 caracteres, 30 hashtags y 20 menciones.
  La portada propia exige una URL pública, así que Instagram usa un cuadro del video.
- **Facebook**: hasta 10 GB y 4 h (lo que Clipo ya controla en `src/platforms.ts`). Facebook no
  tiene "no listado" ni "privado": con esas opciones el video se sube **sin publicar** y queda en
  la biblioteca de videos de la página.
- Los tokens de página **no vencen**, pero Meta los invalida si cambias la contraseña de Facebook,
  dejas de administrar la página o quitas la app en *Configuración → Apps y sitios web*. Entonces
  Clipo dice "La conexión con Facebook venció o se revocó": pulsa **Conectar con Facebook** otra vez.

### Cómo conecta y publica Clipo (técnico)

- **Inicio de sesión** ("manual flow",
  <https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow>): el navegador
  del sistema abre `https://www.facebook.com/v26.0/dialog/oauth` con `client_id`, `state` aleatorio,
  `response_type=code` y `redirect_uri=http://localhost:<puerto>/` (puerto 47615 si está libre;
  Clipo escucha en 127.0.0.1 y ::1 solo durante el inicio de sesión, máx. 5 minutos). Sin
  configuración pide `scope=` (los permisos de arriba) con `extras={"setup":{"channel":"IG_API_ONBOARDING"}}`,
  el diálogo de Meta para elegir Instagram; con ID de configuración usa `config_id`
  (<https://developers.facebook.com/docs/facebook-login/facebook-login-for-business>).
- **Tokens** (<https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived>):
  `GET /oauth/access_token` cambia el código por un token de usuario (necesita la clave secreta; Meta
  ofrece PKCE sin secreto solo en su flujo OIDC "en pruebas", que no sirve para el token largo), luego
  `grant_type=fb_exchange_token` da el token de **60 días**, y `GET /me/accounts` da los **tokens de
  página, que no vencen**, junto con `instagram_business_account`. Clipo verifica en
  `/me/permissions` qué permisos diste. Todo se guarda cifrado en `<userData>/publish/meta.json`;
  la página nunca ve tokens ni la clave secreta.
- **appsecret_proof** en cada llamada (HMAC-SHA256 con la clave secreta, en su forma con
  `appsecret_time` como muestra la documentación; si Graph no la acepta, Clipo usa la forma clásica)
  (<https://developers.facebook.com/docs/facebook-login/security>).
- **Facebook** (<https://developers.facebook.com/docs/graph-api/reference/page/videos/>):
  `POST graph-video.facebook.com/v26.0/{page-id}/videos` en partes con el token de página:
  `upload_phase=start` (`file_size`) → `transfer` (cada parte que Facebook pide con
  `start_offset`/`end_offset`, reintentos con espera creciente) → `finish` con `title`,
  `description` y, para programar, `published=false` + `scheduled_publish_time`. Portada opcional con
  `POST /{video-id}/thumbnails`; enlace con `permalink_url`. Se eligió este método (y no Reels de
  página) porque sirve para cualquier formato (4:5, 1:1, 16:9, 9:16), cualquier duración y la
  programación nativa, solo con el token de página que no vence; la API nueva
  (`/{app-id}/uploads`) exige el token de usuario de 60 días.
- **Instagram** (<https://developers.facebook.com/docs/instagram-platform/content-publishing>):
  `POST /{ig-user-id}/media` con `media_type=REELS`, `upload_type=resumable`, `caption` y
  `share_to_feed=true` → `id` + `uri`; el video va a `rupload.facebook.com/ig-api-upload/v26.0/{id}`
  con `Authorization: OAuth <token>`, `offset: 0` y `file_size` (no hace falta una URL pública);
  Clipo consulta `status_code` hasta `FINISHED` (`ERROR`/`EXPIRED` se explican) y publica con
  `POST /{ig-user-id}/media_publish`. El enlace sale de `permalink`. "Reintentar" después de que
  Instagram ya recibió el video solo vuelve a publicar.
- **Errores**: `electron/publish/meta-errors.cjs` traduce los códigos de Graph (190 sesión vencida,
  10/200 permisos, 4/17/32/613 y 80001+ límites, 368 bloqueo por spam, subcódigos 2207xxx de
  Instagram) a mensajes en español y dice si sirve reintentar.
- **Desconectar** borra la cuenta del equipo; al desconectar la última de ese Facebook, Clipo
  revoca el permiso con `DELETE /{user-id}/permissions`.
- Probado contra un Meta simulado en `tests/meta-desktop.test.ts` (sin cuenta real).

## 3. TikTok, X y LinkedIn (y en la web o el teléfono, todas): "Publicar con la app"

Para TikTok, X y LinkedIn Clipo no publica solo (abajo se explica por qué), y en la web y el
teléfono tampoco Facebook ni Instagram, pero lo deja a un toque. En
**Redes → Guardar una versión para cada formato**, cada versión lista tiene **"Publicar en …"**:

- **En el teléfono:** copia el texto de esa red y abre la hoja de compartir con el video. Eliges
  la app (TikTok, Instagram…), pegas el texto y publicas. Tu sesión ya está iniciada en la app.
- **En la computadora:** copia el texto, abre la página de subida de la red en tu navegador y
  guarda el video (en la app de escritorio, en `Descargas/Clipo`, con la carpeta abierta). Lo
  arrastras a la página, pegas el texto y publicas.

No usa claves de API ni pasa por la revisión de cada red, y respeta sus condiciones de uso: es lo
mismo que subirlo a mano, sin tener que buscar el archivo ni reescribir el texto.

## 3b. Por qué no se publica solo en esas redes (API)

TikTok, X y LinkedIn no tienen adaptador. Cada una necesita trabajo de registro y
revisión que no depende del código. (Facebook e Instagram sí lo tienen: sección 2b.
Funciona sin revisión porque la app de Meta es tuya y queda en modo de desarrollo; para que otras
personas la usen haría falta acceso avanzado, revisión de la app y verificar el negocio.)

### TikTok — Content Posting API
- App en TikTok for Developers con el permiso `video.publish` (Direct Post).
- **Auditoría** obligatoria: hasta aprobarla, todo lo publicado por API queda
  privado (`SELF_ONLY`) y las cuentas tienen que ser privadas.
- Hay que consultar `creator_info` y mostrar exactamente las opciones de
  privacidad que TikTok devuelve; límites diarios por usuario y por app.
- Docs: <https://developers.tiktok.com/doc/content-posting-api-get-started>

### X
- Desde febrero de 2026 no hay plan gratis para publicar: **pago por uso con
  créditos** (los planes fijos quedaron para casos grandes).
- Subida de video en partes (INIT/APPEND/FINALIZE) y luego crear el post.
- Docs: <https://docs.x.com/x-api/media/quickstart/media-upload-chunked>

### LinkedIn
- App con "Share on LinkedIn" (`w_member_social`) para publicar como persona.
- Para páginas de empresa: Community Management API (`w_organization_social`),
  que LinkedIn revisa. Videos API + Posts API con cabecera `LinkedIn-Version`.
- Docs: <https://learn.microsoft.com/linkedin/marketing/community-management/shares/videos-api>

## 4. Pendiente / siguientes pasos

- Decidir el camino para el resto de redes (intermediario de pago, servidor
  propio o API directas desde escritorio). La interfaz `Publisher` sirve para los tres.
- Integrar con la Fase A: `src/platforms.ts` (mismos ids de red) y
  `Project.publish.posts` para precargar texto y portada guardados con el proyecto.
- Probar una subida real con un ID de cliente propio (no se pudo sin credenciales;
  el flujo está probado contra un Google simulado en `tests/youtube-desktop.test.ts`).
- Probar Facebook e Instagram con la app de Meta real (sección 2b; probado contra un Meta
  simulado en `tests/meta-desktop.test.ts`). Puntos a confirmar en vivo: que Meta acepte
  `http://localhost:<puerto>/` sin registrarlo en modo de desarrollo, la forma de
  `appsecret_proof` con `appsecret_time` y si el token de página sirve para Instagram (si no,
  Clipo prueba con el token de usuario).
