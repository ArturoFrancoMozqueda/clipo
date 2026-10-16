// Clipo for the desktop: the same web app, served from the installed files through a private
// app:// scheme (a secure origin, so IndexedDB, workers, WebCodecs and the AI models all work),
// in its own window, with no browser around it.
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, safeStorage, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const youtube = require('./publish/youtube.cjs');
const { checkForUpdates } = require('./updates.cjs');

const SCHEME = 'app';
const HOST = 'clipo';
const DIST = path.join(__dirname, '..', 'dist');
const SMOKE = process.env.CLIPO_SMOKE === '1'; // used by `npm run app:smoke`

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

// Tests use their own throwaway storage, never the user's projects.
// CLIPO_SMOKE_DATA keeps a test profile between runs (so large AI models stay cached).
if (SMOKE) app.setPath('userData', process.env.CLIPO_SMOKE_DATA || fs.mkdtempSync(path.join(app.getPath('temp'), 'clipo-smoke-')));

// One window only: opening Clipo again focuses the running one.
const gotLock = SMOKE || app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let publishing = null;
let mainWindow = null;

const ORIGIN = `${SCHEME}://${HOST}`;
// (URL.origin is "null" for custom schemes, so compare scheme and host.)
const isAppUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === `${SCHEME}:` && u.host === HOST;
  } catch {
    return false;
  }
};
/** Only plain https:// links leave the app, and only to the user's browser. */
function openExternal(url) {
  try {
    if (new URL(url).protocol === 'https:') shell.openExternal(url);
  } catch {}
}

// Hosts the page itself talks to: the AI models (Hugging Face and its download CDNs) and the ONNX
// Runtime CDN that transformers.js falls back to. Uploads to YouTube go through the main process.
const MODEL_HOSTS = 'https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co';
// Channel avatars and video thumbnails shown in Publicar.
const IMAGE_HOSTS = 'https://yt3.ggpht.com https://*.ggpht.com https://i.ytimg.com https://*.googleusercontent.com';
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' blob:`,
  "worker-src 'self' blob:",
  `connect-src 'self' blob: data: ${MODEL_HOSTS}`,
  `img-src 'self' blob: data: ${IMAGE_HOSTS}`,
  "media-src 'self' blob: data:",
  "font-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Map app://clipo/<path> to a file inside dist/, never outside it. Unknown paths get the app shell. */
function serve(request) {
  const { pathname } = new URL(request.url);
  let file;
  try {
    file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const rel = path.relative(DIST, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return new Response('Not found', { status: 404 });
  if (pathname.endsWith('/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(DIST, 'index.html');
  return net.fetch(pathToFileURL(file).toString()).then((res) => {
    const headers = new Headers(res.headers);
    // Cross-origin isolation lets the AI models use every CPU core (WebAssembly threads).
    // "credentialless" keeps cross-origin downloads (models, CDNs) working without extra headers.
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // The policy goes on the page only: workers get their own (none), because the ONNX Runtime
    // glue they run builds functions at runtime (WebGPU), which a page CSP would block.
    if (file.endsWith('.html')) {
      headers.set('Content-Security-Policy', CSP);
      headers.set('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=(), payment=(), usb=(), serial=(), hid=()');
    }
    return new Response(res.body, { status: res.status, headers });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 560,
    title: 'Clipo',
    backgroundColor: '#0e0e12',
    icon: path.join(DIST, 'icon-512.png'),
    autoHideMenuBar: true,
    show: !SMOKE,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Publishing bridge (src/publish/desktop.ts): connect accounts and upload from the main process.
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.loadURL(`${ORIGIN}/index.html`);

  // Closing during an upload would cut it: ask first.
  win.on('close', (e) => {
    if (SMOKE || !publishing || !publishing.activeUploads()) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Seguir subiendo', 'Cerrar igual'],
      defaultId: 0,
      cancelId: 0,
      title: 'Clipo',
      message: 'Hay un video subiéndose a tus redes.',
      detail: 'Si cierras Clipo ahora, la subida se corta. Después podrás reintentarla desde Publicar.',
    });
    if (choice === 0) e.preventDefault();
  });

  // Links to websites open in the user's browser, never inside the editor window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    openExternal(url);
  });
  win.webContents.on('will-redirect', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  // No <webview> tags in Clipo: refuse any attempt to attach one.
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  if (SMOKE) {
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error') console.log('[renderer error]', e.message);
      else if (e.message.includes('[clipo-clone]')) console.log(new Date().toISOString().slice(11, 19), e.message);
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.log('LOAD FAILED', code, desc);
      app.exit(1);
    });
    win.webContents.on('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500));
      const probe = await win.webContents.executeJavaScript(
        `({ title: document.title, heading: document.querySelector('.hero h2')?.textContent ?? null,
            secure: window.isSecureContext, isolated: window.crossOriginIsolated, threads: navigator.hardwareConcurrency, idb: !!window.indexedDB, webcodecs: typeof VideoEncoder === 'function',
            fonts: document.fonts.size })`,
      );
      console.log('SMOKE', JSON.stringify(probe));
      // Optional end-to-end scenario (a script file that resolves to a result object).
      const scenario = process.env.CLIPO_SMOKE_SCRIPT;
      if (scenario && probe.heading) {
        try {
          const result = await win.webContents.executeJavaScript(fs.readFileSync(scenario, 'utf8'));
          console.log('SCENARIO', JSON.stringify(result));
          app.exit(result && result.ok ? 0 : 1);
        } catch (err) {
          console.log('SCENARIO FAILED', String(err));
          app.exit(1);
        }
        return;
      }
      app.exit(probe.heading ? 0 : 1);
    });
  }
  return win;
}

app.whenReady().then(() => {
  // A second copy that lost the single-instance lock is quitting: don't open another window.
  if (!gotLock) return;
  protocol.handle(SCHEME, serve);

  // Only Clipo's own page in its own window, and only these: the microphone for "Grabar voz" /
  // "Mi voz" (audio, never the camera), fullscreen and writing to the clipboard.
  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write']);
  const ours = (wc, origin) => !!wc && !!mainWindow && wc === mainWindow.webContents && isAppUrl(origin || '');
  // "Descargar" / "Publicar con la app": videos go straight to Downloads/Clipo (no save dialog)
  // and the folder opens with the file selected, ready to drag into TikTok, Instagram…
  let lastReveal = 0;
  session.defaultSession.on('will-download', (_e, item) => {
    const dir = path.join(app.getPath('downloads'), 'Clipo');
    fs.mkdirSync(dir, { recursive: true });
    const safe = path.basename(item.getFilename()).replace(/[\\/:*?"<>|]+/g, '').trim() || 'video.mp4';
    const ext = path.extname(safe);
    const base = safe.slice(0, safe.length - ext.length);
    let target = path.join(dir, safe);
    for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${base} (${n})${ext}`);
    item.setSavePath(target);
    item.once('done', (_ev, state) => {
      // "Descargar todas" saves several at once: show the folder once, not once per file.
      if (state !== 'completed' || Date.now() - lastReveal < 3000) return;
      lastReveal = Date.now();
      shell.showItemInFolder(target);
    });
  });

  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details = {}) => {
    const origin = details.securityOrigin || details.requestingUrl || wc?.getURL();
    if (!ours(wc, origin)) return cb(false);
    if (permission === 'media') {
      const types = details.mediaTypes || [];
      return cb(types.length > 0 && types.every((t) => t === 'audio'));
    }
    cb(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin, details = {}) => {
    if (!ours(wc, origin || details.requestingUrl || wc?.getURL())) return false;
    if (permission === 'media') return details.mediaType !== 'video';
    return allowed.has(permission);
  });

  publishing = youtube.register({ app, ipcMain, shell, safeStorage, BrowserWindow });

  Menu.setApplicationMenu(null);
  const win = createWindow();
  // Installed copies look for a newer release a few seconds after opening (never in tests or `npm run app:dev`).
  if (app.isPackaged && !SMOKE) setTimeout(() => void checkForUpdates({ app, net, dialog, shell, win }), 5000);
  app.on('second-instance', () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

app.on('window-all-closed', () => app.quit());
// Temp copies of videos sent for upload never outlive the app.
app.on('will-quit', () => publishing?.cleanup?.());
