// ── Flat-array layer architecture ─────────────────────────────────────────────
//
// The layer stack is a single flat array. Groups are represented by two special
// marker entries — a group header and an end_group — with all child layers and
// nested groups sitting between them. Nesting is determined purely by position
// in the array, not by object references or parentId fields.
//
//   { type: 'group',     id: 'G', name: '...', ... }   ← group header
//   { type: 'layer',     id: 'L', ... }                 ← regular layer inside group
//   { type: 'end_group', id: 'G' }                      ← closing marker (same id as header)

// ── Painting / ruler layer ────────────────────────────────────────────────────

/**
 * A regular painting or ruler layer in the flat array.
 * All pixel data, opacity, blend mode, and ruler geometry live here.
 *
 * The `type` field discriminates this variant. Ruler layers set `isRuler: true`
 * in the RulerFields mixin — historically code also checks `layer.type === 'ruler'`
 * for ruler layers; both patterns are supported (isRuler is the canonical flag,
 * type === 'ruler' is accepted as an alias for PaintLayer with isRuler = true).
 */
export interface PaintLayer extends RulerFields {
  type?: "layer" | "ruler"; // undefined is treated as 'layer' for legacy entries
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  isClippingMask: boolean;
  alphaLock: boolean;
}

// ── Group header marker ───────────────────────────────────────────────────────

/**
 * A group header marker. Appears at the start of a group slice in the flat
 * array. All layers and nested groups between this entry and the matching
 * EndGroup (same id) belong to this group.
 *
 * Group headers have NO canvas, imageData, or pixel content.
 */
export interface GroupHeader {
  type: "group";
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  collapsed: boolean;
  blendMode?: string;
  locked?: boolean;
}

// ── End-group marker ──────────────────────────────────────────────────────────

/**
 * An end-group marker. Appears at the end of a group slice, sharing the same
 * `id` as its corresponding GroupHeader.
 *
 * EndGroup entries are completely non-interactive — they cannot be selected,
 * clicked, dragged, or operated on. They are invisible to all operations
 * (selection, copy, cut, export, transform).
 */
export interface EndGroup {
  type: "end_group";
  id: string;
}

// ── Discriminated union ───────────────────────────────────────────────────────

/**
 * The Layer type — a discriminated union of all entry kinds in the flat array.
 *
 *   layer.type === 'layer'     → PaintLayer (regular painting layer)
 *   layer.type === 'ruler'     → PaintLayer (ruler layer, isRuler = true)
 *   layer.type === undefined   → PaintLayer (legacy entry without explicit type)
 *   layer.type === 'group'     → GroupHeader
 *   layer.type === 'end_group' → EndGroup
 *
 * Code that checks `layer.type === 'group'` narrows to GroupHeader.
 * Code that checks `layer.type === 'end_group'` narrows to EndGroup.
 * All other type values (or undefined) indicate a PaintLayer.
 */
export type Layer = PaintLayer | GroupHeader | EndGroup;

// ── Legacy tree types (kept for files not yet migrated to flat-array) ─────────
//
// These types describe the OLD tree-based layer architecture. They are retained
// here because PaintingApp.tsx, LayersPanel.tsx, and related files still
// reference them during the ongoing migration. New code must NOT use these.
// Use the Layer discriminated union above instead.

/** A layer item (leaf node) in the legacy tree structure. */
export interface LayerItem {
  kind: "layer";
  id: string;
  layer: Layer;
}

/** A group node in the legacy tree structure. */
export interface LayerGroup {
  kind: "group";
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  collapsed: boolean;
  blendMode?: string;
  children: LayerNode[];
}

/** Union of all node types in the legacy tree. */
export type LayerNode = LayerItem | LayerGroup;

// ── View transform ────────────────────────────────────────────────────────────

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
}

// ── Ruler geometry fields ─────────────────────────────────────────────────────

export interface RulerFields {
  isRuler?: boolean;
  rulerActive?: boolean;
  rulerActiveBeforeHide?: boolean;
  rulerColor?: string;
  rulerPresetType?:
    | "perspective-1pt"
    | "perspective-2pt"
    | "perspective-3pt"
    | "perspective-5pt"
    | "line"
    | "oval"
    | "grid";
  // Perspective-1pt ruler fields
  vpX?: number;
  vpY?: number;
  horizonAngle?: number;
  rulerWarmupDist?: number;
  // Line ruler fields
  lineX1?: number;
  lineY1?: number;
  lineX2?: number;
  lineY2?: number;
  lineSnapMode?: "line" | "parallel";
  // Perspective-2pt ruler fields
  vp1X?: number;
  vp1Y?: number;
  vp2X?: number;
  vp2Y?: number;
  horizonCenterX?: number;
  horizonCenterY?: number;
  lockFocalLength?: boolean;
  rulerGridBX?: number;
  rulerVP3Y?: number;
  rulerGridDX?: number;
  rulerGridBY?: number;
  rulerHandleDX?: number;
  rulerHandleDY?: number;
  vp1Color?: string;
  vp2Color?: string;
  vp3Color?: string;
  // Oval ruler fields
  ovalCenterX?: number;
  ovalCenterY?: number;
  ovalAngle?: number;
  ovalSemiMajor?: number;
  ovalSemiMinor?: number;
  ovalSnapMode?: "ellipse" | "parallel-minor";
  // Grid ruler fields
  gridCorners?: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  gridMode?: "subdivide" | "extrude";
  gridVertSegments?: number;
  gridHorizSegments?: number;
  gridPerspective?: boolean;
  // 5pt perspective ruler fields
  fivePtCenterX?: number;
  fivePtCenterY?: number;
  fivePtHandleADist?: number;
  fivePtHandleBDist?: number;
  fivePtRotation?: number;
  fivePtCenterColor?: string;
  fivePtLRColor?: string;
  fivePtUDColor?: string;
  fivePtEnableCenter?: boolean;
  fivePtEnableLR?: boolean;
  fivePtEnableUD?: boolean;
  // 2pt per-VP enable flags
  twoPtEnableVP1?: boolean;
  twoPtEnableVP2?: boolean;
  // 3pt per-VP enable flags
  threePtEnableVP1?: boolean;
  threePtEnableVP2?: boolean;
  threePtEnableVP3?: boolean;
}

export const RULER_KEYS: (keyof RulerFields)[] = [
  "isRuler",
  "rulerActive",
  "rulerActiveBeforeHide",
  "rulerColor",
  "rulerPresetType",
  "vpX",
  "vpY",
  "horizonAngle",
  "rulerWarmupDist",
  "lineX1",
  "lineY1",
  "lineX2",
  "lineY2",
  "lineSnapMode",
  "vp1X",
  "vp1Y",
  "vp2X",
  "vp2Y",
  "horizonCenterX",
  "horizonCenterY",
  "lockFocalLength",
  "rulerGridBX",
  "rulerVP3Y",
  "rulerGridDX",
  "rulerGridBY",
  "rulerHandleDX",
  "rulerHandleDY",
  "vp1Color",
  "vp2Color",
  "vp3Color",
  "ovalCenterX",
  "ovalCenterY",
  "ovalAngle",
  "ovalSemiMajor",
  "ovalSemiMinor",
  "ovalSnapMode",
  "gridCorners",
  "gridMode",
  "gridVertSegments",
  "gridHorizSegments",
  "gridPerspective",
  "fivePtCenterX",
  "fivePtCenterY",
  "fivePtHandleADist",
  "fivePtHandleBDist",
  "fivePtRotation",
  "fivePtCenterColor",
  "fivePtLRColor",
  "fivePtUDColor",
  "fivePtEnableCenter",
  "fivePtEnableLR",
  "fivePtEnableUD",
  "twoPtEnableVP1",
  "twoPtEnableVP2",
  "threePtEnableVP1",
  "threePtEnableVP2",
  "threePtEnableVP3",
];
