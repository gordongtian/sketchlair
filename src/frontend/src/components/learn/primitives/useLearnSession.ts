// ── useLearnSession ────────────────────────────────────────────────────────────
//
// Session state manager for Figure Drawing (and future Learn modules).
// All state is held entirely in memory — no localStorage or ICP persistence.

import type {
  FigureDrawingConfig,
  ImageReference,
  ImageSet,
  SessionState,
} from "@/types/learn";
import { useCallback, useState } from "react";

/** Fisher-Yates shuffle — mutates in place, returns the array */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build a randomized pose queue from the selected image sets.
 * When poseCount is 'all', uses every available image exactly once.
 * Otherwise draws exactly poseCount images with no repeats within the session.
 * If the combined sets have fewer images than poseCount, fills up to what's available.
 */
function buildPoseQueue(
  sets: ImageSet[],
  selectedSetIds: string[],
  poseCount: number | "all",
): ImageReference[] {
  const selectedSets = sets.filter((s) => selectedSetIds.includes(s.id));
  const allImages: ImageReference[] = selectedSets.flatMap((s) => s.images);
  shuffle(allImages);
  return poseCount === "all" ? allImages : allImages.slice(0, poseCount);
}

interface UseLearnSessionOptions {
  config: FigureDrawingConfig;
  /** Full ImageSet objects for the selected set IDs */
  imageSets: ImageSet[];
}

interface UseLearnSessionReturn {
  session: SessionState;
  advancePose: () => void;
  addSnapshot: (snapshot: ImageData) => void;
  pauseSession: () => void;
  resumeSession: () => void;
  completeSession: () => void;
}

export function useLearnSession({
  config,
  imageSets,
}: UseLearnSessionOptions): UseLearnSessionReturn {
  const [session, setSession] = useState<SessionState>(() => {
    const poseQueue = buildPoseQueue(
      imageSets,
      config.selectedSetIds,
      config.poseCount,
    );
    return {
      selectedSets: config.selectedSetIds,
      poseCount: config.poseCount,
      poseDuration: config.poseDuration,
      referenceMode: config.referenceMode,
      poseQueue,
      currentPoseIndex: 0,
      snapshots: [],
      isPaused: false,
      isComplete: false,
    };
  });

  /** Move to the next pose. Caller is responsible for snapshotting before calling. */
  const advancePose = useCallback(() => {
    setSession((prev) => {
      const next = prev.currentPoseIndex + 1;
      if (next >= prev.poseQueue.length) {
        return { ...prev, isComplete: true };
      }
      return { ...prev, currentPoseIndex: next };
    });
  }, []);

  /** Stow a completed pose's snapshot */
  const addSnapshot = useCallback((snapshot: ImageData) => {
    setSession((prev) => ({
      ...prev,
      snapshots: [...prev.snapshots, snapshot],
    }));
  }, []);

  const pauseSession = useCallback(() => {
    setSession((prev) => ({ ...prev, isPaused: true }));
  }, []);

  const resumeSession = useCallback(() => {
    setSession((prev) => ({ ...prev, isPaused: false }));
  }, []);

  const completeSession = useCallback(() => {
    setSession((prev) => ({ ...prev, isComplete: true }));
  }, []);

  return {
    session,
    advancePose,
    addSnapshot,
    pauseSession,
    resumeSession,
    completeSession,
  };
}
