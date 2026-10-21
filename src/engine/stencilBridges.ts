/**
 * Stencil bridges for numerals cut through the print.
 *
 * Cutting "0", "4", "6", "8" or "9" right through a plate leaves the middle of the letter as a loose
 * island that would fall out. Like a real stencil, each island gets a short bridge across the cut back
 * to the rest of the print. Bridges are found on the grid: the shortest path through cut cells from the
 * island to the main body, widened so it is at least `halfWidth * 2 + 1` cells (a printable strip).
 */

/** 4-connected component labels of `solid`; returns the labels and each component's size. */
function label(solid: Uint8Array, cols: number, rows: number): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(cols * rows).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < solid.length; start++) {
    if (!solid[start] || labels[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const c = i % cols;
      const r = (i - c) / cols;
      const next = [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1];
      for (const n of next) {
        if (n >= 0 && solid[n] && labels[n] === -1) {
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/**
 * Returns the cut cells to fill back in so every island of `solid` that is cut off by `cut` cells is
 * joined to the largest piece. Islands that are separate for other reasons (not reachable through
 * cut cells) are left alone.
 */
export function stencilBridges(solid: Uint8Array, cut: Uint8Array, cols: number, rows: number, halfWidth = 1): Uint8Array {
  const restore = new Uint8Array(cols * rows);
  const { labels, sizes } = label(solid, cols, rows);
  if (sizes.length < 2) return restore;
  const main = sizes.indexOf(Math.max(...sizes));
  const joined = new Uint8Array(cols * rows);
  for (let i = 0; i < joined.length; i++) if (labels[i] === main) joined[i] = 1;

  const prev = new Int32Array(cols * rows);
  for (let island = 0; island < sizes.length; island++) {
    if (island === main) continue;
    // Skip islands an earlier bridge already joined
    let start = -1;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === island) {
        start = i;
        break;
      }
    }
    if (start < 0 || joined[start]) continue;

    // Breadth-first search from the whole island through cut cells until the joined body is reached
    prev.fill(-2);
    const queue: number[] = [];
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === island) {
        prev[i] = -1;
        queue.push(i);
      }
    }
    let hit = -1;
    for (let q = 0; q < queue.length && hit < 0; q++) {
      const i = queue[q];
      const c = i % cols;
      const r = (i - c) / cols;
      const next = [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1];
      for (const n of next) {
        if (n < 0 || prev[n] !== -2) continue;
        if (joined[n]) {
          prev[n] = i;
          hit = n;
          break;
        }
        if (cut[n]) {
          prev[n] = i;
          queue.push(n);
        }
      }
    }
    if (hit < 0) continue;

    // Fill the path back in, widened to a printable strip
    for (let i = prev[hit]; i >= 0 && labels[i] !== island; i = prev[i]) {
      const c = i % cols;
      const r = (i - c) / cols;
      for (let dr = -halfWidth; dr <= halfWidth; dr++) {
        for (let dc = -halfWidth; dc <= halfWidth; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          const n = rr * cols + cc;
          if (cut[n]) {
            restore[n] = 1;
            joined[n] = 1;
          }
        }
      }
    }
    for (let i = 0; i < labels.length; i++) if (labels[i] === island) joined[i] = 1;
  }
  return restore;
}
