// Errors that cross IPC as plain messages. "R|" = retrying may work, "F|" = it will not,
// "A|" = the account has to be connected again first (then retrying works).
// The page reads the prefix in src/publish/desktop.ts.
function fail(message, retryable = true) {
  return new Error(`${retryable ? 'R' : 'F'}|${message}`);
}

/** The saved session no longer works: the page offers "Volver a conectar". */
function reconnect(message) {
  return new Error(`A|${message}`);
}

/** Whether an error already carries a message for the user (one of the prefixes above). */
const isFail = (e) => typeof e?.message === 'string' && /^[RFA]\|/.test(e.message);
/** Whether waiting and trying again by itself can help. */
const isRetry = (e) => typeof e?.message === 'string' && e.message.startsWith('R|');

/** From { message, retryable, reconnect? } (the explain* helpers) to an error. */
function fromExplained(x) {
  return x.reconnect ? reconnect(x.message) : fail(x.message, x.retryable);
}

module.exports = { fail, reconnect, isFail, isRetry, fromExplained };
