import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// package.json is the ONE source of version + build. Baked in here, and read by
// android/app/build.gradle for versionName/versionCode, so the number on the
// Credits screen and the number Android reports are the same number by
// construction - they cannot drift, because there is nothing to keep in sync.
// `build` increments on every APK installed to a device (see BUILD.md).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The @capacitor-community/sqlite web layer (jeep-sqlite) needs the sql.js wasm
// and the jeep-sqlite assets served from /assets. Copy them into the build.
export default defineConfig({
  plugins: [
    react(),
    // The sql.js wasm used to be copied here by viteStaticCopy to a hardcoded /assets/sql-wasm.wasm.
    // vite-plugin-static-copy v4 changed its path semantics and started preserving the SOURCE
    // directory (assets/node_modules/sql.js/dist/...), which silently broke the web SQLite backend -
    // db.js asked for a path that no longer existed. `rename` does not flatten it either.
    //
    // So the wasm now goes through Vite's own asset pipeline instead: db.js imports it with `?url`
    // and gets whatever hashed, base-correct URL Vite emitted. No hardcoded path to drift, and one
    // fewer plugin in the chain.
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(String(pkg.build)),
  },
  // Capacitor serves the built web assets from a file:// or localhost origin.
  base: './',
  // cssTarget declares the one real target (the Android WebView). NOTE: this
  // alone did NOT stop the minifier from collapsing `backdrop-filter` +
  // `-webkit-backdrop-filter` pairs into the -webkit- alias only - which
  // Chromium 150 (the System WebView) no longer supports, so every blur
  // declared in a .css file silently died in the minified build while inline
  // styles kept theirs (owner report 2026-08-15, "transparency too high").
  // The actual fix: the theme CSS declares ONLY the standard property - never
  // hand-write a -webkit-backdrop-filter pair again (device-verified 2026-08-15).
  build: { outDir: 'dist', target: 'es2020', cssTarget: 'chrome120' },
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
