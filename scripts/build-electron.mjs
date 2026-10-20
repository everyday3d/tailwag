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
  // onnxruntime-node is a native module: loaded from node_modules at run time, never bundled
  external: ['electron', 'onnxruntime-node'],
  format: 'cjs',
});
console.log('Built Electron main.js, preload.js & mcp-server.js bundles.');
