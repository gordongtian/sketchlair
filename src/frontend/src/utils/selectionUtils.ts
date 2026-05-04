// ─── Chaikin curve smoothing ──────────────────────────────────────────────────
/**
 * Apply Chaikin's corner-cutting algorithm to smooth a polyline.
 * Each pass replaces every segment (P0→P1) with two new points:
 *   Q = 0.25·P0 + 0.75·P1   (¾ of the way from P0 to P1)
 *   R = 0.75·P0 + 0.25·P1   (¼ of the way from P0 to P1)
 * The first and last points are preserved so the path endpoints don't drift.
 * 2–3 passes give a natural smooth curve without destroying tight corners.
 */
export function chaikinSmooth(
  points: { x: number; y: number }[],
  iterations = 2,
): { x: number; y: number }[] {
  if (points.length < 3) return points;
  let pts = points;
  for (let iter = 0; iter < iterations; iter++) {
    const out: { x: number; y: number }[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      out.push(
        { x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y },
        { x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y },
      );
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

// ─── Perceptual color distance ────────────────────────────────────────────────
/**
 * Weighted RGB distance approximating human perceptual difference.
 * The human eye is most sensitive to green and least sensitive to blue.
 * distance = sqrt(2·ΔR² + 4·ΔG² + 3·ΔB²)
 */
function perceptualDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

/** Un-premultiply a pixel's RGB by its alpha (browser canvas stores premultiplied). */
function unpremultiply(
  r: number,
  g: number,
  b: number,
  a: number,
): [number, number, number] {
  if (a === 0) return [0, 0, 0];
  return [
    Math.round((r * 255) / a),
    Math.round((g * 255) / a),
    Math.round((b * 255) / a),
  ];
}

/**
 * Hermite smooth step: maps t ∈ [0,1] to a smoothly interpolated weight.
 * Result has zero derivative at both ends — eliminates banding at the transition.
 */
function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Compute soft selection weight for a pixel given its color distance and the
 * active tolerance.  Returns 1.0 (fully selected) when well within tolerance,
 * 0.0 (not selected) when clearly outside, and a smooth blend in the
 * transition band (tolerance × [0.85, 1.15]).
 */
function smoothWeight(distance: number, tolerance: number): number {
  if (tolerance <= 0) return distance === 0 ? 1.0 : 0.0;
  const lower = tolerance * 0.85;
  const upper = tolerance * 1.15;
  if (distance <= lower) return 1.0;
  if (distance >= upper) return 0.0;
  const t = (upper - distance) / (upper - lower);
  return smoothStep(t);
}

// ─── Post-processing: erosion on transition region ───────────────────────────
// biome-ignore lint/correctness/noUnusedVariables: kept for potential future use — do not call from magicWandFloodFill
function erodeTransition(
  mask: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const w = mask[idx];
      if (w <= 0.1 || w >= 0.9) continue; // only transition band
      // Check 4-neighbors: if any neighbor < 0.15, reduce this pixel's weight
      let minNeighbor = 1.0;
      if (x > 0) minNeighbor = Math.min(minNeighbor, mask[idx - 1]);
      if (x < width - 1) minNeighbor = Math.min(minNeighbor, mask[idx + 1]);
      if (y > 0) minNeighbor = Math.min(minNeighbor, mask[idx - width]);
      if (y < height - 1)
        minNeighbor = Math.min(minNeighbor, mask[idx + width]);
      if (minNeighbor < 0.15) {
        out[idx] = Math.max(0.0, w - 0.3);
      }
    }
  }
  return out;
}

// ─── Post-processing: Gaussian blur on transition region only ─────────────────
// Separable 5-tap Gaussian kernel for sigma ≈ 1.5
const GAUSS_KERNEL = [0.0625, 0.25, 0.375, 0.25, 0.0625];

function gaussianBlurTransition(
  mask: Float32Array,
  width: number,
  height: number,
): Float32Array {
  // First find which pixels are in / near transition band
  const isTransition = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = mask[y * width + x];
      if (w > 0.05 && w < 0.95) {
        // Mark this pixel and its 2-pixel neighborhood
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              isTransition[ny * width + nx] = 1;
            }
          }
        }
      }
    }
  }

  // Horizontal pass
  const tmp = new Float32Array(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!isTransition[idx]) continue;
      let sum = 0;
      let wsum = 0;
      for (let k = 0; k < 5; k++) {
        const nx = x + k - 2;
        if (nx >= 0 && nx < width) {
          sum += mask[y * width + nx] * GAUSS_KERNEL[k];
          wsum += GAUSS_KERNEL[k];
        }
      }
      tmp[idx] = wsum > 0 ? sum / wsum : mask[idx];
    }
  }

  // Vertical pass
  const out = new Float32Array(tmp);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!isTransition[idx]) continue;
      let sum = 0;
      let wsum = 0;
      for (let k = 0; k < 5; k++) {
        const ny = y + k - 2;
        if (ny >= 0 && ny < height) {
          sum += tmp[ny * width + x] * GAUSS_KERNEL[k];
          wsum += GAUSS_KERNEL[k];
        }
      }
      const blurred = wsum > 0 ? sum / wsum : tmp[idx];
      // Only apply blur to transition pixels — preserve exact 0.0 and 1.0
      const orig = mask[idx];
      if (orig >= 0.95) {
        out[idx] = orig; // keep fully selected
      } else if (orig <= 0.05) {
        out[idx] = orig; // keep fully unselected
      } else {
        out[idx] = Math.max(0.0, Math.min(1.0, blurred));
      }
    }
  }
  return out;
}

// ─── Magic wand scanline flood fill (returns Float32Array) ───────────────────
/**
 * Scanline flood fill for the magic wand tool.
 * Returns a Float32Array (one float per pixel, 0.0–1.0) representing soft selection weights.
 *
 * Uses perceptual color distance and Hermite smooth weighting for natural soft edges.
 * Includes edge post-processing: erosion then Gaussian blur on transition band only.
 *
 * @param srcData  - RGBA Uint8ClampedArray from the active layer canvas
 * @param width    - canvas width
 * @param height   - canvas height
 * @param seedX    - x coordinate of the seed pixel
 * @param seedY    - y coordinate of the seed pixel
 * @param tolerance - color distance threshold (0–255, used directly)
 * @param contiguous - true = scanline flood fill; false = all-matching scan
 */
export function magicWandFloodFill(
  srcData: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance: number,
  contiguous: boolean,
): Float32Array {
  const sidx = (seedY * width + seedX) * 4;
  const seedA = srcData[sidx + 3];
  const transparentMode = seedA < 10;

  // Seed color (unpremultiplied)
  const [seedR, seedG, seedB] = transparentMode
    ? [0, 0, 0]
    : unpremultiply(srcData[sidx], srcData[sidx + 1], srcData[sidx + 2], seedA);

  /**
   * Get the selection weight for a pixel at index i in srcData.
   */
  function getWeight(pixelIdx: number): number {
    const pi = pixelIdx * 4;
    const a = srcData[pi + 3];
    if (transparentMode) {
      return a < 10 ? 1.0 : 0.0;
    }
    if (a < 10) return 0.0;
    // Alpha proximity check: if alpha differs too much, treat as different
    if (Math.abs(a - seedA) > 30) return 0.0;
    const [r, g, b] = unpremultiply(
      srcData[pi],
      srcData[pi + 1],
      srcData[pi + 2],
      a,
    );
    const dist = perceptualDistance(r, g, b, seedR, seedG, seedB);
    return smoothWeight(dist, tolerance);
  }

  let rawMask: Float32Array;

  if (!contiguous) {
    // All-matching mode: scan every pixel, no connectivity check
    rawMask = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      rawMask[i] = getWeight(i);
    }
  } else {
    // Contiguous mode: scanline span-fill
    rawMask = new Float32Array(width * height);
    const visited = new Uint8Array(width * height);

    // Cutoff weight below which a pixel is treated as a boundary (stops the span)
    const TRAVERSAL_CUTOFF = 0.02;

    // Stack of {x, y} seed points to expand from
    const stack: number[] = [];
    stack.push(seedY * width + seedX);

    while (stack.length > 0) {
      const pos = stack.pop()!;
      const sy = Math.floor(pos / width);
      const sx = pos % width;

      if (visited[pos]) continue;
      if (getWeight(pos) <= TRAVERSAL_CUTOFF) continue;

      // Walk left to find the leftmost matching pixel in this span
      let lx = sx;
      while (lx > 0 && getWeight(sy * width + lx - 1) > TRAVERSAL_CUTOFF) {
        lx--;
      }

      // Walk right to find the rightmost matching pixel in this span
      let rx = sx;
      while (
        rx < width - 1 &&
        getWeight(sy * width + rx + 1) > TRAVERSAL_CUTOFF
      ) {
        rx++;
      }

      // Fill entire span and queue rows above/below
      for (let cx = lx; cx <= rx; cx++) {
        const cidx = sy * width + cx;
        if (!visited[cidx]) {
          visited[cidx] = 1;
          rawMask[cidx] = getWeight(cidx);
        }
        // Queue pixels above
        if (sy > 0) {
          const aboveIdx = (sy - 1) * width + cx;
          if (!visited[aboveIdx] && getWeight(aboveIdx) > TRAVERSAL_CUTOFF) {
            stack.push(aboveIdx);
          }
        }
        // Queue pixels below
        if (sy < height - 1) {
          const belowIdx = (sy + 1) * width + cx;
          if (!visited[belowIdx] && getWeight(belowIdx) > TRAVERSAL_CUTOFF) {
            stack.push(belowIdx);
          }
        }
      }
    }
  }

  // Post-processing: Gaussian blur on transition band only (erosion removed — was causing ghost outlines)
  const blurred = gaussianBlurTransition(rawMask, width, height);
  return blurred;
}

// ─── Fill tool BFS flood fill ─────────────────────────────────────────────────
/**
 * Binary scanline flood fill used by the fill tool.
 * Returns Uint8Array (1 = filled, 0 = not filled).
 * Uses perceptual color distance (matching magic wand formula).
 */
export function bfsFloodFill(
  srcData: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  tolerance: number, // fill tool's own scale (0–100)
  contiguous: boolean,
  selMask?: Uint8ClampedArray | null,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const sidx = (sy * width + sx) * 4;
  const sa = srcData[sidx + 3];

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
  // Use perceptual distance (matching magic wand). tolerance 0–100 maps to 0–255 scale.
  const tol = (tolerance / 100) * 255;

  const matches = (i: number): boolean => {
    const a = srcData[i + 3];
    if (a === 0) return false;
    const [r, g, b] = unprem(srcData[i], srcData[i + 1], srcData[i + 2], a);
    const dr = r - seedR;
    const dg = g - seedG;
    const db = b - seedB;
    const dist = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
    return dist <= tol;
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

// ─── Phase 2: destination-over expansion for fill tool ───────────────────────
/**
 * After a flood fill, expand the filled region outward by 1 pixel and composite
 * the fill color UNDERNEATH existing pixels (destination-over blending).
 *
 * This closes the gap between the fill and anti-aliased line edges:
 * - Fully opaque line pixels (alpha=255): destination-over = zero visible change
 * - Fully transparent pixels (alpha=0): fill color appears at full opacity
 * - Semi-transparent edge pixels: fill color shows through proportionally
 *
 * @param data       - RGBA pixel array (modified in place)
 * @param width      - canvas width
 * @param height     - canvas height
 * @param filledMask - Uint8Array from bfsFloodFill (1 = filled)
 * @param fr/fg/fb/fa - fill color RGBA (0–255)
 * @param seedR/G/B  - seed pixel color (unpremultiplied), used for skip condition
 * @param tolerance  - fill tolerance (0–100 scale), used for skip condition
 */
export function applyDestinationOverExpansion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  filledMask: Uint8Array,
  fr: number,
  fg: number,
  fb: number,
  fa: number,
  seedR: number,
  seedG: number,
  seedB: number,
  tolerance: number,
): void {
  // Convert tolerance to perceptual distance scale (matching bfsFloodFill)
  const tol = (tolerance / 100) * 255;
  const expansionTol = tol * 1.5;

  // Collect expansion zone pixels: unfilled 8-neighbors of filled pixels
  // Use a Uint8Array as a fast set (1 = in expansion zone)
  const expansionZone = new Uint8Array(width * height);
  const unprem = (r: number, g: number, b: number, a: number) => {
    if (a === 0) return [0, 0, 0] as [number, number, number];
    return [
      Math.round((r * 255) / a),
      Math.round((g * 255) / a),
      Math.round((b * 255) / a),
    ] as [number, number, number];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!filledMask[idx]) continue;
      // Check 8 neighbors
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nidx = ny * width + nx;
          if (filledMask[nidx]) continue; // already filled — skip
          if (expansionZone[nidx]) continue; // already queued

          // Skip condition: fully opaque AND color distance > tolerance × 1.5
          const pi = nidx * 4;
          const existingA = data[pi + 3];
          if (existingA === 255) {
            const [er, eg, eb] = unprem(
              data[pi],
              data[pi + 1],
              data[pi + 2],
              existingA,
            );
            const dr = er - seedR;
            const dg = eg - seedG;
            const db = eb - seedB;
            const dist = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
            if (dist > expansionTol) continue; // hard boundary pixel — skip
          }

          expansionZone[nidx] = 1;
        }
      }
    }
  }

  // Compute bounding box of expansion zone for batched getImageData
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (expansionZone[y * width + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return; // no expansion pixels

  // Apply destination-over math directly into the data array
  // data already contains the canvas pixel data (modified by Phase 1)
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * width + x;
      if (!expansionZone[idx]) continue;

      const pi = idx * 4;
      const eA = data[pi + 3];
      const eR = data[pi];
      const eG = data[pi + 1];
      const eB = data[pi + 2];

      // destination-over:
      // outA = eA + fillA × (1 - eA/255)
      // outR = (eR × eA + fillR × fillA × (1 - eA/255)) / outA
      const oneMinusEA = 1 - eA / 255;
      const outA = eA + fa * oneMinusEA;
      if (outA < 1) continue; // leave fully transparent pixels untouched

      data[pi + 3] = Math.round(outA);
      data[pi] = Math.round((eR * eA + fr * fa * oneMinusEA) / outA);
      data[pi + 1] = Math.round((eG * eA + fg * fa * oneMinusEA) / outA);
      data[pi + 2] = Math.round((eB * eA + fb * fa * oneMinusEA) / outA);
    }
  }
}

// ─── Edge expansion for float masks (magic wand) ──────────────────────────────
/**
 * Expand a Float32Array selection mask outward by `radius` pixels.
 * Each iteration spreads selected pixels one pixel further using 8-neighbor connectivity.
 * Expanded pixels receive a weight slightly lower than their source pixel (subtract 0.2 per step),
 * so the transition stays smooth. After all iterations, all values are clamped to [0.0, 1.0].
 *
 * This is the equivalent of Photoshop "Select > Modify > Expand" — pushes the selection
 * boundary into the anti-aliased line transition pixels to eliminate ghost outlines.
 *
 * @param mask   - Float32Array of selection weights (0.0–1.0), one per pixel
 * @param width  - canvas width
 * @param height - canvas height
 * @param radius - number of pixels to expand outward (0 = no-op)
 */
export function expandFloatMask(
  mask: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius <= 0) return mask;
  let cur = new Float32Array(mask);
  for (let iter = 0; iter < radius; iter++) {
    const next = new Float32Array(cur);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (cur[idx] < 0.1) continue; // only spread from pixels with meaningful weight
        // Check all 8 neighbors and expand with reduced weight
        const expandedWeight = cur[idx] - 0.05;
        if (expandedWeight <= 0) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nidx = ny * width + nx;
            if (next[nidx] < expandedWeight) {
              next[nidx] = expandedWeight;
            }
          }
        }
      }
    }
    cur = next;
  }
  // Clamp all values to [0.0, 1.0]
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] > 1.0) cur[i] = 1.0;
    else if (cur[i] < 0.0) cur[i] = 0.0;
  }
  return cur;
}

// ─── Grow/shrink for float masks (magic wand) ─────────────────────────────────
/**
 * Grow (positive) or shrink (negative) a Float32Array selection mask.
 * Each iteration dilates or erodes by one pixel using 4-neighbor connectivity.
 * Preserves float weights: grown pixels inherit the maximum neighbor weight,
 * eroded pixels are zeroed when any 4-neighbor is zero.
 */
export function growShrinkFloatMask(
  mask: Float32Array,
  width: number,
  height: number,
  pixels: number,
): Float32Array {
  if (pixels === 0) return mask;
  let cur = new Float32Array(mask);
  const iters = Math.abs(pixels);
  const grow = pixels > 0;
  for (let iter = 0; iter < iters; iter++) {
    const next = new Float32Array(cur);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (grow) {
          if (cur[idx] < 1.0) {
            // Dilate: take max of neighbors
            let maxN = cur[idx];
            if (x > 0) maxN = Math.max(maxN, cur[idx - 1]);
            if (x < width - 1) maxN = Math.max(maxN, cur[idx + 1]);
            if (y > 0) maxN = Math.max(maxN, cur[idx - width]);
            if (y < height - 1) maxN = Math.max(maxN, cur[idx + width]);
            next[idx] = maxN;
          }
        } else {
          if (cur[idx] > 0.0) {
            // Erode: zero if any 4-neighbor is zero
            const onEdge =
              x === 0 || x === width - 1 || y === 0 || y === height - 1;
            if (
              onEdge ||
              cur[idx - 1] === 0 ||
              cur[idx + 1] === 0 ||
              cur[idx - width] === 0 ||
              cur[idx + width] === 0
            ) {
              next[idx] = 0.0;
            }
          }
        }
      }
    }
    cur = next;
  }
  return cur;
}

// ─── Legacy grow/shrink (binary, fill tool) ───────────────────────────────────
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
      if (data[(y * W + x) * 4 + 3] > 26) {
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
