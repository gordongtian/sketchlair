// ── CanvasCompiler ─────────────────────────────────────────────────────────────
//
// Pure utility — no React. Compiles an ordered array of ImageData snapshots
// into a single collage image using row-based bin packing.

export interface CompilerInput {
  snapshots: ImageData[];
  /** Max dimension in either direction (pixels). Default: 5000 */
  maxSize?: number;
}

export interface CompilerOutput {
  collage: ImageData;
  blob: Blob;
}

const GAP = 12; // px between images in the collage

/**
 * Row-based packing layout.
 * Places images left-to-right in rows, preserving order.
 * When adding the next image would exceed the target width, start a new row.
 * Target width is derived from the widest image or sqrt(totalArea).
 */
function computeLayout(
  sizes: Array<{ w: number; h: number }>,
  maxSize: number,
): {
  positions: Array<{ x: number; y: number }>;
  totalW: number;
  totalH: number;
} {
  if (sizes.length === 0) {
    return { positions: [], totalW: 0, totalH: 0 };
  }

  // Target row width: use sqrt of total area for a roughly square collage
  const totalArea = sizes.reduce((acc, s) => acc + s.w * s.h, 0);
  const targetRowWidth = Math.min(
    maxSize,
    Math.max(...sizes.map((s) => s.w), Math.ceil(Math.sqrt(totalArea))),
  );

  const positions: Array<{ x: number; y: number }> = [];
  let curX = 0;
  let curY = 0;
  let rowHeight = 0;
  let totalW = 0;

  for (const size of sizes) {
    // Start a new row if this image would overflow and we're not at start
    if (curX > 0 && curX + size.w > targetRowWidth) {
      curY += rowHeight + GAP;
      curX = 0;
      rowHeight = 0;
    }
    positions.push({ x: curX, y: curY });
    curX += size.w + GAP;
    rowHeight = Math.max(rowHeight, size.h);
    totalW = Math.max(totalW, curX - GAP);
  }
  const totalH = curY + rowHeight;

  return { positions, totalW, totalH };
}

export async function compileCollage(
  input: CompilerInput,
): Promise<CompilerOutput> {
  const { snapshots, maxSize = 5000 } = input;

  if (snapshots.length === 0) {
    throw new Error("CanvasCompiler: no snapshots provided");
  }

  let sizes = snapshots.map((s) => ({ w: s.width, h: s.height }));

  // Compute initial layout
  let layout = computeLayout(sizes, maxSize);

  // Scale down if the collage exceeds maxSize × maxSize
  if (layout.totalW > maxSize || layout.totalH > maxSize) {
    const scale = Math.min(maxSize / layout.totalW, maxSize / layout.totalH);
    sizes = sizes.map((s) => ({
      w: Math.round(s.w * scale),
      h: Math.round(s.h * scale),
    }));
    layout = computeLayout(sizes, maxSize);
  }

  const { positions, totalW, totalH } = layout;

  // Draw onto an offscreen canvas
  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CanvasCompiler: could not get 2D context");

  // Safety net: always fill white before placing snapshots so the collage
  // output is never transparent even if individual snapshot content varies.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalW, totalH);

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const pos = positions[i];
    const targetSize = sizes[i];

    // If scaling is needed, draw through a temp canvas
    if (targetSize.w !== snap.width || targetSize.h !== snap.height) {
      const tmp = document.createElement("canvas");
      tmp.width = snap.width;
      tmp.height = snap.height;
      const tmpCtx = tmp.getContext("2d");
      if (tmpCtx) {
        tmpCtx.putImageData(snap, 0, 0);
        ctx.drawImage(tmp, pos.x, pos.y, targetSize.w, targetSize.h);
      }
    } else {
      ctx.putImageData(snap, pos.x, pos.y);
    }
  }

  const collage = ctx.getImageData(0, 0, totalW, totalH);

  const blob = await new Promise<Blob>((resolve, reject) => {
    // FIX 6: snap collage as JPEG (was PNG) — matches SessionEndScreen download format
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("CanvasCompiler: toBlob returned null"));
      },
      "image/jpeg",
      0.92,
    );
  });

  return { collage, blob };
}
