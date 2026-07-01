import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// The @capacitor-community/sqlite web layer (jeep-sqlite) needs the sql.js wasm
// and the jeep-sqlite assets served from /assets. Copy them into the build.
export default defineConfig({
  plugins: [
    react(),
    // jeep-sqlite (web SQLite) loads the sql.js wasm from /assets/sql-wasm.wasm.
    viteStaticCopy({
      targets: [
        { src: 'node_modules/sql.js/dist/sql-wasm.wasm', dest: 'assets' },
      ],
    }),
  ],
  // Capacitor serves the built web assets from a file:// or localhost origin.
  base: './',
  build: { outDir: 'dist', target: 'es2020' },
  server: {
    port: 5000,
    host: true,   // bind 0.0.0.0 so the dev server is reachable over Tailscale/LAN
    // Dev-only: lets the browser preview reach Curiosa's API (CORS-blocked otherwise).
    // On device, the app uses CapacitorHttp instead and never hits this.
    proxy: {
      '/curiosa': {
        target: 'https://curiosa.io',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/curiosa/, ''),
        headers: { Origin: 'https://curiosa.io', Referer: 'https://curiosa.io/', 'User-Agent': 'Mozilla/5.0' },
      },
    },
  },
});
