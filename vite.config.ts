import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import type { Connect } from 'vite';

/**
 * Strip Accept-Encoding on preview responses through the sandbox proxy.
 * The proxy re-chunks + re-gzips bodies itself; pre-compressed bytes from
 * vite's compression middleware then fail to decode in external browsers
 * (ERR_CONTENT_DECODING_FAILED), so the preview serves identity upstream.
 */
function previewIdentityEncoding(): { name: string; configurePreviewServer: (s: { middlewares: { use: (fn: Connect.NextHandleFunction) => void } }) => void } {
  return {
    name: 'preview-identity-encoding',
    configurePreviewServer(server) {
      server.middlewares.use(((req, _res, next) => {
        delete req.headers['accept-encoding'];
        next();
      }) as Connect.NextHandleFunction);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile(), previewIdentityEncoding()],
  // Relative asset URLs so the app loads behind a sub-path proxy
  // (e.g. /sandbox/39033) as well as at the domain root.
  base: './',
  worker: { format: 'es' },
  server: {
    port: 8011, host: true, strictPort: true,
    // Sandbox reverse-proxy fronts the dev server under /sandbox/<id>.
    allowedHosts: ['.hstgr.cloud', 'localhost', '127.0.0.1'],
  },
  preview: {
    port: 8012, host: true, strictPort: true,
    allowedHosts: ['.hstgr.cloud', 'localhost', '127.0.0.1'],
  },
});
