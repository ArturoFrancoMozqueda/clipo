// Tells the user when a newer Clipo is published on GitHub Releases and opens its download page.
// It never downloads or runs anything by itself: the installers aren't code-signed, so installing
// them silently would mean trusting whatever the network returns.
const REPO = 'ArturoFrancoMozqueda/clipo';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES = `https://github.com/${REPO}/releases/`;

/** "v1.2.3" / "1.2.3-beta" -> [1, 2, 3] */
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? m.slice(1, 4).map(Number) : null;
}

function isNewer(remote, local) {
  const a = parse(remote);
  const b = parse(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Checks once, quietly: no network, rate limits or odd answers never bother the user. */
async function checkForUpdates({ app, net, dialog, shell, win }) {
  try {
    const res = await net.fetch(API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Clipo/${app.getVersion()}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    const release = await res.json();
    if (release.draft || release.prerelease || !isNewer(release.tag_name, app.getVersion())) return;
    // Only ever open this repository's own release page.
    const page = typeof release.html_url === 'string' && release.html_url.startsWith(RELEASES) ? release.html_url : RELEASES;
    if (!win || win.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Descargar', 'Ahora no'],
      defaultId: 0,
      cancelId: 1,
      title: 'Nueva versión de Clipo',
      message: `Hay una versión nueva de Clipo (${String(release.tag_name).replace(/^v/, '')}).`,
      detail: `Tienes la ${app.getVersion()}. Se abrirá la página de descarga; tus proyectos se conservan al instalarla.`,
    });
    if (response === 0) await shell.openExternal(page);
  } catch {
    // Offline or GitHub unreachable: try again next launch.
  }
}

module.exports = { checkForUpdates, isNewer };
