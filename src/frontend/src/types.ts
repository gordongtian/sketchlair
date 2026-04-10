import type { Layer } from "./components/LayersPanel";

// ── Layer Tree Types ──────────────────────────────────────────────────────────

/**
 * A LayerGroup — a collapsible folder containing LayerNodes.
 * Groups have opacity and visibility but no blending mode.
 * Nested groups are supported.
 */
export interface LayerGroup {
  kind: "group";
  id: string;
  name: string;
  /** If false, all children are hidden in render (children.visible is NOT modified) */
  visible: boolean;
  /** 0–1. Effective opacity of children = child.opacity * this.opacity (cascading through all ancestors) */
  opacity: number;
  /** UI state: whether children are visible in the layer panel */
  collapsed: boolean;
  /** Ordered list of child LayerNodes (index 0 = topmost) */
  children: LayerNode[];
}

/**
 * A LayerItem — wraps an existing Layer leaf node in the tree.
 * The `id` field mirrors `layer.id` for uniform tree traversal.
 */
export interface LayerItem {
  kind: "layer";
  id: string;
  layer: Layer;
}

/** Union type for any node in the layer tree */
export type LayerNode = LayerGroup | LayerItem;

/** Utility type alias for node kind discrimination */
export type LayerNodeKind = LayerNode["kind"];

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
}

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
