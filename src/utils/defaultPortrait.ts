/**
 * Renders the built-in BoxerDawg Tucker Portrait demo image onto an ImageData buffer
 * so TailWag Studio launches immediately with a rich multi-tonal 3D pet relief ready to inspect.
 */
export function createDefaultPortraitImageData(size: number = 360): { imageData: ImageData; dataUrl: string } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Deep radial studio backdrop
  const bgGrad = ctx.createRadialGradient(size * 0.5, size * 0.45, size * 0.08, size * 0.5, size * 0.5, size * 0.65);
  bgGrad.addColorStop(0, '#5a3b26');
  bgGrad.addColorStop(0.55, '#261a14');
  bgGrad.addColorStop(1, '#0d0d10');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  const cx = size * 0.5;
  const cy = size * 0.52;

  // Shoulders / Collar (Rich Earth Brown)
  ctx.fillStyle = '#684432';
  ctx.beginPath();
  ctx.ellipse(cx, size * 0.9, size * 0.34, size * 0.22, 0, Math.PI, 0, false);
  ctx.fill();

  // White chest blaze
  const chestGrad = ctx.createRadialGradient(cx, size * 0.86, 4, cx, size * 0.88, size * 0.18);
  chestGrad.addColorStop(0, '#f8fafc');
  chestGrad.addColorStop(0.7, '#d6d3d1');
  chestGrad.addColorStop(1, '#684432');
  ctx.fillStyle = chestGrad;
  ctx.beginPath();
  ctx.ellipse(cx, size * 0.87, size * 0.14, size * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Boxer Floppy Ears (Dark Espresso Brown)
  ctx.fillStyle = '#362219';
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.24, cy - size * 0.12, size * 0.1, size * 0.22, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.24, cy - size * 0.12, size * 0.1, size * 0.22, -0.35, 0, Math.PI * 2);
  ctx.fill();

  // Main Head Dome (Rich Natural Boxer Brown Coat — Chestnut to Earth Brown)
  const headGrad = ctx.createRadialGradient(cx, cy - size * 0.08, size * 0.04, cx, cy, size * 0.28);
  headGrad.addColorStop(0, '#9c7358');
  headGrad.addColorStop(0.55, '#78503c');
  headGrad.addColorStop(1, '#482d20');
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy - size * 0.04, size * 0.23, size * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();

  // White Forehead Blaze (High Z-elevation highlight)
  const blazeGrad = ctx.createLinearGradient(cx, cy - size * 0.24, cx, cy + size * 0.05);
  blazeGrad.addColorStop(0, '#e2e8f0');
  blazeGrad.addColorStop(0.5, '#ffffff');
  blazeGrad.addColorStop(1, '#cbd5e1');
  ctx.fillStyle = blazeGrad;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.23);
  ctx.quadraticCurveTo(cx + size * 0.045, cy - size * 0.1, cx + size * 0.025, cy + size * 0.02);
  ctx.quadraticCurveTo(cx, cy + size * 0.05, cx - size * 0.025, cy + size * 0.02);
  ctx.quadraticCurveTo(cx - size * 0.045, cy - size * 0.1, cx, cy - size * 0.23);
  ctx.fill();

  // Boxer Black Mask & Jowls
  const muzzleGrad = ctx.createRadialGradient(cx, cy + size * 0.09, size * 0.02, cx, cy + size * 0.12, size * 0.19);
  muzzleGrad.addColorStop(0, '#44403c');
  muzzleGrad.addColorStop(0.6, '#1c1917');
  muzzleGrad.addColorStop(1, '#0c0a09');
  ctx.fillStyle = muzzleGrad;
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.07, cy + size * 0.12, size * 0.12, size * 0.14, 0.15, 0, Math.PI * 2);
  ctx.ellipse(cx + size * 0.07, cy + size * 0.12, size * 0.12, size * 0.14, -0.15, 0, Math.PI * 2);
  ctx.fill();

  // White Muzzle Trim
  ctx.fillStyle = '#f1f5f9';
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.055, cy + size * 0.13, size * 0.065, size * 0.075, 0.2, 0, Math.PI * 2);
  ctx.ellipse(cx + size * 0.055, cy + size * 0.13, size * 0.065, size * 0.075, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // Expressive Eyes with Crisp Specular Catchlights
  const drawEye = (ex: number, ey: number) => {
    ctx.fillStyle = '#09090b';
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.038, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.026, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#09090b';
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.014, 0, Math.PI * 2);
    ctx.fill();

    // Bright white catchlight
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex - size * 0.009, ey - size * 0.009, size * 0.009, 0, Math.PI * 2);
    ctx.fill();
  };

  drawEye(cx - size * 0.095, cy - size * 0.05);
  drawEye(cx + size * 0.095, cy - size * 0.05);

  // Nose Bridge & Glossy Nose Tip
  const noseGrad = ctx.createRadialGradient(cx, cy + size * 0.04, 2, cx, cy + size * 0.055, size * 0.065);
  noseGrad.addColorStop(0, '#78716c');
  noseGrad.addColorStop(0.5, '#1c1917');
  noseGrad.addColorStop(1, '#09090b');
  ctx.fillStyle = noseGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.055, size * 0.065, size * 0.048, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose specular highlight strip
  ctx.fillStyle = '#e7e5e4';
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.035, size * 0.032, size * 0.01, 0, 0, Math.PI * 2);
  ctx.fill();

  // Subtle fur radial strokes for micro-contrast texture
  ctx.strokeStyle = 'rgba(255, 237, 213, 0.22)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 95; i++) {
    const angle = (i / 95) * Math.PI * 2;
    const r1 = size * (0.14 + (i % 5) * 0.018);
    const r2 = r1 + size * 0.032;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * r1, cy - size * 0.02 + Math.sin(angle) * r1);
    ctx.lineTo(cx + Math.cos(angle) * r2, cy - size * 0.02 + Math.sin(angle) * r2);
    ctx.stroke();
  }

  return {
    imageData: ctx.getImageData(0, 0, size, size),
    dataUrl: canvas.toDataURL('image/png'),
  };
}
