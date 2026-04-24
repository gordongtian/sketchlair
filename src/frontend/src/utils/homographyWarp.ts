/**
 * homographyWarp.ts
 *
 * Shared homography warp utility used by both the transform commit path
 * (useTransformSystem.ts) and the compositing preview path (useCompositing.ts).
 *
 * Both paths must call the SAME function so the preview is pixel-for-pixel
 * identical to the committed result.
 */

export interface Point {
  x: number;
  y: number;
}

export interface SrcRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface QuadCorners {
  tl: Point;
  tr: Point;
  bl: Point;
  br: Point;
}

/**
 * Solve a 3×3 homography H such that H * [sx, sy, 1]^T ∝ [dx, dy, 1]^T
 * using the Direct Linear Transform (DLT) for exactly 4 point correspondences.
 *
 * Returns [h00,h01,h02,h10,h11,h12,h20,h21] with h22 = 1, or null if degenerate.
 */
export function solveHomography(
  srcPts: Point[],
  dstPts: Point[],
): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const sx = srcPts[i].x;
    const sy = srcPts[i].y;
    const dx = dstPts[i].x;
    const dy = dstPts[i].y;
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }
  const n = 8;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-10) return null;
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) {
        M[row][k] -= factor * M[col][k];
      }
    }
  }
  const h = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    h[i] = M[i][n];
    for (let j = i + 1; j < n; j++) {
      h[i] -= M[i][j] * h[j];
    }
    h[i] /= M[i][i];
  }
  return h; // [h00,h01,h02,h10,h11,h12,h20,h21], h22=1
}

/**
 * Invert a 3×3 matrix given as a flat 9-element array (row-major).
 * Returns null if the matrix is singular.
 */
export function inv3x3(m: number[]): number[] | null {
  const [a, b2, c, d, e2, f, g, hh, ii] = m;
  const det =
    a * (e2 * ii - f * hh) - b2 * (d * ii - f * g) + c * (d * hh - e2 * g);
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  return [
    (e2 * ii - f * hh) * invDet,
    (c * hh - b2 * ii) * invDet,
    (b2 * f - c * e2) * invDet,
    (f * g - d * ii) * invDet,
    (a * ii - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * hh - e2 * g) * invDet,
    (b2 * g - a * hh) * invDet,
    (a * e2 - b2 * d) * invDet,
  ];
}

/**
 * Draw srcCanvas[srcRect] mapped to dstCorners on destCtx using the exact
 * homography backward-mapping algorithm (identical to the commit path).
 *
 * srcRect  — the sub-rectangle within srcCanvas to warp ({x,y,w,h})
 * dstCorners — the four destination world corners (tl,tr,bl,br) in the
 *              same coordinate space as destCtx
 *
 * Corner order mapping (src → dst):
 *   srcRect TL → dstCorners.tl
 *   srcRect TR → dstCorners.tr
 *   srcRect BL → dstCorners.bl
 *   srcRect BR → dstCorners.br
 */
export function drawQuadWarpHomography(
  destCtx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement,
  srcRect: SrcRect,
  dstCorners: QuadCorners,
): void {
  const { x: srcX, y: srcY, w: srcW, h: srcH } = srcRect;

  // Source corner points (in srcCanvas pixel space)
  const srcPts: Point[] = [
    { x: srcX, y: srcY }, // TL
    { x: srcX + srcW, y: srcY }, // TR
    { x: srcX, y: srcY + srcH }, // BL
    { x: srcX + srcW, y: srcY + srcH }, // BR
  ];

  // Destination corner points (in world/canvas space)
  const dstPts: Point[] = [
    dstCorners.tl,
    dstCorners.tr,
    dstCorners.bl,
    dstCorners.br,
  ];

  const hVec = solveHomography(srcPts, dstPts);
  if (!hVec) return; // degenerate quad

  const [h00, h01, h02, h10, h11, h12, h20, h21] = hVec;
  const hinv = inv3x3([h00, h01, h02, h10, h11, h12, h20, h21, 1]);
  if (!hinv) return;
  const [i00, i01, i02, i10, i11, i12, i20, i21, i22] = hinv;

  // Destination bounding box (in world space)
  const allX = dstPts.map((p) => p.x);
  const allY = dstPts.map((p) => p.y);
  const dstMinX = Math.floor(Math.min(...allX));
  const dstMinY = Math.floor(Math.min(...allY));
  const dstMaxX = Math.ceil(Math.max(...allX));
  const dstMaxY = Math.ceil(Math.max(...allY));
  const dstW = dstMaxX - dstMinX;
  const dstH = dstMaxY - dstMinY;
  if (dstW <= 0 || dstH <= 0) return;

  // Read source pixels
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) return;
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;
  const srcData = srcCtx.getImageData(0, 0, sw, sh);
  const srcPixels = srcData.data;

  // Create destination canvas at the bounding box of the quad
  const destCanvas = document.createElement("canvas");
  destCanvas.width = dstW;
  destCanvas.height = dstH;
  const tmpCtx = destCanvas.getContext("2d", { willReadFrequently: true })!;
  const destData = tmpCtx.createImageData(dstW, dstH);
  const destPixels = destData.data;

  // Backward mapping: for each destination pixel, find its source via H_inv
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx2 = 0; dx2 < dstW; dx2++) {
      // World coordinates of this destination pixel
      const wx = dx2 + dstMinX;
      const wy = dy + dstMinY;
      // Apply inverse homography
      const wh = i20 * wx + i21 * wy + i22;
      if (Math.abs(wh) < 1e-10) continue;
      const sxRaw = (i00 * wx + i01 * wy + i02) / wh;
      const syRaw = (i10 * wx + i11 * wy + i12) / wh;
      // Bilinear interpolation
      const sxF = Math.floor(sxRaw);
      const syF = Math.floor(syRaw);
      const tx2 = sxRaw - sxF;
      const ty2 = syRaw - syF;
      // Clamp source coordinates to canvas bounds
      if (sxF < 0 || syF < 0 || sxF >= sw || syF >= sh) continue;
      const x1 = Math.min(sxF + 1, sw - 1);
      const y1 = Math.min(syF + 1, sh - 1);
      const i00px = (syF * sw + sxF) * 4;
      const i01px = (syF * sw + x1) * 4;
      const i10px = (y1 * sw + sxF) * 4;
      const i11px = (y1 * sw + x1) * 4;
      const destIdx = (dy * dstW + dx2) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const val =
          srcPixels[i00px + ch] * (1 - tx2) * (1 - ty2) +
          srcPixels[i01px + ch] * tx2 * (1 - ty2) +
          srcPixels[i10px + ch] * (1 - tx2) * ty2 +
          srcPixels[i11px + ch] * tx2 * ty2;
        destPixels[destIdx + ch] = Math.round(val);
      }
    }
  }

  tmpCtx.putImageData(destData, 0, 0);

  // Composite the warped result onto destCtx at the correct world position
  destCtx.globalCompositeOperation = "source-over";
  destCtx.globalAlpha = 1;
  destCtx.drawImage(destCanvas, dstMinX, dstMinY);
}
