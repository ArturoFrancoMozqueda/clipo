import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { swPrecache } from './scripts/swPrecache';

export default defineConfig({
  base: './',
  plugins: [react(), swPrecache()],
  // The captions worker loads Whisper with dynamic imports, which need ES module workers.
  worker: { format: 'es' },
  // Serve it as published so its WebAssembly files resolve, and so dev doesn't reload mid-run.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
