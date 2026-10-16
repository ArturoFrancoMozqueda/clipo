// The Meta (Facebook) App ID built into this copy of Clipo, so the owner doesn't have to paste it.
// It comes from the build (CI writes meta-client.json from the META_APP_ID repository secret; it is
// never committed) or, when developing, from CLIPO_META_APP_ID. The App ID is public (it appears
// in every login URL). The App Secret is NOT built in: in a public installer anyone could take it
// and act as the app, so the owner pastes it once in Cuentas and it stays encrypted on their computer.
const fs = require('node:fs');
const path = require('node:path');

const APP_ID_RE = /^\d{5,20}$/;
/** App Secrets are 32 hexadecimal characters. */
const APP_SECRET_RE = /^[a-f0-9]{32}$/i;
/** Facebook Login for Business configuration ID (optional). */
const CONFIG_ID_RE = /^\d{5,20}$/;

/** { appId } or null when this build has none. */
function builtInMetaApp(file = path.join(__dirname, 'meta-client.json')) {
  let id = process.env.CLIPO_META_APP_ID;
  if (!id) {
    try {
      id = JSON.parse(fs.readFileSync(file, 'utf8')).appId;
    } catch {
      return null;
    }
  }
  id = String(id || '').trim();
  return APP_ID_RE.test(id) ? { appId: id } : null;
}

module.exports = { builtInMetaApp, APP_ID_RE, APP_SECRET_RE, CONFIG_ID_RE };
