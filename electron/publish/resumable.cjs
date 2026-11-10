// Pure helpers for the YouTube resumable upload protocol
// (https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol).

/** Chunks must be a multiple of 256 KiB (except the last one). 8 MiB keeps progress smooth. */
const CHUNK_SIZE = 32 * 256 * 1024;

/** Inclusive byte range of the next chunk. */
function chunkRange(offset, total, size = CHUNK_SIZE) {
  if (size % (256 * 1024)) throw new Error('chunk size must be a multiple of 256 KiB');
  return { start: offset, end: Math.min(offset + size, total) - 1 };
}

/** From a 308 response's Range header ("bytes=0-999999") to the next byte to send. No header = 0. */
function nextOffset(range) {
  const m = /bytes=(\d+)-(\d+)/.exec(range || '');
  return m ? Number(m[2]) + 1 : 0;
}

/** Statuses the guide says to retry with exponential backoff. */
const isRetryableStatus = (status) => status === 500 || status === 502 || status === 503 || status === 504;

/** 1 s, 2 s, 4 s … up to 32 s, plus up to 1 s of jitter. */
function backoffMs(attempt, random = Math.random) {
  return Math.min(32_000, 1000 * 2 ** Math.max(0, attempt - 1)) + Math.floor(random() * 1000);
}

const SESSION = 'La conexión con tu canal de YouTube venció. Vuelve a conectarlo y pulsa “Reintentar”.';
const DAILY = 'YouTube ya no acepta más subidas desde Clipo por hoy. Pulsa “Reintentar” mañana, o súbelo ahora desde la página de YouTube.';
const WAIT = 'YouTube pide esperar un poco antes de seguir. Pulsa “Reintentar” en unos minutos.';
const NOT_ALLOWED = 'YouTube no permitió la subida con esta cuenta. Revisa en YouTube Studio que el canal esté activo y sin avisos.';

/** reason -> [message, retryable, reconnect?] */
const KNOWN = {
  quotaExceeded: [DAILY, true],
  dailyLimitExceeded: [DAILY, true],
  uploadLimitExceeded: ['Tu canal llegó al límite de videos que YouTube deja subir por día. Pulsa “Reintentar” mañana.', true],
  rateLimitExceeded: [WAIT, true],
  userRateLimitExceeded: [WAIT, true],
  invalidTitle: ['YouTube no aceptó el título. Revisa que no esté vacío ni pase de 100 letras y publícalo otra vez.', false],
  invalidDescription: ['YouTube no aceptó la descripción. Acórtala un poco y publícalo otra vez.', false],
  invalidTags: ['YouTube no aceptó los hashtags. Prueba con menos o más cortos y publícalo otra vez.', false],
  invalidPublishAt: ['YouTube no aceptó la hora programada. Publícalo otra vez con una hora más adelante.', false],
  forbiddenPrivacySetting: ['Tu canal no permite esa privacidad. Publícalo otra vez eligiendo otra.', false],
  youtubeSignupRequired: ['Esta cuenta de Google no tiene canal de YouTube. Crea uno en youtube.com y vuelve a conectarla.', false, true],
  authenticationError: [SESSION, false, true],
  authError: [SESSION, false, true],
  insufficientPermissions: ['Falta el permiso para subir videos. Vuelve a conectar tu canal y deja marcados todos los permisos.', false, true],
  accessNotConfigured: ['YouTube no está disponible para Clipo en este momento. Sube el video desde la página de YouTube.', false],
  forbidden: [NOT_ALLOWED, false],
};

/**
 * Turn a YouTube API error into a message for a beginner: what happened and what to do, never
 * the API's own text. Returns { message, retryable, reconnect }; `reconnect` = the saved session
 * no longer works (connect the channel again, then retry).
 */
function explainApiError(status, body) {
  const err = body && body.error;
  const reason = (err && err.errors && err.errors[0] && err.errors[0].reason) || (err && err.status) || '';
  const out = (message, retryable, reconnect = false) => ({ message, retryable, reconnect });
  const k = Object.prototype.hasOwnProperty.call(KNOWN, reason) ? KNOWN[reason] : null;
  if (k) return out(k[0], k[1], k[2] === true);
  if (status === 401) return out(SESSION, false, true);
  if (status === 403) return out(NOT_ALLOWED, false);
  if (isRetryableStatus(status) || status === 429) return out('YouTube tuvo un problema temporal. Pulsa “Reintentar” en un rato.', true);
  if (status === 413) return out('El video es demasiado grande para YouTube. Guárdalo más corto o en 720p y publícalo otra vez.', false);
  return out(`YouTube no aceptó el video (código ${status}). Revisa el título y la descripción y publícalo otra vez.`, status >= 500);
}

module.exports = { CHUNK_SIZE, chunkRange, nextOffset, isRetryableStatus, backoffMs, explainApiError };
