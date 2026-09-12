import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset URLs so the app loads behind a sub-path proxy
  // (e.g. /sandbox/39033) as well as at the domain root.
  base: './',
  worker: { format: 'es' },
  server: { port: 8011, host: true },
  preview: { port: 8011, host: true },
});
