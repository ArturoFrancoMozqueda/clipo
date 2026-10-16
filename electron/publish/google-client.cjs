// The Google OAuth client built into this copy of Clipo, so "Conectar con Google" works with
// one click. It comes from the build (CI writes google-client.json from repository secrets; it is
// never committed) or, when developing, from CLIPO_GOOGLE_CLIENT_ID / CLIPO_GOOGLE_CLIENT_SECRET.
// For "desktop app" clients Google says the secret can't be kept secret: it only identifies the
// app; the user's own access stays in their encrypted tokens.
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_ID_RE = /^[\w.-]+\.apps\.googleusercontent\.com$/;

/** { clientId, clientSecret } or null when this build has none. */
function builtInGoogleClient(file = path.join(__dirname, 'google-client.json')) {
  let id = process.env.CLIPO_GOOGLE_CLIENT_ID;
  let secret = process.env.CLIPO_GOOGLE_CLIENT_SECRET;
  if (!id) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      id = j.clientId;
      secret = j.clientSecret;
    } catch {
      return null;
    }
  }
  id = String(id || '').trim();
  if (!CLIENT_ID_RE.test(id)) return null;
  return { clientId: id, clientSecret: typeof secret === 'string' && secret.trim() ? secret.trim() : undefined };
}

module.exports = { builtInGoogleClient, CLIENT_ID_RE };
