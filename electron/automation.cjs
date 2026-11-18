// Local automation. This is a private authenticated bridge, not a public MCP endpoint.
// The MCP process handles the protocol; edits always execute in the real renderer/store.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');

const MAX_BODY = 1024 * 1024;
const MAX_MEDIA = 128 * 1024 * 1024;
const MAX_LOCAL_MEDIA = 8 * 1024 * 1024 * 1024;
const MEDIA_CHUNK = 8 * 1024 * 1024;
const MEDIA_EXT = /\.(mp4|mov|webm|mkv|m4v|3gp|jpg|jpeg|png|webp|gif|avif|bmp|mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;

async function statMedia(filePath, editorInput = false) {
  const media = typeof filePath === 'string' && MEDIA_EXT.test(filePath);
  if ((!media && !(editorInput && /\.(srt|vtt|cube|json)$/i.test(filePath))) || !path.isAbsolute(filePath)) throw new Error('Usa una ruta absoluta a un medio o archivo de edición compatible.');
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size > (media ? MAX_LOCAL_MEDIA : MAX_MEDIA)) throw new Error(media ? 'El medio supera 8 GiB.' : 'El archivo de edición supera 128 MiB.');
  return { name: path.basename(filePath), size: stat.size, mtimeMs: stat.mtimeMs };
}

async function readMediaChunk(filePath, expected, offset, length, editorInput = false) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > MEDIA_CHUNK) throw new Error('Intervalo de lectura inválido.');
  const info = await statMedia(filePath, editorInput);
  if (info.size !== expected?.size || info.mtimeMs !== expected?.mtimeMs) throw new Error('El archivo cambió durante la importación. Vuelve a importar.');
  if (offset >= info.size || length > info.size - offset) throw new Error('Intervalo fuera del archivo.');
  const file = await fs.promises.open(filePath, 'r');
  try {
    const stat = await file.stat();
    if (stat.size !== info.size || stat.mtimeMs !== info.mtimeMs) throw new Error('El archivo cambió durante la importación.');
    const bytes = new Uint8Array(length);
    let done = 0;
    while (done < length) {
      const read = await file.read(bytes, done, length - done, offset + done);
      if (!read.bytesRead) throw new Error('El archivo quedó incompleto durante la importación.');
      done += read.bytesRead;
    }
    return bytes.buffer;
  } finally { await file.close(); }
}

async function readMedia(filePath, editorInput = false) {
  const accepted = typeof filePath === 'string' && (MEDIA_EXT.test(filePath) || (editorInput && /\.(srt|vtt|cube|json)$/i.test(filePath)));
  if (!accepted || !path.isAbsolute(filePath)) throw new Error('Usa una ruta absoluta a un medio o archivo de edición compatible.');
  const file = await fs.promises.open(filePath, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_MEDIA) throw new Error('El archivo debe ser un medio de hasta 128 MiB.');
    // A bounded read also handles files growing between stat and read.
    const chunks = [];
    let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > MAX_MEDIA) throw new Error('El archivo supera 128 MiB.');
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return { name: path.basename(filePath), bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  } finally { await file.close(); }
}

async function startBridge({ discoveryFile, dispatch, timeout = 120000 }) {
  const token = randomBytes(32).toString('hex');
  let active = false;
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    const auth = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (req.headers.origin || req.headers.host !== `127.0.0.1:${server.address().port}` || auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      req.resume();
      return reply(403, { error: 'Conexión no autorizada.' });
    }
    if (req.method !== 'POST' || req.url !== '/command') { req.resume(); return reply(404, { error: 'Ruta inexistente.' }); }
    let size = 0;
    const chunks = [];
    const controller = new AbortController();
    let timer;
    let acquired = false;
    const onClose = () => controller.abort();
    res.on('close', onClose);
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) { reply(413, { error: 'Comando demasiado grande (máximo 1 MiB).' }); return; }
        chunks.push(chunk);
      }
      let command;
      try { command = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(400, { error: 'JSON inválido.' }); }
      if (!command || typeof command.tool !== 'string' || !command.args || typeof command.args !== 'object' || Array.isArray(command.args)) return reply(400, { error: 'Comando inválido.' });
      if (active) return reply(409, { error: 'Clipo está procesando otro comando. Vuelve a leer el estado al terminar.' });
      active = acquired = true;
      const commandTimeout = command.tool === 'clipo_import_media' && command.args.normalize === true ? 600000 : timeout;
      const deadline = Date.now() + commandTimeout;
      const expired = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Tiempo agotado. Consulta el proyecto antes de repetir una edición.')); }, commandTimeout);
      });
      const result = await Promise.race([dispatch({ ...command, requestId: randomUUID(), deadline }, controller.signal), expired]);
      reply(200, { result });
    } catch (e) { reply(400, { error: e instanceof Error ? e.message : 'No se pudo ejecutar el comando.', errorDetails: e?.errorDetails }); }
    finally {
      clearTimeout(timer);
      res.removeListener('close', onClose);
      if (acquired) active = false;
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const info = { version: 1, port: server.address().port, token, pid: process.pid };
  try {
    await fs.promises.mkdir(path.dirname(discoveryFile), { recursive: true });
    await fs.promises.writeFile(discoveryFile, JSON.stringify(info), { mode: 0o600 });
    await fs.promises.chmod(discoveryFile, 0o600);
  } catch (e) { server.close(); throw e; }
  return {
    port: info.port,
    close() {
      server.closeAllConnections();
      server.close();
      try {
        if (JSON.parse(fs.readFileSync(discoveryFile, 'utf8')).token === token) fs.unlinkSync(discoveryFile);
      } catch {}
    },
  };
}

function register({ app, ipcMain, getWindow, isAppUrl, canClose = () => true }) {
  if (!enabled()) return { cleanup() {} };
  const discoveryFile = process.env.CLIPO_BRIDGE_FILE || path.join(app.getPath('userData'), 'automation.json');
  let bridge;
  let starting;
  let disposed = false;
  let readyContents;
  let idleTimer;
  const backgroundJobs = new Set();
  const awake = () => {
    clearTimeout(idleTimer);
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.setBackgroundThrottling(false);
  };
  const settle = (result) => {
    // Offline audio rendering, decoding and the recorder fallback must keep
    // progressing while the agent's chat is in front of the editor.
    if (!result) return;
    for (const job of [result.job, ...(result.jobs || [])]) if (job?.id) {
      if (['queued', 'running', 'saving'].includes(job.status)) backgroundJobs.add(job.id);
      else backgroundJobs.delete(job.id);
    }
    if (backgroundJobs.size || result.exporting || result.captioning || result.proxyJob) return;
    idleTimer = setTimeout(() => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.setBackgroundThrottling(true);
    }, 1500);
  };
  const pending = new Map();
  const trusted = (event) => {
    const win = getWindow();
    if (!win || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame || !isAppUrl(event.senderFrame.url)) throw new Error('Página no autorizada.');
  };
  const dispatch = (command, signal) => new Promise((resolve, reject) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || readyContents !== win.webContents || win.webContents.isLoadingMainFrame()) return reject(new Error('El editor todavía no está listo.'));
    awake();
    const done = (error, result, errorDetails) => {
      for (const dir of pending.get(command.requestId)?.temporaryDirs || []) void fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
      pending.delete(command.requestId);
      signal.removeEventListener('abort', cancel);
      if (!error) settle(result);
      error ? reject(Object.assign(new Error(error), { errorDetails })) : resolve(result);
    };
    const cancel = () => {
      if (!win.isDestroyed()) win.webContents.send('agent:cancel', command.requestId);
      done('Comando cancelado. Consulta el proyecto antes de reintentar.');
    };
    pending.set(command.requestId, { done, command, sender: win.webContents, signal, mediaPaths: new Set(), temporaryDirs: [] });
    signal.addEventListener('abort', cancel, { once: true });
    win.webContents.send('agent:request', command);
  });
  ipcMain.handle('agent:ready', async (event) => {
    trusted(event);
    readyContents = event.sender;
    if (!starting) starting = startBridge({ discoveryFile, dispatch }).then((b) => {
      if (disposed) b.close();
      else bridge = b;
    }).catch((e) => { starting = null; throw e; });
    await starting;
  });
  ipcMain.on('agent:response', (event, response) => {
    trusted(event);
    const p = pending.get(response?.requestId);
    if (p?.sender !== event.sender) return;
    if (!response.error && p.command.tool === 'clipo_preview') {
      const win = getWindow();
      win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).then(
        (image) => p.done(null, { ...response.result, image: { mimeType: 'image/png', data: image.toPNG().toString('base64') } }),
        (e) => p.done(e.message),
      );
    } else p.done(response.error, response.result, response.errorDetails);
  });
  ipcMain.handle('agent:readMedia', async (event, requestId, filePath) => {
    trusted(event);
    const p = pending.get(requestId);
    if (!p || p.sender !== event.sender || !['clipo_import_media', 'clipo_import_capcut', 'clipo_set_input_files'].includes(p.command.tool) || !(p.command.args.paths?.includes(filePath) || p.mediaPaths.has(filePath))) throw new Error('Archivo no autorizado para este comando.');
    return readMedia(filePath, p.command.tool !== 'clipo_import_media');
  });
  for (const channel of ['agent:statMedia', 'agent:readMediaChunk']) ipcMain.handle(channel, async (event, requestId, filePath, expected, offset, length) => {
    trusted(event);
    const p = pending.get(requestId);
    if (!p || p.sender !== event.sender || !['clipo_import_media', 'clipo_import_capcut', 'clipo_set_input_files'].includes(p.command.tool) || !(p.command.args.paths?.includes(filePath) || p.mediaPaths.has(filePath))) throw new Error('Archivo no autorizado para este comando.');
    const editorInput = p.command.tool !== 'clipo_import_media';
    return channel === 'agent:statMedia' ? statMedia(filePath, editorInput) : readMediaChunk(filePath, expected, offset, length, editorInput);
  });
  ipcMain.handle('agent:compatibleMedia', async (event, requestId, filePath, range) => {
    trusted(event);
    const p = pending.get(requestId);
    if (!p || p.sender !== event.sender || p.command.tool !== 'clipo_import_media' || p.command.args.normalize !== true || !p.command.args.paths?.includes(filePath)) throw new Error('Conversión no autorizada para este comando.');
    if (range && !p.command.args.paths.some((name, i) => name === filePath && p.command.args.ranges?.[i]?.from === range.from && p.command.args.ranges?.[i]?.to === range.to)) throw new Error('Intervalo no autorizado para este comando.');
    await statMedia(filePath);
    const result = await require('./compatible-media.cjs').compatibleMedia(filePath, app.getPath('temp'), p.signal, range);
    if (!pending.has(requestId)) { await fs.promises.rm(result.directory, { recursive: true, force: true }); throw new Error('Comando cancelado.'); }
    p.temporaryDirs.push(result.directory); p.mediaPaths.add(result.path);
    return { path: result.path, receipt: result.receipt };
  });
  ipcMain.handle('agent:closeEditor', (event, requestId) => {
    trusted(event);
    const p = pending.get(requestId);
    if (!p || p.command.tool !== 'clipo_close_editor' || p.sender !== event.sender) throw new Error('Cierre no autorizado para este comando.');
    if (!canClose()) throw new Error('Hay una subida activa. Espera o cancélala antes de cerrar.');
    // Normal shutdown flushes Chromium preferences/localStorage; SIGTERM on
    // Windows bypasses that and can lose a newly enrolled voice or template.
    setTimeout(() => app.quit(), 250);
  });
  return { cleanup() {
    disposed = true;
    clearTimeout(idleTimer);
    bridge?.close();
    for (const p of pending.values()) p.done('Clipo se cerró.');
    ipcMain.removeHandler('agent:ready');
    ipcMain.removeHandler('agent:readMedia');
    ipcMain.removeHandler('agent:statMedia');
    ipcMain.removeHandler('agent:readMediaChunk');
    ipcMain.removeHandler('agent:compatibleMedia');
    ipcMain.removeHandler('agent:closeEditor');
    ipcMain.removeAllListeners('agent:response');
  } };
}

function enabled(env = process.env, argv = process.argv) { return env.CLIPO_AUTOMATION !== '0' && !argv.includes('--disable-clipo-agent'); }
module.exports = { register, startBridge, readMedia, statMedia, readMediaChunk, MAX_MEDIA, MAX_LOCAL_MEDIA, MEDIA_CHUNK, enabled };
