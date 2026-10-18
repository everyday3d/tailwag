import type { HeightmapGrid } from './cadMeshBuilder';

/**
 * Exact horizontal-slab meshes of the heightmap solid.
 *
 * Each filament band owns the part of the solid between two horizontal planes
 * (floor F and ceiling C). The top surface of the heightmap is a triangulated surface
 * (two triangles per quad, same diagonal as the STL). Within a band the solid is
 *
 *     bottom(x,y) = clamp(bottomZ(x,y), F, C)   <=   z   <=   top(x,y) = min(surface(x,y), C)
 *
 * and exists only where surface(x,y) > bottom(x,y). Triangles are clipped exactly against the two
 * planes (surface = F, surface = C), so no material is lost where a slope crosses a band
 * boundary, the parts tile the full solid, and neighboring parts meet on flat interfaces.
 *
 * Intersection points are always computed from the ORIGINAL triangle edge (canonical node order)
 * so two triangles sharing an edge produce bit-identical points and the part stays watertight.
 */

const EPS = 1e-7;

interface PolyVertex {
  /** Barycentric weights over the triangle's 3 nodes */
  w: [number, number, number];
}

function lerpW(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const valueAt = (v: PolyVertex, f: number[]) => v.w[0] * f[0] + v.w[1] * f[1] + v.w[2] * f[2];

/**
 * Intersection of polygon edge u->v with f = 0, where u and v are on opposite sides.
 * When both lie on one original triangle edge the point is computed from that edge's nodes in
 * canonical order, so the neighboring triangle derives exactly the same point.
 */
function intersect(u: PolyVertex, v: PolyVertex, f: number[], ids: number[]): PolyVertex {
  for (let k = 0; k < 3; k++) {
    if (u.w[k] === 0 && v.w[k] === 0) {
      let a = (k + 1) % 3;
      let b = (k + 2) % 3;
      if (ids[a] > ids[b]) {
        const tmp = a;
        a = b;
        b = tmp;
      }
      const fa = f[a];
      const fb = f[b];
      const t = fa / (fa - fb);
      const w: [number, number, number] = [0, 0, 0];
      w[a] = 1 - t;
      w[b] = t;
      return { w };
    }
  }
  const fu = valueAt(u, f);
  const fv = valueAt(v, f);
  const t = fu / (fu - fv);
  return { w: lerpW(u.w, v.w, t) };
}

/** Sutherland-Hodgman clip of a convex polygon keeping f >= 0 (sign=+1) or f <= 0 (sign=-1). */
function clip(poly: PolyVertex[], f: number[], ids: number[], sign: 1 | -1): PolyVertex[] {
  if (poly.length === 0) return poly;
  const out: PolyVertex[] = [];
  const n = poly.length;
  const vals = poly.map((p) => valueAt(p, f) * sign);
  for (let i = 0; i < n; i++) {
    const u = poly[i];
    const v = poly[(i + 1) % n];
    const fu = vals[i];
    const fv = vals[(i + 1) % n];
    const uIn = fu >= -EPS;
    const vIn = fv >= -EPS;
    const uStrictIn = fu > EPS;
    const vStrictIn = fv > EPS;
    if (uIn) out.push(u);
    // A crossing exists only when one end is strictly inside and the other strictly outside.
    if ((uStrictIn && fv < -EPS) || (vStrictIn && fu < -EPS)) {
      out.push(intersect(u, v, f.map((x) => x * sign), ids));
    }
    void vIn;
  }
  return out;
}

function polygonArea2(pts: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    s += x0 * y1 - x1 * y0;
  }
  return s;
}

export interface BandMesh {
  verticesXml: string[];
  trianglesXml: string[];
  faceCount: number;
}

export function buildColorBandPartMesh(
  grid: HeightmapGrid,
  zFloor: number,
  zCeil: number,
  centerZ: number
): BandMesh {
  const { cols, rows, widthMm, heightMm, topZ, bottomZ } = grid;
  const halfW = widthMm / 2;
  const halfH = heightMm / 2;
  const xAt = (c: number) => (c / (cols - 1)) * widthMm - halfW;
  const yAt = (r: number) => halfH - (r / (rows - 1)) * heightMm;

  const verticesXml: string[] = [];
  const trianglesXml: string[] = [];
  const vmap = new Map<string, number>();

  const addVertex = (x: number, y: number, z: number): number => {
    const xs = x.toFixed(4);
    const ys = y.toFixed(4);
    const zs = (z - centerZ).toFixed(4);
    const key = `${xs}|${ys}|${zs}`;
    const found = vmap.get(key);
    if (found !== undefined) return found;
    const idx = verticesXml.length;
    vmap.set(key, idx);
    verticesXml.push(`     <vertex x="${xs}" y="${ys}" z="${zs}"/>`);
    return idx;
  };
  const addTri = (a: number, b: number, c: number) => {
    if (a === b || b === c || a === c) return; // collapsed by rounding: contributes nothing
    trianglesXml.push(`     <triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  };

  const isValidQuad = (c: number, r: number) => {
    if (c < 0 || c >= cols - 1 || r < 0 || r >= rows - 1) return false;
    return (
      topZ[r * cols + c] > 0 &&
      topZ[r * cols + c + 1] > 0 &&
      topZ[(r + 1) * cols + c] > 0 &&
      topZ[(r + 1) * cols + c + 1] > 0
    );
  };

  const processTriangle = (
    ids: [number, number, number],
    nodeC: [number, number, number],
    nodeR: [number, number, number],
    perimeter: [boolean, boolean, boolean]
  ) => {
    const X = nodeC.map(xAt);
    const Y = nodeR.map(yAt);
    const H = ids.map((i) => topZ[i]);
    // Band bottom per node: the rear-pocket surface, lifted to the floor and capped at the ceiling
    const B = ids.map((i) => Math.min(Math.max(bottomZ[i], zFloor), zCeil));
    const D = H.map((h, k) => h - B[k]); // > 0 where material exists in this band
    if (D.every((d) => d <= EPS)) return;

    let region: PolyVertex[] = [
      { w: [1, 0, 0] },
      { w: [0, 1, 0] },
      { w: [0, 0, 1] },
    ];
    region = clip(region, D, ids, 1);
    if (region.length < 3) return;

    // Split the material region by the ceiling plane: sloped surface below, flat cap above.
    // A region lying entirely on one side (or exactly on the plane) is emitted once, never twice.
    const E = H.map((h) => zCeil - h);
    const eVals = region.map((v) => valueAt(v, E));
    const minE = Math.min(...eVals);
    const maxE = Math.max(...eVals);
    let sloped: PolyVertex[] = [];
    let cap: PolyVertex[] = [];
    if (minE >= -EPS) {
      sloped = region; // never above the ceiling (including exactly on it)
    } else if (maxE <= EPS) {
      cap = region; // entirely above the ceiling
    } else {
      sloped = clip(region, E, ids, 1);
      cap = clip(region, E, ids, -1);
    }

    const pos = (v: PolyVertex) => {
      const x = v.w[0] * X[0] + v.w[1] * X[1] + v.w[2] * X[2];
      const y = v.w[0] * Y[0] + v.w[1] * Y[1] + v.w[2] * Y[2];
      const h = v.w[0] * H[0] + v.w[1] * H[1] + v.w[2] * H[2];
      const b = v.w[0] * B[0] + v.w[1] * B[1] + v.w[2] * B[2];
      return { x, y, top: Math.min(h, zCeil), bot: Math.min(b, Math.min(h, zCeil)) };
    };

    const emit = (poly: PolyVertex[]) => {
      if (poly.length < 3) return;
      const ps = poly.map(pos);
      if (Math.abs(polygonArea2(ps.map((p) => [p.x, p.y] as [number, number]))) < 1e-9) return;
      const tops = ps.map((p) => addVertex(p.x, p.y, p.top));
      const bots = ps.map((p) => addVertex(p.x, p.y, p.bot));
      // After rounding, a polygon with no thickness anywhere is a doubled zero-volume sheet: drop it.
      if (tops.every((t, i) => t === bots[i])) return;
      for (let i = 1; i < ps.length - 1; i++) {
        addTri(tops[0], tops[i], tops[i + 1]); // top face, normal +z
        addTri(bots[0], bots[i + 1], bots[i]); // bottom face, normal -z
      }
      // Perimeter walls on polygon edges that lie on an outer triangle edge
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        for (let e = 0; e < 3; e++) {
          if (!perimeter[e]) continue;
          const k = (e + 2) % 3; // node opposite edge e (nodes e -> e+1)
          if (poly[i].w[k] === 0 && poly[j].w[k] === 0) {
            addTri(bots[i], bots[j], tops[j]);
            addTri(bots[i], tops[j], tops[i]);
          }
        }
      }
    };

    emit(sloped);
    emit(cap);
  };

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (!isValidQuad(c, r)) continue;
      const i00 = r * cols + c;
      const i10 = r * cols + c + 1;
      const i01 = (r + 1) * cols + c;
      const i11 = (r + 1) * cols + c + 1;

      // T1 = (n00, n01, n10): edges 0->1 left, 1->2 diagonal, 2->0 top
      processTriangle(
        [i00, i01, i10],
        [c, c, c + 1],
        [r, r + 1, r],
        [!isValidQuad(c - 1, r), false, !isValidQuad(c, r - 1)]
      );
      // T2 = (n10, n01, n11): edges 0->1 diagonal, 1->2 bottom, 2->0 right
      processTriangle(
        [i10, i01, i11],
        [c + 1, c, c + 1],
        [r, r + 1, r + 1],
        [false, !isValidQuad(c, r + 1), !isValidQuad(c + 1, r)]
      );
    }
  }

  return { verticesXml, trianglesXml, faceCount: trianglesXml.length };
}
