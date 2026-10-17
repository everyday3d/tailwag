import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HeightmapGrid } from '../engine/cadMeshBuilder';
import { buildLayerColorLUT } from '../engine/opticalTdEngine';
import { useTailWagStore } from '../store/useTailWagStore';

interface Viewport3DProps {
  grid: HeightmapGrid;
  sourceDataUrl: string;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({ grid, sourceDataUrl }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const backLightRef = useRef<THREE.PointLight | null>(null);

  const {
    viewportMode,
    splitRatio,
    setSplitRatio,
    lightAzimuthDeg,
    lightElevationDeg,
    backlitLithoMode,
    slicePreviewMaxLayer,
    baseLayerMm,
    layerHeightMm,
    totalLayers,
    slots,
  } = useTailWagStore();

  const layerLUT = useMemo(
    () => buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots),
    [totalLayers, baseLayerMm, layerHeightMm, slots]
  );

  // Initialize Three.js WebGL2 scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090d14');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, container.clientWidth / Math.max(1, container.clientHeight), 1, 2500);
    camera.position.set(0, -145, 235);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 1.2);

    // Subtle Bambu build plate reference grid (256x256mm)
    const bedGeo = new THREE.PlaneGeometry(256, 256);
    const bedMat = new THREE.MeshStandardMaterial({
      color: '#121824',
      roughness: 0.85,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
    const bedMesh = new THREE.Mesh(bedGeo, bedMat);
    bedMesh.position.z = -0.15;
    scene.add(bedMesh);

    const gridHelper = new THREE.GridHelper(256, 16, '#2e3b52', '#1b2434');
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.z = -0.08;
    scene.add(gridHelper);

    // Studio Lighting Rig
    const ambient = new THREE.AmbientLight('#ffffff', 0.62);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight('#fff8ed', 1.45);
    dirLight.position.set(90, -80, 180);
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    const backLight = new THREE.PointLight('#ffdca8', 0, 400);
    backLight.position.set(0, 0, -40);
    scene.add(backLight);
    backLightRef.current = backLight;

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / Math.max(1, h);
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
      renderer.dispose();
    };
  }, []);

  // Update lighting azimuth/elevation and backlit lithophane glow
  useEffect(() => {
    if (!dirLightRef.current || !backLightRef.current) return;
    const az = (lightAzimuthDeg * Math.PI) / 180;
    const el = (lightElevationDeg * Math.PI) / 180;
    const dist = 220;
    dirLightRef.current.position.set(
      dist * Math.cos(el) * Math.sin(az),
      -dist * Math.cos(el) * Math.cos(az),
      dist * Math.sin(el)
    );
    dirLightRef.current.intensity = backlitLithoMode ? 0.45 : 1.42;
    backLightRef.current.intensity = backlitLithoMode ? 3.2 : 0;
  }, [lightAzimuthDeg, lightElevationDeg, backlitLithoMode]);

  // Rebuild 3D Filament Painting Mesh with Beer-Lambert TD Vertex Color Blending + Z-Height Exaggeration
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || layerLUT.length === 0) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
    }

    const { cols, rows, widthMm, heightMm, topZ, normLum } = grid;
    const halfW = widthMm / 2;
    const halfH = heightMm / 2;
    const maxAllowedLayer = Math.max(1, Math.min(totalLayers, slicePreviewMaxLayer));
    const maxSliceZ = baseLayerMm + (maxAllowedLayer - 1) * layerHeightMm;

    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const vMap = new Int32Array(cols * rows).fill(-1);
    let vCounter = 0;

    // Exaggerate Z slightly in viewport (x2.2) so micro-layer steps (0.08mm) cast crisp studio relief shadows
    const zVisualScale = 2.2;

    for (let r = 0; r < rows; r++) {
      const y = halfH - (r / Math.max(1, rows - 1)) * heightMm;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const rawZ = topZ[idx];
        if (rawZ <= 0) continue;

        const x = (c / Math.max(1, cols - 1)) * widthMm - halfW;
        const clampedZ = Math.min(rawZ, maxSliceZ);

        // Determine discrete printed layer at this vertex
        const cellLayer = Math.max(
          1,
          Math.min(maxAllowedLayer, 1 + Math.round(normLum[idx] * (totalLayers - 1)))
        );
        const lutEntry = layerLUT[cellLayer - 1] || layerLUT[layerLUT.length - 1];

        let rCol = lutEntry.rgb.r;
        let gCol = lutEntry.rgb.g;
        let bCol = lutEntry.rgb.b;

        if (backlitLithoMode) {
          // Simulate warm LED backlight transmission through total thickness
          const transmit = Math.exp(-0.55 * clampedZ);
          rCol = Math.min(1, rCol * 0.45 + transmit * 1.05);
          gCol = Math.min(1, gCol * 0.45 + transmit * 0.92);
          bCol = Math.min(1, bCol * 0.45 + transmit * 0.72);
        }

        vMap[idx] = vCounter++;
        positions.push(x, y, clampedZ * zVisualScale);
        colors.push(rCol, gCol, bCol);
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const i00 = vMap[r * cols + c];
        const i10 = vMap[r * cols + (c + 1)];
        const i01 = vMap[(r + 1) * cols + c];
        const i11 = vMap[(r + 1) * cols + (c + 1)];

        if (i00 !== -1 && i10 !== -1 && i01 !== -1 && i11 !== -1) {
          indices.push(i00, i01, i10);
          indices.push(i10, i01, i11);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: backlitLithoMode ? 0.35 : 0.58,
      metalness: 0.06,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;
  }, [grid, layerLUT, slicePreviewMaxLayer, backlitLithoMode, baseLayerMm, layerHeightMm, totalLayers]);

  return (
    <div className="relative w-full h-full bg-[#090d14] overflow-hidden select-none">
      {/* Three.js 3D Canvas */}
      <div
        ref={containerRef}
        className={`w-full h-full ${viewportMode === 'source' ? 'hidden' : 'block'}`}
      />

      {/* Source Photo Overlay (Full or Split Wipe) */}
      {(viewportMode === 'source' || viewportMode === 'split') && (
        <div
          className="absolute inset-0 pointer-events-none flex items-center justify-center bg-[#090d14]/90"
          style={
            viewportMode === 'split'
              ? { clipPath: `inset(0 ${(1 - splitRatio) * 100}% 0 0)` }
              : undefined
          }
        >
          <img
            src={sourceDataUrl}
            alt="Source Reference"
            className="max-w-[78%] max-h-[78%] object-contain rounded-lg shadow-2xl border border-slate-700/60"
          />
          <div className="absolute top-4 left-4 bg-slate-900/90 border border-slate-700 px-2.5 py-1 rounded text-xs font-medium text-orange-400">
            Source Reference Image
          </div>
        </div>
      )}

      {/* Interactive Split Wipe Slider Handle */}
      {viewportMode === 'split' && (
        <input
          type="range"
          min={0.05}
          max={0.95}
          step={0.01}
          value={splitRatio}
          onChange={(e) => setSplitRatio(parseFloat(e.target.value))}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 w-72 accent-orange-500 z-20 cursor-ew-resize"
          title="Drag to compare Source Photo vs Simulated 3D TD Mesh"
        />
      )}

      {/* Floating HUD Telemetry Badge */}
      <div className="absolute top-3 right-3 flex items-center gap-2 bg-slate-900/85 backdrop-blur-md border border-slate-800 px-3 py-1.5 rounded-lg text-xs text-slate-300 pointer-events-none">
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span>
          {grid.widthMm}×{grid.heightMm}mm • {totalLayers} Layers ({(baseLayerMm + (totalLayers - 1) * layerHeightMm).toFixed(2)}mm Max Z)
        </span>
        <span className="text-slate-500">|</span>
        <span className="text-orange-400 font-semibold">{slots.length} Filaments</span>
      </div>
    </div>
  );
};
