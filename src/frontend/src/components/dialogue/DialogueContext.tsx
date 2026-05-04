import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { DialogueBlock } from "./dialogueTypes";

// ─── Play options ─────────────────────────────────────────────────────────────

export interface DialoguePlayOptions {
  isPreview?: boolean;
  /** Optional callback fired when the last block finishes naturally. */
  onComplete?: () => void;
}

// ─── Context shape ────────────────────────────────────────────────────────────

interface DialogueContextValue {
  activeBlocks: DialogueBlock[] | null;
  isPreview: boolean;
  /** Callback to invoke when all blocks are exhausted (optional). */
  onComplete: (() => void) | null;
  play: (blocks: DialogueBlock[], options?: DialoguePlayOptions) => void;
  stop: () => void;
  /**
   * DialoguePlayer calls this to register its internal fullReset fn.
   * ScriptEditor calls resetRef.current?.() before starting a new run
   * so stale timers/state from the previous run are cleared synchronously.
   * @internal
   */
  resetRef: React.MutableRefObject<(() => void) | null>;
}

const DialogueContext = createContext<DialogueContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DialogueProvider({ children }: { children: ReactNode }) {
  const [activeBlocks, setActiveBlocks] = useState<DialogueBlock[] | null>(
    null,
  );
  const [isPreview, setIsPreview] = useState(false);
  const [onComplete, setOnComplete] = useState<(() => void) | null>(null);

  // Ref that DialoguePlayer populates with its fullReset function.
  // Calling resetRef.current() synchronously clears all timers, refs, and
  // state machine state before a new run starts — no React render cycle needed.
  const resetRef = useRef<(() => void) | null>(null);

  const play = useCallback(
    (blocks: DialogueBlock[], options?: DialoguePlayOptions) => {
      // Synchronously reset the player's internal state before changing
      // activeBlocks, so stale callbacks from the previous run can never
      // fire into the new run.
      resetRef.current?.();

      setIsPreview(options?.isPreview ?? false);
      // useState setter can't receive a function directly (updater form),
      // so wrap the callback in an arrow function.
      setOnComplete(options?.onComplete ? () => options.onComplete! : null);
      setActiveBlocks(blocks);
    },
    [],
  );

  const stop = useCallback(() => {
    resetRef.current?.();
    setActiveBlocks(null);
    setIsPreview(false);
    setOnComplete(null);
  }, []);

  const value = useMemo(
    () => ({ activeBlocks, isPreview, onComplete, play, stop, resetRef }),
    [activeBlocks, isPreview, onComplete, play, stop],
  );

  return (
    <DialogueContext.Provider value={value}>
      {children}
    </DialogueContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDialogue(): DialogueContextValue {
  const ctx = useContext(DialogueContext);
  if (!ctx) {
    throw new Error("useDialogue must be used inside <DialogueProvider>");
  }
  return ctx;
}
