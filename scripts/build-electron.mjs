import { build } from 'esbuild';

await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'mcp/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outdir: 'dist-electron',
  external: ['electron'],
  format: 'cjs',
});
console.log('Built Electron main, preload & TailWag MCP Server bundles.');
