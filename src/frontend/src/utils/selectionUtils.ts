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

/**
 * Grow or shrink a binary mask using a TRUE CIRCULAR structuring element.
 *
 * pixels > 0 → dilation by |pixels| pixel radius
 * pixels < 0 → erosion  by |pixels| pixel radius
 *
 * Circular check: a neighbor Q at offset (dx, dy) is within the structuring
 * element if sqrt(dx² + dy²) <= R, i.e. dx² + dy² <= R².
 * This replaces the old 4-neighbor iteration that produced axis-aligned artifacts.
 *
 * Two-pass (input → output) to avoid in-place propagation artifacts.
 */
export function growShrinkMask(
  mask: Uint8Array,
  width: number,
  height: number,
  pixels: number,
): Uint8Array {
  if (pixels === 0) return mask;

  const R = Math.abs(pixels);
  const R2 = R * R;
  const grow = pixels > 0;

  const input = new Uint8Array(mask);
  const output = new Uint8Array(mask); // copy so unchanged pixels stay same

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      if (grow) {
        // Dilation: mark unselected pixel as selected if any neighbor within
        // the circular radius is selected.
        if (input[idx]) continue; // already selected — keep as is
        const minY = Math.max(0, y - R);
        const maxY = Math.min(height - 1, y + R);
        const minX = Math.max(0, x - R);
        const maxX = Math.min(width - 1, x + R);
        let found = false;
        for (let ny = minY; ny <= maxY && !found; ny++) {
          for (let nx = minX; nx <= maxX && !found; nx++) {
            const dx = nx - x;
            const dy = ny - y;
            if (dx * dx + dy * dy <= R2 && input[ny * width + nx]) {
              found = true;
            }
          }
        }
        if (found) output[idx] = 1;
      } else {
        // Erosion: deselect a selected pixel if any neighbor within the
        // circular radius is NOT selected (including out-of-bounds → treated as 0).
        if (!input[idx]) continue; // already unselected — keep as is
        const minY = Math.max(0, y - R);
        const maxY = Math.min(height - 1, y + R);
        const minX = Math.max(0, x - R);
        const maxX = Math.min(width - 1, x + R);
        // Out-of-bounds neighbor counts as unselected → immediate erosion
        if (y - R < 0 || y + R >= height || x - R < 0 || x + R >= width) {
          output[idx] = 0;
          continue;
        }
        let erode = false;
        for (let ny = minY; ny <= maxY && !erode; ny++) {
          for (let nx = minX; nx <= maxX && !erode; nx++) {
            const dx = nx - x;
            const dy = ny - y;
            if (dx * dx + dy * dy <= R2 && !input[ny * width + nx]) {
              erode = true;
            }
          }
        }
        if (erode) output[idx] = 0;
      }
    }
  }

  return output;
}

// ─── Perceptual color distance (weighted RGB, accounts for human perception) ──
/**
 * Computes perceptual color distance using a weighted RGB approach.
 * weightedDistance = sqrt(2*ΔR² + 4*ΔG² + 3*ΔB²)
 * Produces more intuitive results than simple Euclidean RGB distance.
 */
export function perceptualColorDistance(
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

// ─── Distance transform (2-pass chamfer approximation) ────────────────────────
/**
 * Computes approximate Euclidean distance to nearest boundary pixel for each pixel.
 * Uses a 2-pass chamfer distance transform (top-left sweep, then bottom-right sweep).
 * Result[i] = 0 for boundary pixels, positive float for non-boundary pixels.
 */
export function computeDistanceTransform(
  boundaryMask: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const dist = new Float32Array(width * height).fill(Number.POSITIVE_INFINITY);

  // Seed boundary pixels at 0
  for (let i = 0; i < width * height; i++) {
    if (boundaryMask[i]) dist[i] = 0;
  }

  // Pass 1: top-left to bottom-right
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (boundaryMask[idx]) continue;
      // Check top and left neighbors
      if (y > 0) {
        const top = dist[(y - 1) * width + x] + 1;
        if (top < dist[idx]) dist[idx] = top;
      }
      if (x > 0) {
        const left = dist[y * width + x - 1] + 1;
        if (left < dist[idx]) dist[idx] = left;
      }
      // Diagonal neighbors (√2)
      if (y > 0 && x > 0) {
        const topLeft = dist[(y - 1) * width + (x - 1)] + Math.SQRT2;
        if (topLeft < dist[idx]) dist[idx] = topLeft;
      }
      if (y > 0 && x < width - 1) {
        const topRight = dist[(y - 1) * width + (x + 1)] + Math.SQRT2;
        if (topRight < dist[idx]) dist[idx] = topRight;
      }
    }
  }

  // Pass 2: bottom-right to top-left
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const idx = y * width + x;
      if (boundaryMask[idx]) continue;
      if (y < height - 1) {
        const bottom = dist[(y + 1) * width + x] + 1;
        if (bottom < dist[idx]) dist[idx] = bottom;
      }
      if (x < width - 1) {
        const right = dist[y * width + x + 1] + 1;
        if (right < dist[idx]) dist[idx] = right;
      }
      if (y < height - 1 && x < width - 1) {
        const bottomRight = dist[(y + 1) * width + (x + 1)] + Math.SQRT2;
        if (bottomRight < dist[idx]) dist[idx] = bottomRight;
      }
      if (y < height - 1 && x > 0) {
        const bottomLeft = dist[(y + 1) * width + (x - 1)] + Math.SQRT2;
        if (bottomLeft < dist[idx]) dist[idx] = bottomLeft;
      }
    }
  }

  return dist;
}

// ─── Morphological dilation by radius ─────────────────────────────────────────
/**
 * Returns new ImageData with boundary pixels expanded outward by radius pixels.
 * For radius < 10: uses simple nested loop neighbor scan.
 * For radius >= 10: uses distance transform for efficiency.
 * Non-boundary pixels within radius of any boundary pixel become
 * copies of the nearest boundary pixel's color.
 */
export function dilateByRadius(
  src: ImageData,
  boundaryMask: Uint8Array,
  radius: number,
  width: number,
  height: number,
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(src.data), width, height);

  if (radius <= 0) return out;

  if (radius < 10) {
    // Simple neighbor scan approach
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (boundaryMask[idx]) continue; // already a boundary pixel

        // Search in a square neighborhood of size (2*radius+1)
        let nearestDist = Number.POSITIVE_INFINITY;
        let nearestIdx = -1;

        const minY = Math.max(0, y - radius);
        const maxY = Math.min(height - 1, y + radius);
        const minX = Math.max(0, x - radius);
        const maxX = Math.min(width - 1, x + radius);

        for (let ny = minY; ny <= maxY; ny++) {
          for (let nx = minX; nx <= maxX; nx++) {
            const nidx = ny * width + nx;
            if (!boundaryMask[nidx]) continue;
            const dx = nx - x;
            const dy = ny - y;
            const d = dx * dx + dy * dy;
            if (d <= radius * radius && d < nearestDist) {
              nearestDist = d;
              nearestIdx = nidx;
            }
          }
        }

        if (nearestIdx >= 0) {
          const pi = idx * 4;
          const ni = nearestIdx * 4;
          out.data[pi] = src.data[ni];
          out.data[pi + 1] = src.data[ni + 1];
          out.data[pi + 2] = src.data[ni + 2];
          out.data[pi + 3] = src.data[ni + 3];
        }
      }
    }
  } else {
    // Distance transform approach for large radii
    const dist = computeDistanceTransform(boundaryMask, width, height);

    // For each non-boundary pixel within radius, copy nearest boundary pixel color
    // We also need to track nearest boundary pixel index — do a second pass using
    // the distance transform to propagate source indices
    const nearestIdx = new Int32Array(width * height).fill(-1);

    // Seed with boundary pixel indices
    for (let i = 0; i < width * height; i++) {
      if (boundaryMask[i]) nearestIdx[i] = i;
    }

    // Pass 1: top-left to bottom-right — propagate nearest index
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (boundaryMask[idx]) continue;
        if (dist[idx] > radius) continue;

        const candidates: number[] = [];
        if (y > 0) candidates.push((y - 1) * width + x);
        if (x > 0) candidates.push(y * width + x - 1);
        if (y > 0 && x > 0) candidates.push((y - 1) * width + x - 1);
        if (y > 0 && x < width - 1) candidates.push((y - 1) * width + x + 1);

        let best = Number.POSITIVE_INFINITY;
        for (const c of candidates) {
          if (nearestIdx[c] >= 0 && dist[c] < best) {
            best = dist[c];
            nearestIdx[idx] = nearestIdx[c];
          }
        }
      }
    }

    // Pass 2: bottom-right to top-left — propagate nearest index
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const idx = y * width + x;
        if (boundaryMask[idx]) continue;
        if (dist[idx] > radius) continue;

        const candidates: number[] = [];
        if (y < height - 1) candidates.push((y + 1) * width + x);
        if (x < width - 1) candidates.push(y * width + x + 1);
        if (y < height - 1 && x < width - 1)
          candidates.push((y + 1) * width + x + 1);
        if (y < height - 1 && x > 0) candidates.push((y + 1) * width + x - 1);

        let best =
          nearestIdx[idx] >= 0
            ? dist[nearestIdx[idx]]
            : Number.POSITIVE_INFINITY;
        for (const c of candidates) {
          if (nearestIdx[c] >= 0 && dist[c] < best) {
            best = dist[c];
            nearestIdx[idx] = nearestIdx[c];
          }
        }
      }
    }

    // Apply dilation: copy color from nearest boundary pixel
    for (let i = 0; i < width * height; i++) {
      if (boundaryMask[i]) continue;
      if (dist[i] > radius) continue;
      const ni = nearestIdx[i];
      if (ni < 0) continue;
      const pi = i * 4;
      const npi = ni * 4;
      out.data[pi] = src.data[npi];
      out.data[pi + 1] = src.data[npi + 1];
      out.data[pi + 2] = src.data[npi + 2];
      out.data[pi + 3] = src.data[npi + 3];
    }
  }

  return out;
}

// ─── Edge-only Gaussian blur on float mask ────────────────────────────────────
/**
 * Applies a small Gaussian/box blur only to transition pixels (0.05–0.95).
 * Fully selected (>= 0.95) and fully unselected (<= 0.05) pixels are not blurred.
 * This preserves sharp interiors while softening selection edges.
 */
export function blurEdgesOnly(
  mask: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const out = new Float32Array(mask);
  const r = Math.max(1, Math.round(radius));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const v = mask[idx];
      // Only blur edge/transition pixels
      if (v <= 0.05 || v >= 0.95) continue;

      // Box blur over (2r+1)² neighborhood
      let sum = 0;
      let count = 0;
      const minY = Math.max(0, y - r);
      const maxY = Math.min(height - 1, y + r);
      const minX = Math.max(0, x - r);
      const maxX = Math.min(width - 1, x + r);

      for (let ny = minY; ny <= maxY; ny++) {
        for (let nx = minX; nx <= maxX; nx++) {
          sum += mask[ny * width + nx];
          count++;
        }
      }

      out[idx] = sum / count;
    }
  }

  return out;
}

// ─── Float mask → HTMLCanvasElement (for selection system compatibility) ──────
/**
 * Converts a float mask (0.0–1.0) to an HTMLCanvasElement with white pixels.
 * Pixels with mask >= 0.5 become white (255,255,255) with alpha = mask * 255.
 * Pixels with mask < 0.5 become transparent.
 * Supports soft edge compositing while remaining compatible with white-pixel
 * selection tools that check for white pixel presence.
 */
export function floatMaskToCanvas(
  mask: Float32Array,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let i = 0; i < width * height; i++) {
    const v = mask[i];
    if (v >= 0.5) {
      const pi = i * 4;
      data[pi] = 255;
      data[pi + 1] = 255;
      data[pi + 2] = 255;
      data[pi + 3] = Math.round(v * 255);
    }
    // else: transparent (default zero)
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ─── Boundary pixel detection (for gap closing preprocessing) ─────────────────
/**
 * Returns a Uint8Array where 1 = boundary pixel, 0 = non-boundary.
 * Boundary pixels are those with:
 *   - alpha > alphaThreshold, OR
 *   - perceptual color distance from seed color > colorThreshold
 * This identifies linework and obstructions that define fill regions.
 */
export function extractBoundaryMask(
  imageData: ImageData,
  seedR: number,
  seedG: number,
  seedB: number,
  alphaThreshold = 20,
  colorThreshold = 30,
): Uint8Array {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const pi = i * 4;
    const a = data[pi + 3];

    if (a > alphaThreshold) {
      // Unpremultiply to get true color
      const r = a > 0 ? Math.round((data[pi] * 255) / a) : 0;
      const g = a > 0 ? Math.round((data[pi + 1] * 255) / a) : 0;
      const b = a > 0 ? Math.round((data[pi + 2] * 255) / a) : 0;
      const dist = perceptualColorDistance(r, g, b, seedR, seedG, seedB);
      if (dist > colorThreshold) {
        mask[i] = 1;
      } else {
        // Alpha above threshold but color matches seed — this is a semi-transparent
        // pixel of the fill color, not a boundary. Still mark as boundary if alpha is high.
        // We mark as boundary only if alpha alone exceeds a stronger threshold (e.g. 128)
        // AND color is significantly different. Since dist <= colorThreshold here,
        // only mark boundary if alpha is very high and could block fill.
        if (a > 200) {
          // Strong opaque pixel that happens to match seed color — not a boundary
          mask[i] = 0;
        }
      }
    }
    // alpha <= alphaThreshold: transparent pixel, not a boundary
  }

  return mask;
}

// ─── Scan a mask canvas for tight pixel bounds ────────────────────────────────
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
