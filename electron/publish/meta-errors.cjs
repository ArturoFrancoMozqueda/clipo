// Turn a Graph API error (https://developers.facebook.com/docs/graph-api/guides/error-handling)
// into a message for a beginner, and whether retrying can help. Instagram publishing errors come
// as code 100/9007/… with an error_subcode 2207xxx
// (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes).

const RECONNECT = (net) =>
  `La conexión con ${net} venció (pasa, por ejemplo, al cambiar la contraseña de Facebook). Vuelve a conectar tu cuenta y pulsa “Reintentar”.`;
const RATE = (net) => `${net} pide esperar un poco antes de seguir. Pulsa “Reintentar” en unos minutos.`;

/** Instagram publishing subcodes we can explain. [message, retryable] */
const IG_SUBCODES = {
  2207001: ['Instagram tuvo un problema temporal al recibir el video. Pulsa “Reintentar”.', true],
  2207003: ['Instagram tardó demasiado en recibir el video. Pulsa “Reintentar”.', true],
  2207008: ['La subida a Instagram venció antes de publicarse. Pulsa “Reintentar”.', true],
  2207020: ['La subida a Instagram venció antes de publicarse. Pulsa “Reintentar”.', true],
  2207026: ['Instagram no aceptó el video: tiene que ser MP4, durar de 3 segundos a 15 minutos y pesar hasta 300 MB. Vuelve a guardarlo con Clipo y publícalo otra vez.', false],
  2207027: ['Instagram todavía está preparando el video. Pulsa “Reintentar” en un minuto.', true],
  2207032: ['Instagram no pudo preparar la publicación. Pulsa “Reintentar”.', true],
  2207042: ['Esta cuenta llegó al límite de publicaciones de Instagram por hoy. Pulsa “Reintentar” mañana o publícalo desde la app de Instagram.', true],
  2207050: ['Instagram dice que la cuenta está restringida o inactiva. Entra a la app de Instagram y revisa los avisos de la cuenta.', false],
  2207051: ['Instagram bloqueó la publicación porque la consideró sospechosa o contraria a sus normas. Revisa los avisos de la cuenta en la app.', false],
};

/**
 * What happened and what to do, never the API's own text.
 * @param {object|undefined} error  The `error` object of a Graph response.
 * @param {number} status  HTTP status.
 * @param {string} net  'Facebook' or 'Instagram', for the message.
 * @returns {{ message: string, retryable: boolean, reconnect: boolean }}
 *   `reconnect` = the saved session no longer works (connect the account again, then retry).
 */
function explainGraphError(error, status, net = 'Facebook') {
  const e = error && typeof error === 'object' ? error : {};
  const code = Number(e.code);
  const sub = Number(e.error_subcode);
  const out = (message, retryable, reconnect = false) => ({ message, retryable, reconnect });
  if (IG_SUBCODES[sub]) return out(IG_SUBCODES[sub][0], IG_SUBCODES[sub][1]);
  if (code === 190 && sub === 459) return out('Facebook pide confirmar tu cuenta: entra a facebook.com, sigue los pasos y vuelve a conectarla en Clipo.', false, true);
  if (code === 190 || code === 102) return out(RECONNECT(net), false, true);
  if (code === 10 || (code >= 200 && code <= 299))
    return out(`${net} no dio permiso para publicar. Vuelve a conectar tu cuenta, deja marcados todos los permisos y elige esta página o cuenta de Instagram.`, false, true);
  if ([4, 17, 32, 613].includes(code) || (code >= 80001 && code <= 80014)) return out(RATE(net), true);
  if (code === 368) return out(`${net} bloqueó la publicación por un tiempo porque la consideró spam o contraria a sus normas. Revisa los avisos de la cuenta y vuelve a intentar más tarde.`, false);
  if (code === 9007) return out('Instagram todavía está preparando el video. Pulsa “Reintentar” en un minuto.', true);
  if (code === 6000 || code === 6001 || code === 1363030 || code === 1363019) return out(`${net} tuvo un problema recibiendo el video. Pulsa “Reintentar”.`, true);
  if (code === 351 || code === 352 || code === 389) return out(`${net} no pudo leer el video. Vuelve a guardarlo con Clipo (en MP4) y publícalo otra vez.`, false);
  if (code === 382) return out(`${net} dice que el video es demasiado corto o pequeño. Alárgalo un poco y publícalo otra vez.`, false);
  if (code === 1 || code === 2 || e.is_transient === true || status >= 500) return out(`${net} tuvo un problema temporal. Pulsa “Reintentar” en un rato.`, true);
  if (status === 401) return out(RECONNECT(net), false, true);
  if (status === 429) return out(RATE(net), true);
  if (code === 100) return out(`${net} no aceptó la publicación (código 100${sub ? `-${sub}` : ''}). Revisa el texto y que el video cumpla lo que pide ${net}, y publícalo otra vez.`, false);
  return out(`${net} no aceptó la publicación (código ${code || status}). Revisa el texto y el video, y publícalo otra vez.`, false);
}

module.exports = { explainGraphError };
