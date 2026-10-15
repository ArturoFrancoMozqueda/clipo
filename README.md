# Clipo

Editor de video fácil para móvil y PC, pensado para personas sin experiencia en
edición. Funciona en el navegador, se instala como app (PWA) y procesa todo en
el dispositivo: sin cuenta, sin servidores y sin marca de agua.

El análisis de producto y las decisiones de diseño están en
[ANALISIS.md](ANALISIS.md).

## Usarlo en tu PC

Requiere Node.js 18 o superior.

```bash
npm install
npm run dev
```

Abre http://localhost:5173.

## Probarlo en tu teléfono

`npm run dev` también muestra una dirección "Network" (por ejemplo
`http://192.168.1.20:5173`). Ábrela en el teléfono, conectado al mismo wifi.

Para instalarla como app y usarla sin conexión, el navegador exige HTTPS:
publícala (ver abajo) y abre esa dirección en el teléfono.

## Publicar

```bash
npm run build
```

Sube la carpeta `dist/` a cualquier hosting estático con HTTPS (Vercel,
Netlify, Cloudflare Pages, GitHub Pages). La guía completa (web, Android, iOS
y políticas de las tiendas) está en [PUBLICAR.md](PUBLICAR.md).

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `src/engine.ts` | Reproducción (un reloj maestro que maneja videos/audios ocultos), dibujo en canvas y exportación con MediaRecorder |
| `src/store.ts` | Estado del editor con deshacer/rehacer |
| `src/ops.ts` | Acciones de edición: dividir, duplicar, mover, eliminar, texto |
| `src/media.ts` | Importar archivos, duración y miniaturas |
| `src/db.ts` | Guardado local en IndexedDB |
| `src/filters.ts`, `src/textStyles.ts` | Filtros y estilos de texto |
| `src/components/` | Interfaz: inicio, vista previa, línea de tiempo, barra de herramientas y paneles |

## Limitaciones conocidas

- La exportación tarda lo mismo que dura el video, y la pestaña debe quedar
  visible mientras se guarda.
- Chrome, Edge y Safari recientes guardan en MP4; otros navegadores guardan en
  WebM.
- Los archivos HEVC/.mov de iPhone solo se reproducen en navegadores que los
  admitan (Safari, y Chrome/Edge en equipos con soporte HEVC).
- El ícono es SVG; para que se vea perfecto en la pantalla de inicio del
  iPhone, agrega un PNG de 180×180 como `apple-touch-icon`.

## App de escritorio (Windows)

Clipo también funciona como programa de Windows, en su propia ventana y sin
navegador (Electron). Todo se guarda en tu PC.

```bash
npm run app:dev     # abrir la app de escritorio desde el código
npm run app:dist    # crear el instalador en release/
npm run app:smoke   # prueba automática: abre la app oculta y comprueba que carga
```

`npm run app:dist` crea dos archivos en `release/<versión>/` (se compila fuera de OneDrive para evitar bloqueos):

- `Clipo-Setup-<versión>.exe`: instalador con acceso directo en el escritorio y el menú Inicio.
- `Clipo-Portable-<versión>.exe`: se ejecuta sin instalar (por ejemplo, desde una USB).

Los proyectos de la app de escritorio se guardan en `%APPDATA%\clipo` y son
independientes de los de la versión web. El instalador no está firmado
digitalmente, así que Windows SmartScreen mostrará un aviso la primera vez:
"Más información" → "Ejecutar de todas formas". Para quitar el aviso hace falta
un certificado de firma de código.

Para una prueba completa (crear video, editar y exportar) dentro de la app:
`CLIPO_SMOKE_SCRIPT=scripts/smoke-scenario.js npm run app:smoke`.
