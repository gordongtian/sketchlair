// ── LearnTimer ─────────────────────────────────────────────────────────────────
//
// Self-contained timer primitive for Learn modules.
// Uses performance.now() internally for drift-free accuracy.
// Exposes pause() / resume() via imperative ref handle.

import type { TimerMode } from "@/types/learn";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface LearnTimerHandle {
  pause: () => void;
  resume: () => void;
  reset: () => void;
}

interface LearnTimerProps {
  mode: TimerMode;
  /** Total duration for countdown mode. null = countup/infinite. */
  durationSeconds: number | null;
  /** Fires when countdown reaches 0. Never fires in countup mode. */
  onComplete: () => void;
  /** Fires every second with elapsed time in seconds. */
  onTick: (elapsed: number) => void;
  className?: string;
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const secs = s % 60;
  return `${m}:${secs.toString().padStart(2, "0")}`;
}

export const LearnTimer = forwardRef<LearnTimerHandle, LearnTimerProps>(
  function LearnTimer(
    { mode, durationSeconds, onComplete, onTick, className },
    ref,
  ) {
    // elapsed seconds (always counts up internally)
    const [elapsed, setElapsed] = useState(0);

    const isPausedRef = useRef(false);
    const startTimeRef = useRef<number | null>(null);
    const accumulatedRef = useRef(0); // seconds accumulated before last pause
    const rafRef = useRef<number | null>(null);
    const lastTickSecRef = useRef(-1);
    const completedRef = useRef(false);

    const onCompleteRef = useRef(onComplete);
    const onTickRef = useRef(onTick);
    useEffect(() => {
      onCompleteRef.current = onComplete;
    }, [onComplete]);
    useEffect(() => {
      onTickRef.current = onTick;
    }, [onTick]);

    const tick = useCallback(() => {
      if (isPausedRef.current) return;

      const now = performance.now();
      const startTime = startTimeRef.current ?? now;
      startTimeRef.current = startTime;

      const totalElapsed = accumulatedRef.current + (now - startTime) / 1000;

      setElapsed(totalElapsed);

      // Fire onTick once per second
      const elapsedSec = Math.floor(totalElapsed);
      if (elapsedSec !== lastTickSecRef.current) {
        lastTickSecRef.current = elapsedSec;
        onTickRef.current(elapsedSec);
      }

      // Countdown completion
      if (
        mode === "countdown" &&
        durationSeconds !== null &&
        totalElapsed >= durationSeconds &&
        !completedRef.current
      ) {
        completedRef.current = true;
        setElapsed(durationSeconds);
        onCompleteRef.current();
        return; // stop the loop
      }

      rafRef.current = requestAnimationFrame(tick);
    }, [mode, durationSeconds]);

    // Start/restart the RAF loop
    const startLoop = useCallback(() => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      startTimeRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    }, [tick]);

    // Mount — start immediately
    useEffect(() => {
      isPausedRef.current = false;
      completedRef.current = false;
      accumulatedRef.current = 0;
      lastTickSecRef.current = -1;
      setElapsed(0);
      startLoop();
      return () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, [startLoop]);

    useImperativeHandle(
      ref,
      () => ({
        pause() {
          if (isPausedRef.current) return;
          isPausedRef.current = true;
          // Accumulate elapsed time before pausing
          if (startTimeRef.current !== null) {
            accumulatedRef.current +=
              (performance.now() - startTimeRef.current) / 1000;
            startTimeRef.current = null;
          }
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
        },
        resume() {
          if (!isPausedRef.current) return;
          isPausedRef.current = false;
          startTimeRef.current = performance.now();
          rafRef.current = requestAnimationFrame(tick);
        },
        reset() {
          completedRef.current = false;
          accumulatedRef.current = 0;
          lastTickSecRef.current = -1;
          startTimeRef.current = performance.now();
          setElapsed(0);
          if (!isPausedRef.current) {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(tick);
          }
        },
      }),
      [tick],
    );

    // Displayed time
    const displaySeconds =
      mode === "countdown" && durationSeconds !== null
        ? Math.max(0, durationSeconds - elapsed)
        : elapsed;

    return (
      <span
        className={className}
        style={{
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum"',
        }}
      >
        {formatTime(displaySeconds)}
      </span>
    );
  },
);
