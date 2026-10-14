import type { CapacitorConfig } from '@capacitor/cli';

// Wraps the built web app (dist/) as native Android and iOS apps. See PUBLICAR.md.
const config: CapacitorConfig = {
  // Reverse-domain id shown in the stores. Pick the final one before the first upload: it can't change later.
  appId: 'app.clipo.editor',
  appName: 'Clipo',
  webDir: 'dist',
  backgroundColor: '#0e0e12',
};

export default config;
