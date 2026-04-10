// ─── Shared BFS flood fill utility ───────────────────────────────────────────
export function bfsFloodFill(
  srcData: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  tolerance: number, // 0–100 scale
  contiguous: boolean,
  selMask?: Uint8ClampedArray | null,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const sidx = (sy * width + sx) * 4;
  const sa = srcData[sidx + 3];

  // When seed is transparent, fill all connected transparent pixels
  const fillTransparent = sa === 0;

  if (fillTransparent) {
    if (contiguous) {
      const visited = new Uint8Array(width * height);
      const stack = [sx + sy * width];
      while (stack.length > 0) {
        const pos = stack.pop()!;
        const cx = pos % width;
        const cy = Math.floor(pos / width);
        if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
        if (visited[pos]) continue;
        visited[pos] = 1;
        const pi = pos * 4;
        if (srcData[pi + 3] !== 0) continue;
        if (selMask && selMask[pi + 3] < 128) continue;
        mask[pos] = 1;
        stack.push(pos + 1, pos - 1, pos + width, pos - width);
      }
    } else {
      for (let i = 0; i < width * height; i++) {
        const pi = i * 4;
        if (selMask && selMask[pi + 3] < 128) continue;
        if (srcData[pi + 3] === 0) mask[i] = 1;
      }
    }
    return mask;
  }

  const unprem = (r: number, g: number, b: number, a: number) => {
    if (a === 0) return [0, 0, 0] as const;
    return [
      Math.round((r * 255) / a),
      Math.round((g * 255) / a),
      Math.round((b * 255) / a),
    ] as const;
  };

  const [seedR, seedG, seedB] = unprem(
    srcData[sidx],
    srcData[sidx + 1],
    srcData[sidx + 2],
    sa,
  );
  const tol = (tolerance / 100) * 255;

  const matches = (i: number): boolean => {
    const a = srcData[i + 3];
    if (a === 0) return false;
    const [r, g, b] = unprem(srcData[i], srcData[i + 1], srcData[i + 2], a);
    return (
      Math.abs(r - seedR) <= tol &&
      Math.abs(g - seedG) <= tol &&
      Math.abs(b - seedB) <= tol
    );
  };

  if (contiguous) {
    const visited = new Uint8Array(width * height);
    const stack = [sx + sy * width];
    while (stack.length > 0) {
      const pos = stack.pop()!;
      const cx = pos % width;
      const cy = Math.floor(pos / width);
      if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
      if (visited[pos]) continue;
      visited[pos] = 1;
      const pi = pos * 4;
      if (!matches(pi)) continue;
      if (selMask && selMask[pi + 3] < 128) continue;
      mask[pos] = 1;
      stack.push(pos + 1, pos - 1, pos + width, pos - width);
    }
  } else {
    for (let i = 0; i < width * height; i++) {
      const pi = i * 4;
      if (selMask && selMask[pi + 3] < 128) continue;
      if (matches(pi)) mask[i] = 1;
    }
  }
  return mask;
}

export function growShrinkMask(
  mask: Uint8Array,
  width: number,
  height: number,
  pixels: number,
): Uint8Array {
  if (pixels === 0) return mask;
  let cur = new Uint8Array(mask);
  const iters = Math.abs(pixels);
  const grow = pixels > 0;
  for (let iter = 0; iter < iters; iter++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (grow) {
          // dilate: select if any 4-neighbor is selected
          if (!cur[idx]) {
            if (
              (x > 0 && cur[idx - 1]) ||
              (x < width - 1 && cur[idx + 1]) ||
              (y > 0 && cur[idx - width]) ||
              (y < height - 1 && cur[idx + width])
            ) {
              next[idx] = 1;
            }
          }
        } else {
          // erode: deselect if any 4-neighbor is unselected
          if (cur[idx]) {
            if (
              x === 0 ||
              x === width - 1 ||
              y === 0 ||
              y === height - 1 ||
              !cur[idx - 1] ||
              !cur[idx + 1] ||
              !cur[idx - width] ||
              !cur[idx + width]
            ) {
              next[idx] = 0;
            }
          }
        }
      }
    }
    cur = next;
  }
  return cur;
}

// Scan a mask canvas for tight pixel bounds. Returns null if the mask is empty.
export function computeMaskBounds(
  mask: HTMLCanvasElement,
): { x: number; y: number; w: number; h: number } | null {
  const ctx = mask.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const W = mask.width;
  const H = mask.height;
  const data = ctx.getImageData(0, 0, W, H).data;
  let minX = W;
  let minY = H;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 64) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  return found
    ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    : null;
}
