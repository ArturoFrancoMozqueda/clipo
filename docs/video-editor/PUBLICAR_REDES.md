# Publicar en redes desde Clipo

Estado al 15 de octubre de 2026 (Clipo 0.4.x, Fase B). Las reglas de cada red
cambian seguido: revisa los enlaces oficiales antes de depender de una cifra.

## 1. Qué hace Clipo hoy

| Red | Estado en Clipo | Dónde funciona |
| --- | --- | --- |
| YouTube y YouTube Shorts | **Funciona** (adaptador real) | Solo app de escritorio |
| TikTok | Requiere configuración | — |
| Instagram Reels | Requiere configuración | — |
| Facebook | Requiere configuración | — |
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
src/publish/store.ts      estado de la UI, programador local, guardado
src/publish/storage.ts    IndexedDB "clipo-publish" (cola y videos pendientes)
src/components/PublishPanel.tsx   panel "Publicar en redes"
electron/preload.cjs      puente seguro página ↔ proceso main
electron/publish/*.cjs    OAuth (PKCE + loopback), subida reanudable, tokens cifrados
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

- **YouTube lo publica a la hora** (recomendado): Clipo sube el video ahora como
  privado con `status.publishAt`; YouTube lo hace público a esa hora aunque
  Clipo esté cerrado.
- **Clipo lo sube a la hora**: solo si Clipo está abierto, con la computadora
  encendida y con internet. Si no, queda como "No se publicó". Programar con la
  app cerrada en redes sin programación nativa exige un servidor.

## 2. Registrar Clipo en Google Cloud (YouTube)

Cada persona (o quien distribuya Clipo) usa **su propio** proyecto de Google.
Clipo no trae ningún secreto en el código.

1. Entra a <https://console.cloud.google.com/> y crea un proyecto (por ejemplo "Clipo").
2. **APIs y servicios → Biblioteca**: busca y activa **YouTube Data API v3**.
3. **Google Auth Platform → Branding / Audiencia** (antes "Pantalla de consentimiento OAuth"):
   - Tipo de usuario **Externo**.
   - Nombre de la app, correo de soporte y correo de contacto.
   - En **Audiencia**, mientras esté "En prueba", agrega como **usuarios de prueba**
     los correos de las cuentas de Google que van a conectar sus canales (hasta 100).
4. **Acceso a datos / Permisos**: agrega
   - `https://www.googleapis.com/auth/youtube.upload` (subir videos y portadas)
   - `https://www.googleapis.com/auth/youtube.readonly` (leer el nombre del canal y el estado del video)
5. **Clientes → Crear cliente** → tipo **App de escritorio**. Copia el
   **ID de cliente** (termina en `.apps.googleusercontent.com`) y el **secreto**.
6. En Clipo para computadora: **Guardar video → Publicar en redes → Cuentas →
   Configuración de Google**, pega ambos y pulsa **Guardar**. Luego
   **Conectar mi canal de YouTube**: se abre el navegador, eliges la cuenta,
   aceptas y vuelves a Clipo.

Sobre el "secreto": para apps de escritorio Google lo entrega, pero dice que no
puede considerarse secreto (está en el equipo de la persona). La documentación
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

## 3. Lo que falta en cada red (no implementado)

Ninguna de estas tiene adaptador. Cada una necesita trabajo de registro y
revisión que no depende del código.

### TikTok — Content Posting API
- App en TikTok for Developers con el permiso `video.publish` (Direct Post).
- **Auditoría** obligatoria: hasta aprobarla, todo lo publicado por API queda
  privado (`SELF_ONLY`) y las cuentas tienen que ser privadas.
- Hay que consultar `creator_info` y mostrar exactamente las opciones de
  privacidad que TikTok devuelve; límites diarios por usuario y por app.
- Docs: <https://developers.tiktok.com/doc/content-posting-api-get-started>

### Instagram Reels — Instagram Platform (Meta)
- Solo **cuentas profesionales** (Empresa o Creador).
- App de Meta con `instagram_business_content_publish` (inicio de sesión con
  Instagram) o `instagram_content_publish` + página de Facebook vinculada.
- Para cuentas que no son de los desarrolladores de la app: **Advanced Access**,
  que exige **revisión de la app** y **verificación del negocio** (semanas).
- El video tiene que estar en una **URL pública** cuando Meta lo descarga: sin
  servidor o intermediario no se puede desde una app local.
- Límite aproximado: 100 publicaciones por API cada 24 h por cuenta.
- Docs: <https://developers.facebook.com/docs/instagram-platform/content-publishing>

### Facebook — Video API / páginas
- Solo **páginas** (no perfiles personales), con permisos de páginas
  (`pages_manage_posts` y relacionados) y la revisión de Meta para uso general.
- Docs: <https://developers.facebook.com/docs/video-api/guides/publishing>

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
