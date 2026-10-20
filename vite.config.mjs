import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Content-Security-Policy nur im Build – im Dev-Modus braucht Vite Inline-Skripte für HMR
const csp = {
  name: 'mixtape-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'self' about: data: blob:",
      },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), csp],
  server: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  // Encoder wird erst im Worker geladen – vorab bündeln, sonst lädt Vite die Seite beim ersten Export neu
  optimizeDeps: { include: ['@breezystack/lamejs'] },
  build: { outDir: 'dist', emptyOutDir: true },
});
