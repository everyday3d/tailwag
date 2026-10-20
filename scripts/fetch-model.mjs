// Downloads the subject-cutout model (BiRefNet lite, MIT) into models/ and checks it.
// The file is too large for git (GitHub limit 100 MB), so local builds and the release
// workflow fetch it here; electron-builder then bundles models/ into the installers.
// Pinned to one repository revision and one SHA-256, so every build ships the same file.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MODEL = {
  file: 'birefnet-lite.onnx',
  url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model.onnx',
  sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
  bytes: 224005088,
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'models');
const target = join(dir, MODEL.file);

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

if (existsSync(target) && statSync(target).size === MODEL.bytes && sha256File(target) === MODEL.sha256) {
  console.log(`${MODEL.file} is present and verified.`);
  process.exit(0);
}

mkdirSync(dir, { recursive: true });
const partial = `${target}.part`;
console.log(`Downloading ${MODEL.file} (${(MODEL.bytes / 1e6).toFixed(0)} MB)...`);
const res = await fetch(MODEL.url, { redirect: 'follow' });
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
const hash = createHash('sha256');
let received = 0;
let lastPct = -10;
const body = Readable.fromWeb(res.body);
body.on('data', (chunk) => {
  hash.update(chunk);
  received += chunk.length;
  const pct = Math.floor((received / MODEL.bytes) * 100);
  if (pct >= lastPct + 10) {
    lastPct = pct;
    console.log(`  ${pct}%`);
  }
});
await pipeline(body, createWriteStream(partial));
const digest = hash.digest('hex');
if (received !== MODEL.bytes || digest !== MODEL.sha256) {
  rmSync(partial, { force: true });
  throw new Error(`Checksum mismatch for ${MODEL.file}: got ${received} bytes, sha256 ${digest}. The file was discarded.`);
}
renameSync(partial, target);
console.log(`${MODEL.file} downloaded and verified (sha256 ${digest.slice(0, 12)}...).`);
