// Turn a Graph API error (https://developers.facebook.com/docs/graph-api/guides/error-handling)
// into a message for a beginner, and whether retrying can help. Instagram publishing errors come
// as code 100/9007/… with an error_subcode 2207xxx
// (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes).

const RECONNECT = (net) =>
  `La conexión con ${net} venció o se revocó (por ejemplo, cambiaste tu contraseña de Facebook o quitaste el permiso). Ve a Cuentas y pulsa “Conectar con Facebook” otra vez.`;
const RATE = (net) => `${net} pide esperar antes de seguir (límite de uso de la API). Pulsa “Reintentar” en unos minutos.`;

/** Instagram publishing subcodes we can explain. [message, retryable] */
const IG_SUBCODES = {
  2207001: ['Instagram tuvo un problema temporal al recibir el video. Pulsa “Reintentar”.', true],
  2207003: ['Instagram tardó demasiado en recibir el video. Pulsa “Reintentar”.', true],
  2207008: ['La subida a Instagram venció antes de publicarse. Pulsa “Reintentar”.', true],
  2207020: ['La subida a Instagram venció antes de publicarse. Pulsa “Reintentar”.', true],
  2207026: ['Instagram no aceptó el video: tiene que ser MP4 o MOV (H.264 o HEVC, AAC), de 3 s a 15 min y hasta 300 MB. Vuelve a exportarlo con Clipo.', false],
  2207027: ['Instagram todavía está procesando el video. Pulsa “Reintentar” en un minuto.', true],
  2207032: ['Instagram no pudo preparar la publicación. Pulsa “Reintentar”.', true],
  2207042: ['Llegaste al límite de publicaciones por API de Instagram en 24 horas. Pulsa “Reintentar” mañana o publícalo desde la app de Instagram.', true],
  2207050: ['Instagram dice que la cuenta está restringida o inactiva. Entra a la app de Instagram y revisa los avisos de la cuenta.', false],
  2207051: ['Instagram bloqueó la publicación porque la consideró sospechosa o contraria a sus normas. Revisa los avisos de la cuenta en la app.', false],
};

/**
 * @param {object|undefined} error  The `error` object of a Graph response.
 * @param {number} status  HTTP status.
 * @param {string} net  'Facebook' or 'Instagram', for the message.
 * @returns {{ message: string, retryable: boolean }}
 */
function explainGraphError(error, status, net = 'Facebook') {
  const e = error && typeof error === 'object' ? error : {};
  const code = Number(e.code);
  const sub = Number(e.error_subcode);
  const detail = String(e.error_user_msg || e.message || '').slice(0, 300);
  const said = detail ? `: ${detail}` : '.';
  if (IG_SUBCODES[sub]) return { message: IG_SUBCODES[sub][0], retryable: IG_SUBCODES[sub][1] };
  if (code === 190 && sub === 459) return { message: 'Facebook pide confirmar tu cuenta: entra a facebook.com, sigue los pasos y vuelve a conectar en Cuentas.', retryable: false };
  if (code === 190 || code === 102) return { message: RECONNECT(net), retryable: false };
  if (code === 10 || (code >= 200 && code <= 299))
    return {
      message: `${net} no dio permiso para esto. En Cuentas pulsa “Conectar con Facebook” otra vez, deja marcados todos los permisos y elige esta página o cuenta de Instagram.`,
      retryable: false,
    };
  if ([4, 17, 32, 613].includes(code) || (code >= 80001 && code <= 80014)) return { message: RATE(net), retryable: true };
  if (code === 368) return { message: `${net} bloqueó la publicación por un tiempo porque la consideró spam o contraria a sus normas. Revisa los avisos de la cuenta y vuelve a intentar más tarde.`, retryable: false };
  if (code === 9007) return { message: 'Instagram todavía está procesando el video. Pulsa “Reintentar” en un minuto.', retryable: true };
  if (code === 6000 || code === 6001 || code === 1363030 || code === 1363019) return { message: `${net} tuvo un problema recibiendo el video. Pulsa “Reintentar”.`, retryable: true };
  if (code === 351 || code === 352 || code === 389) return { message: `${net} no pudo leer el video (archivo dañado o formato no aceptado). Vuelve a exportarlo como MP4.`, retryable: false };
  if (code === 382) return { message: `${net} dice que el video es demasiado corto o pequeño.`, retryable: false };
  if (code === 1 || code === 2 || e.is_transient === true || status >= 500) return { message: `${net} tuvo un problema temporal. Pulsa “Reintentar” en un rato.`, retryable: true };
  if (status === 401) return { message: RECONNECT(net), retryable: false };
  if (code === 100) return { message: `${net} no aceptó un dato de la publicación${said}`, retryable: false };
  return { message: `${net} respondió con un error${code ? ` (${code})` : ` (${status})`}${said}`, retryable: false };
}

module.exports = { explainGraphError };
