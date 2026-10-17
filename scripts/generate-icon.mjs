import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const outDir = path.resolve('build');
const publicDir = path.resolve('public');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

// CRC32 Table for PNG chunk encoding
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function renderIconSize(size) {
  const rgba = Buffer.alloc(size * size * 4);

  const setPixel = (x, y, r, g, b, a) => {
    const idx = (y * size + x) * 4;
    rgba[idx] = Math.max(0, Math.min(255, Math.round(r)));
    rgba[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
    rgba[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
    rgba[idx + 3] = Math.max(0, Math.min(255, Math.round(a)));
  };

  // Helper signed distance to ellipse
  const inEllipse = (nx, ny, cx, cy, rx, ry, angleRad = 0) => {
    const dx = nx - cx;
    const dy = ny - cy;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const lx = (dx * cos + dy * sin) / rx;
    const ly = (-dx * sin + dy * cos) / ry;
    return Math.hypot(lx, ly);
  };

  for (let y = 0; y < size; y++) {
    const ny = (y / (size - 1)) * 2 - 1; // -1..1
    for (let x = 0; x < size; x++) {
      const nx = (x / (size - 1)) * 2 - 1; // -1..1

      // Rounded squircle outer frame
      const rad = 0.36;
      const qx = Math.abs(nx) - (0.94 - rad);
      const qy = Math.abs(ny) - (0.94 - rad);
      const distSq = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;

      if (distSq > 0.02) {
        setPixel(x, y, 0, 0, 0, 0);
        continue;
      }

      const edgeAlpha = distSq > 0 ? 1 - distSq / 0.02 : 1;

      // Dark Slate Studio Background (#0f172a -> #1e293b)
      let r = lerp(24, 11, (ny + 1) * 0.5);
      let g = lerp(33, 15, (ny + 1) * 0.5);
      let b = lerp(52, 24, (ny + 1) * 0.5);

      // Outer 3D Beveled Orange/Gold Frame Rim
      if (distSq > -0.095) {
        const t = (ny + 1) * 0.5;
        r = lerp(255, 217, t);
        g = lerp(138, 83, t);
        b = lerp(36, 15, t);
      } else {
        // Horizontal Beer-Lambert TD Filament Layer Stripes across the background badge
        const layerBand = Math.floor(((ny + 0.85) / 1.7) * 16);
        if (layerBand % 2 === 0) {
          r += 5;
          g += 7;
          b += 11;
        }

        // Check Boxer Paw Pad + 4 Toe Beans
        const mainPadDist = inEllipse(nx, ny, 0.0, 0.24, 0.36, 0.28, 0);
        const indentBottom = inEllipse(nx, ny, 0.0, 0.53, 0.18, 0.12, 0);
        const effectiveMainPad = indentBottom < 1.0 ? Math.max(mainPadDist, 1.05 - indentBottom * 0.2) : mainPadDist;

        const toe1 = inEllipse(nx, ny, -0.42, -0.14, 0.14, 0.19, -0.35);
        const toe2 = inEllipse(nx, ny, -0.15, -0.34, 0.14, 0.20, -0.12);
        const toe3 = inEllipse(nx, ny, 0.15, -0.34, 0.14, 0.20, 0.12);
        const toe4 = inEllipse(nx, ny, 0.42, -0.14, 0.14, 0.19, 0.35);

        const minPawDist = Math.min(effectiveMainPad, toe1, toe2, toe3, toe4);

        if (minPawDist <= 1.0) {
          // 3D Stepped Contour TD Layers inside the Paw!
          // Outer step = Deep Mahogany/Brown, Mid step = BoxerDawg Orange, Inner step = Golden Amber, Center = Crisp Jade White
          if (minPawDist > 0.78) {
            // Layer 1: Rich Warm Brown (#7c3aed / #854d0e)
            r = 146; g = 64; b = 14;
          } else if (minPawDist > 0.52) {
            // Layer 2: Signature BoxerDawg Orange (#f97316)
            r = 249; g = 115; b = 22;
          } else if (minPawDist > 0.28) {
            // Layer 3: Warm Amber Gold (#fbbf24)
            r = 251; g = 191; b = 36;
          } else {
            // Layer 4: Top Highlight Jade White (#f8fafc)
            r = 248; g = 250; b = 252;
          }

          // Subtle 0.08mm topographic contour ring lines
          const ringMod = Math.abs((minPawDist * 12) % 1);
          if (ringMod < 0.09) {
            r *= 0.86;
            g *= 0.86;
            b *= 0.86;
          }
        }
      }

      setPixel(x, y, r, g, b, edgeAlpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

const sizes = [16, 32, 48, 64, 128, 256];
const pngBuffers = sizes.map((s) => ({ size: s, buf: renderIconSize(s) }));

// Write 256x256 PNG to build/icon.png and public/icon.png
const png256 = pngBuffers.find((p) => p.size === 256).buf;
fs.writeFileSync(path.join(outDir, 'icon.png'), png256);
fs.writeFileSync(path.join(publicDir, 'icon.png'), png256);

// Assemble multi-resolution Windows .ICO file
const numImages = pngBuffers.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // Reserved
header.writeUInt16LE(1, 2); // Type 1 = ICO
header.writeUInt16LE(numImages, 4);

const dirEntries = Buffer.alloc(16 * numImages);
let dataOffset = 6 + 16 * numImages;

pngBuffers.forEach((item, idx) => {
  const entryOffset = idx * 16;
  dirEntries[entryOffset] = item.size === 256 ? 0 : item.size; // width
  dirEntries[entryOffset + 1] = item.size === 256 ? 0 : item.size; // height
  dirEntries[entryOffset + 2] = 0; // color palette
  dirEntries[entryOffset + 3] = 0; // reserved
  dirEntries.writeUInt16LE(1, entryOffset + 4); // color planes
  dirEntries.writeUInt16LE(32, entryOffset + 6); // bits per pixel
  dirEntries.writeUInt32LE(item.buf.length, entryOffset + 8); // size of image data
  dirEntries.writeUInt32LE(dataOffset, entryOffset + 12); // offset
  dataOffset += item.buf.length;
});

const icoBuffer = Buffer.concat([header, dirEntries, ...pngBuffers.map((p) => p.buf)]);
fs.writeFileSync(path.join(outDir, 'icon.ico'), icoBuffer);
fs.writeFileSync(path.join(publicDir, 'icon.ico'), icoBuffer);

console.log(`Generated TailWag icons: build/icon.ico (${icoBuffer.length} bytes) & build/icon.png (${png256.length} bytes)`);
