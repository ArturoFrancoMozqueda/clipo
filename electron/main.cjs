// Clipo for the desktop: the same web app, served from the installed files through a private
// app:// scheme (a secure origin, so IndexedDB, workers, WebCodecs and the AI models all work),
// in its own window, with no browser around it.
const { app, BrowserWindow, Menu, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

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
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

/** Map app://clipo/<path> to a file inside dist/, never outside it. Unknown paths get the app shell. */
function serve(request) {
  const { pathname } = new URL(request.url);
  let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
  if (pathname.endsWith('/') || !fs.existsSync(file)) file = path.join(DIST, 'index.html');
  return net.fetch(pathToFileURL(file).toString());
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
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadURL(`${SCHEME}://${HOST}/index.html`);

  // Links to websites open in the user's browser, never inside the editor window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(`${SCHEME}://`)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });

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
            secure: window.isSecureContext, idb: !!window.indexedDB, webcodecs: typeof VideoEncoder === 'function',
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
  protocol.handle(SCHEME, serve);

  // Microphone for "Grabar voz"; everything else stays denied.
  const allowed = new Set(['media', 'fullscreen', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  Menu.setApplicationMenu(null);
  const win = createWindow();
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

app.on('window-all-closed', () => app.quit());
