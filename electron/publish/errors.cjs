// Errors that cross IPC as plain messages. "R|" = retrying may work, "F|" = it will not
// (the page reads the prefix in src/publish/desktop.ts).
function fail(message, retryable = true) {
  return new Error(`${retryable ? 'R' : 'F'}|${message}`);
}

module.exports = { fail };
