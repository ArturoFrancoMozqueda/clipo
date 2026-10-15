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
  /** Show the networks without an adapter yet, as "Requiere configuración" cards. */
  upcomingNetworks: flag('clipo.publish.upcoming', true),
};
