// Feature flags of the publishing center. Turn one off from the console with
// localStorage.setItem('clipo.publish.upcoming', '0') and reload.
function flag(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export const PUBLISH_FLAGS = {
  /** Show one card in Cuentas listing the networks that publish with their own page. */
  upcomingNetworks: flag('clipo.publish.upcoming', true),
};
