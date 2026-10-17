import { build } from 'esbuild';

await build({
  entryPoints: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
    'mcp-server': 'mcp/server.ts',
  },
  bundle: true,
  platform: 'node',
  target: 'node20',
  outdir: 'dist-electron',
  external: ['electron'],
  format: 'cjs',
});
console.log('Built Electron main.js, preload.js & mcp-server.js bundles.');
