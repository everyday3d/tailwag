import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Maximize2, Minimize2, Compass, Eye } from 'lucide-react';
import { HeightmapGrid } from '../engine/cadMeshBuilder';
import { PrintPlan, planLayerRgb } from '../engine/printPlan';
import { srgbToLinear } from '../engine/colorScience';
import { useTailWagStore } from '../store/useTailWagStore';

interface Viewport3DProps {
  grid: HeightmapGrid;
  /** What will be printed. Colors come from here, never re-derived from luminance. */
  plan: PrintPlan;
  sourceDataUrl: string;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({ grid, plan, sourceDataUrl }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const standardMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const basicMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const backLightRef = useRef<THREE.PointLight | null>(null);

  const [pipExpanded, setPipExpanded] = useState(false);
  const [pipHidden, setPipHidden] = useState(false);

  const {
    viewportMode,
    setViewportMode,
    splitRatio,
    setSplitRatio,
    lightAzimuthDeg,
    lightElevationDeg,
    backlitLithoMode,
    previewShading,
    slicePreviewMaxLayer,
    baseLayerMm,
    baseSolidThicknessMm,
    layerHeightMm,
    totalLayers,
    slots,
    renderVersion,
  } = useTailWagStore();

  const setCameraPreset = (preset: 'top-down' | 'angled-3d') => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    if (preset === 'top-down') {
      cam.position.set(0, -0.01, 275);
      ctrl.target.set(0, 0, 1.0);
    } else {
      cam.position.set(0, -135, 225);
      ctrl.target.set(0, 0, 1.2);
    }
    ctrl.update();
  };

  // Initialize Three.js WebGL2 scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090d14');
    sceneRef.current = scene;

    const w = Math.max(300, container.clientWidth);
    const h = Math.max(300, container.clientHeight);
    const camera = new THREE.PerspectiveCamera(38, w / h, 1, 2500);
    // Start slightly angled so 3D filament layers & portrait painting are both immediately clear
    camera.position.set(0, -95, 255);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 1.2);
    controlsRef.current = controls;

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
    const ambient = new THREE.AmbientLight('#ffffff', 0.72);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight('#fff8ed', 1.38);
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
      const cw = Math.max(100, container.clientWidth);
      const ch = Math.max(100, container.clientHeight);
      cameraRef.current.aspect = cw / ch;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(cw, ch);
    };

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
      renderer.dispose();
    };
  }, []);

  // Ensure renderer resizes when switching back from 'source' mode
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !rendererRef.current || !cameraRef.current) return;
    if (viewportMode !== 'source') {
      const cw = Math.max(100, container.clientWidth);
      const ch = Math.max(100, container.clientHeight);
      cameraRef.current.aspect = cw / ch;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(cw, ch);
    }
  }, [viewportMode]);

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
    dirLightRef.current.intensity = backlitLithoMode ? 0.45 : 1.38;
    backLightRef.current.intensity = backlitLithoMode ? 3.2 : 0;
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, [lightAzimuthDeg, lightElevationDeg, backlitLithoMode]);

  const vertexCellMapRef = useRef<Int32Array>(new Int32Array(0));

  // 1. Rebuild 3D Mesh Topology only when HeightmapGrid changes (pre-press, dimensions, CAD cutouts)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
    }

    const { cols, rows, widthMm, heightMm, topZ } = grid;
    const halfW = widthMm / 2;
    const halfH = heightMm / 2;
    const zVisualScale = 2.5;

    const vMap = new Int32Array(cols * rows).fill(-1);
    const cellIndices: number[] = [];
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let vCounter = 0;

    for (let r = 0; r < rows; r++) {
      const y = halfH - (r / Math.max(1, rows - 1)) * heightMm;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const rawZ = topZ[idx];
        if (rawZ <= 0) continue;

        const x = (c / Math.max(1, cols - 1)) * widthMm - halfW;
        vMap[idx] = vCounter++;
        cellIndices.push(idx);
        positions.push(x, y, rawZ * zVisualScale);
        colors.push(0.8, 0.8, 0.8);
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

    vertexCellMapRef.current = new Int32Array(cellIndices);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: backlitLithoMode ? 0.35 : 0.52,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });

    // Unlit material for the accuracy preview: shows the predicted color of each column exactly
    const basicMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    standardMatRef.current = material;
    basicMatRef.current = basicMaterial;

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;
  }, [grid]);

  // 2. Fast in-place Vertex Color & Z-Cutaway update (< 1ms) on every slider drag!
  useEffect(() => {
    const mesh = meshRef.current;
    const cellMap = vertexCellMapRef.current;
    if (!mesh || cellMap.length === 0 || plan.layerRgb.length === 0) return;

    const { topZ } = grid;
    const maxAllowedLayer = Math.max(1, Math.min(totalLayers, slicePreviewMaxLayer));
    const maxSliceZ = baseLayerMm + (maxAllowedLayer - 1) * layerHeightMm;
    const zVisualScale = 2.5;

    const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;
    const colArr = colAttr.array as Float32Array;

    for (let v = 0; v < cellMap.length; v++) {
      const idx = cellMap[v];
      const rawZ = topZ[idx];
      const clampedZ = Math.min(rawZ, maxSliceZ);
      posArr[v * 3 + 2] = clampedZ * zVisualScale;

      // Layer comes from the print plan (the same slicing rule the exports use), not from luminance.
      const planLayer = plan.layerGrid[idx];
      const cellLayer = Math.max(1, Math.min(maxAllowedLayer, planLayer));
      const layerRgb = planLayerRgb(plan, cellLayer);

      let rCol = layerRgb.r;
      let gCol = layerRgb.g;
      let bCol = layerRgb.b;

      if (backlitLithoMode) {
        const transmit = Math.exp(-0.55 * clampedZ);
        rCol = Math.min(1, rCol * 0.45 + transmit * 1.05);
        gCol = Math.min(1, gCol * 0.45 + transmit * 0.92);
        bCol = Math.min(1, bCol * 0.45 + transmit * 0.72);
      }

      // Vertex colors are interpreted as linear light and encoded to sRGB on output, so the
      // predicted sRGB color must be linearized first or the preview comes out too light.
      colArr[v * 3] = srgbToLinear(rCol);
      colArr[v * 3 + 1] = srgbToLinear(gCol);
      colArr[v * 3 + 2] = srgbToLinear(bCol);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    // Accuracy mode is unlit; the backlit lithophane simulation needs lighting, so it uses the lit material.
    const unlit = previewShading === 'accuracy' && !backlitLithoMode;
    const standard = standardMatRef.current;
    const basic = basicMatRef.current;
    if (standard && basic) {
      mesh.material = unlit ? basic : standard;
      standard.roughness = backlitLithoMode ? 0.35 : 0.52;
      standard.needsUpdate = true;
      basic.needsUpdate = true;
    }

    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, [
    grid,
    plan,
    slicePreviewMaxLayer,
    backlitLithoMode,
    previewShading,
    baseLayerMm,
    baseSolidThicknessMm,
    layerHeightMm,
    totalLayers,
    renderVersion,
  ]);

  return (
    <div className="relative w-full h-full bg-[#090d14] overflow-hidden select-none">
      {/* Three.js 3D Filament Painted Canvas */}
      <div
        ref={containerRef}
        className={`w-full h-full ${viewportMode === 'source' ? 'invisible' : 'visible'}`}
      />

      {/* Top-Left Camera & View Quick Controls */}
      {viewportMode === '3d-mesh' && (
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-slate-900/85 backdrop-blur-md border border-slate-800 p-1 rounded-lg z-10">
          <button
            onClick={() => setCameraPreset('top-down')}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800/80 hover:bg-orange-600 text-slate-200 hover:text-white transition"
            title="View flat from directly above like a 2D canvas"
          >
            <Eye className="w-3.5 h-3.5 text-orange-400" />
            <span className="min-[1600px]:hidden">Top-down</span>
            <span className="hidden min-[1600px]:inline">Top-Down Paint View</span>
          </button>
          <button
            onClick={() => setCameraPreset('angled-3d')}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800/80 hover:bg-orange-600 text-slate-200 hover:text-white transition"
            title="Tilt camera to inspect 3D printed filament layer depth"
          >
            <Compass className="w-3.5 h-3.5 text-sky-400" />
            <span className="min-[1600px]:hidden">Angled</span>
            <span className="hidden min-[1600px]:inline">3D Relief Angle</span>
          </button>
        </div>
      )}

      {/* Picture-in-Picture (PiP) Original Photo Comparison Inset in Bottom-Left Corner */}
      {viewportMode === '3d-mesh' && !pipHidden && (
        <div
          className={`absolute bottom-3 left-3 z-20 bg-slate-900/95 backdrop-blur-md border border-slate-700/90 rounded-xl shadow-2xl overflow-hidden transition-all duration-200 ${
            pipExpanded ? 'w-72' : 'w-44'
          }`}
        >
          <div className="px-2.5 py-1.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-[11px]">
            <span className="font-bold text-orange-400 truncate">Original Photo</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewportMode('split')}
                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300"
                title="Switch to Split-Screen Wipe Comparison"
              >
                Split
              </button>
              <button
                onClick={() => setPipExpanded(!pipExpanded)}
                className="text-slate-400 hover:text-white p-0.5"
                title={pipExpanded ? 'Shrink Preview' : 'Enlarge Preview'}
              >
                {pipExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setPipHidden(true)}
                className="text-slate-500 hover:text-slate-300 px-1 text-[10px]"
                title="Minimize Reference Card"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="p-1.5 flex items-center justify-center bg-[#070a10]">
            <img
              src={sourceDataUrl}
              alt="Original Upload Reference"
              onClick={() => setPipExpanded(!pipExpanded)}
              className={`w-full object-contain rounded cursor-pointer ${
                pipExpanded ? 'max-h-64' : 'max-h-36'
              }`}
            />
          </div>
        </div>
      )}

      {/* Restore PiP Button when minimized */}
      {viewportMode === '3d-mesh' && pipHidden && (
        <button
          onClick={() => setPipHidden(false)}
          className="absolute bottom-3 left-3 z-20 px-2.5 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-orange-400 shadow-lg transition"
        >
          Show Original Photo Inset
        </button>
      )}

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
      <div className="absolute top-3 right-3 flex items-center gap-2 bg-slate-900/85 backdrop-blur-md border border-slate-800 px-3 py-1.5 rounded-lg text-xs text-slate-300 pointer-events-none whitespace-nowrap">
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span>
          <span className="hidden min-[1750px]:inline">3D Filament Painted Preview • </span>
          {grid.widthMm}×{grid.heightMm}mm • {totalLayers} Layers
          <span className="hidden min-[1400px]:inline">
            {' '}({(baseLayerMm + (totalLayers - 1) * layerHeightMm).toFixed(2)}mm Max Z)
          </span>
        </span>
        <span className="text-slate-500">|</span>
        <span className="text-orange-400 font-semibold">{slots.length} Filaments</span>
      </div>
    </div>
  );
};
