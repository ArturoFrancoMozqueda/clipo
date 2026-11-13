import type { CapacitorConfig } from '@capacitor/cli';

// Wraps the built web app (dist/) as native Android and iOS apps. See PUBLICAR.md.
const config: CapacitorConfig = {
  // Reverse-domain id shown in the stores. Pick the final one before the first upload: it can't change later.
  appId: 'app.clipo.editor',
  appName: 'Clipo',
  webDir: 'dist',
  backgroundColor: '#0a0a0c',
  plugins: {
    // Clipo is always dark: keep the clock and battery icons light even when the phone is in light
    // mode, and pass the bar sizes to the page (--safe-area-inset-*, used in styles.css).
    SystemBars: { style: 'DARK', insetsHandling: 'css' },
  },
};

export default config;
