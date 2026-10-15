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

/** Turn a YouTube API error into a message for a beginner, and whether retrying can help. */
function explainApiError(status, body) {
  const err = body && body.error;
  const reason = (err && err.errors && err.errors[0] && err.errors[0].reason) || (err && err.status) || '';
  const known = {
    quotaExceeded: ['Se acabó el cupo diario de la API de YouTube de tu proyecto de Google. Se renueva cada día (medianoche, hora del Pacífico).', true],
    uploadLimitExceeded: ['Tu canal llegó al límite de subidas de YouTube por ahora. Intenta más tarde.', true],
    rateLimitExceeded: ['YouTube pide esperar un poco antes de seguir. Intenta en unos minutos.', true],
    invalidTitle: ['YouTube no aceptó el título. Revisa que no esté vacío ni pase de 100 letras.', false],
    invalidDescription: ['YouTube no aceptó la descripción. Acórtala un poco.', false],
    invalidTags: ['YouTube no aceptó los hashtags. Prueba con menos o más cortos.', false],
    invalidPublishAt: ['La fecha programada no es válida para YouTube. Elige una hora en el futuro.', false],
    forbiddenPrivacySetting: ['Tu canal no permite esa privacidad. Elige otra.', false],
    youtubeSignupRequired: ['Esta cuenta de Google no tiene canal de YouTube. Crea uno en youtube.com y vuelve a conectarla.', false],
    authenticationError: ['La sesión con YouTube venció. Ve a Cuentas y vuelve a conectar el canal.', false],
    insufficientPermissions: ['Faltan permisos. Ve a Cuentas, desconecta el canal y conéctalo dando permiso para subir videos.', false],
    accessNotConfigured: ['La API de YouTube no está activada en tu proyecto de Google Cloud. Actívala (YouTube Data API v3) y reintenta.', true],
  };
  if (known[reason]) return { message: known[reason][0], retryable: known[reason][1] };
  if (status === 401) return { message: 'La sesión con YouTube venció. Ve a Cuentas y vuelve a conectar el canal.', retryable: false };
  if (status === 403) return { message: `YouTube no lo permitió${err && err.message ? `: ${err.message}` : '.'}`, retryable: false };
  if (isRetryableStatus(status) || status === 429) return { message: 'YouTube tuvo un problema temporal. Intenta otra vez en un rato.', retryable: true };
  return { message: `YouTube respondió con un error (${status})${err && err.message ? `: ${err.message}` : '.'}`, retryable: status >= 500 };
}

module.exports = { CHUNK_SIZE, chunkRange, nextOffset, isRetryableStatus, backoffMs, explainApiError };
