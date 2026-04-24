// ── Learn Module Types ─────────────────────────────────────────────────────────
//
// Shared types for the Learn module and all sub-modules (Figure Drawing, etc.)

export type ReferenceMode = "flash" | "side" | "floating" | "tracing";
export type TimerMode = "countdown" | "countup";

export interface ImageReference {
  id: string;
  assetUrl: string;
  width: number;
  height: number;
}

export interface ImageSet {
  id: string;
  name: string;
  previewThumbnail: string;
  imageCount: number;
  isDefault: boolean;
  images: ImageReference[];
  tags?: string[];
}

export interface FigureDrawingConfig {
  selectedSetIds: string[];
  /** Number of poses, or 'all' to use every image in the selected sets exactly once. */
  poseCount: number | "all";
  poseDuration: number | null; // null = infinite
  referenceMode: ReferenceMode;
}

export interface SessionState {
  selectedSets: string[];
  poseCount: number | "all";
  poseDuration: number | null;
  referenceMode: ReferenceMode;
  poseQueue: ImageReference[];
  currentPoseIndex: number;
  snapshots: ImageData[];
  isPaused: boolean;
  isComplete: boolean;
}
