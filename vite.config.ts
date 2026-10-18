import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const appVersion: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
  plugins: [
    react(),
    {
      // Puts the package.json version into the loading screen in index.html.
      name: 'tailwag-html-version',
      transformIndexHtml: (html) => html.replace(/__APP_VERSION__/g, appVersion),
    },
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 5188,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
