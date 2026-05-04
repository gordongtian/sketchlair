import { createActorWithConfig } from "@/config";
import lottie, { type AnimationItem } from "lottie-web";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDialogue } from "./DialogueContext";
import {
  DIALOGUE_CRAWL_SPEED_CPS,
  DIALOGUE_EXPRESSION_CROSSFADE_MS,
  DIALOGUE_FONT_SIZE_DESKTOP,
  DIALOGUE_FONT_SIZE_MOBILE,
  DIALOGUE_PAUSE_PUNCTUATION_MS,
  DIALOGUE_PAUSE_SENTENCE_MS,
  type DialogueBlock,
  type DialogueSegment,
  type ExitTransitionType,
  type TransitionType,
} from "./dialogueTypes";

// ─── Speech bubble design constants ──────────────────────────────────────────

const BUBBLE_BG = "#F5F2EC";
const BUBBLE_TEXT_COLOR = "#2A2420";
const BUBBLE_SHADOW = "0 8px 32px rgba(0, 0, 0, 0.18)";
const BUBBLE_BORDER_RADIUS = 24;
const BUBBLE_PADDING_V = 24;
const BUBBLE_PADDING_H = 28;

// ─── CSS keyframes (injected once) ───────────────────────────────────────────

const STYLE_ID = "dialogue-player-styles";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes dialogue-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes dialogue-slide-up {
      from { transform: translateY(12px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    @keyframes dialogue-pop-in {
      0%   { transform: scale(0.85); opacity: 0; }
      80%  { transform: scale(1.03); opacity: 1; }
      100% { transform: scale(1.0);  opacity: 1; }
    }
    @keyframes dialogue-fade-out {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
    @keyframes dialogue-slide-down {
      from { transform: translateY(0);    opacity: 1; }
      to   { transform: translateY(12px); opacity: 0; }
    }
    @keyframes dialogue-pop-out {
      0%   { transform: scale(1.0);  opacity: 1; }
      20%  { transform: scale(1.03); opacity: 1; }
      100% { transform: scale(0.85); opacity: 0; }
    }
    .dlg-fade-in    { animation: dialogue-fade-in    200ms ease forwards; }
    .dlg-slide-up   { animation: dialogue-slide-up   200ms ease forwards; }
    .dlg-pop-in     { animation: dialogue-pop-in     200ms ease forwards; }
    .dlg-fade-out   { animation: dialogue-fade-out   200ms ease forwards; }
    .dlg-slide-down { animation: dialogue-slide-down 200ms ease forwards; }
    .dlg-pop-out    { animation: dialogue-pop-out    200ms ease forwards; }
  `;
  document.head.appendChild(style);
}

// ─── Mascot assets type ───────────────────────────────────────────────────────

interface MascotAssets {
  expressions: [string, string][];
  animations: [string, string][];
  defaultExpressionName?: string;
  defaultIdleAnimationName?: string;
}

// ─── Layout detection ─────────────────────────────────────────────────────────

type Layout = "portrait" | "desktop" | "landscape";

function detectLayout(): Layout {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 768 && h > w) return "portrait";
  if (w < 1024 && h < w && h < 600) return "landscape";
  return "desktop";
}

// ─── Bubble animation class ───────────────────────────────────────────────────

function entranceClass(t: TransitionType): string {
  switch (t) {
    case "fade_in":
      return "dlg-fade-in";
    case "slide_up":
      return "dlg-slide-up";
    case "pop_in":
      return "dlg-pop-in";
    default:
      return "";
  }
}

function exitClass(t: ExitTransitionType): string {
  switch (t) {
    case "fade_out":
      return "dlg-fade-out";
    case "slide_down":
      return "dlg-slide-down";
    default:
      return "";
  }
}

// ─── Full text extractor (strips MTBE markers, concatenates text segments) ────

/**
 * Returns the complete visible text of a block — all text segments concatenated
 * in order, with wholePhraseUnit segments included as-is.
 * Used to pre-measure the bubble height before the crawl begins.
 */
function blockFullText(block: DialogueBlock): string {
  return block.segments
    .filter((s) => s.type === "text")
    .map((s) => s.text ?? "")
    .join("");
}

// ─── Inline text formatter ────────────────────────────────────────────────────

function renderFormattedText(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < text.length) {
    if (text[i] === "*" && text[i + 1] === "*") {
      const closeIdx = text.indexOf("**", i + 2);
      if (closeIdx !== -1) {
        nodes.push(
          <span key={key++} style={{ fontWeight: 600 }}>
            {text.slice(i + 2, closeIdx)}
          </span>,
        );
        i = closeIdx + 2;
        continue;
      }
    }

    if (text[i] === "*" && (i + 1 >= text.length || text[i + 1] !== "*")) {
      const closeIdx = text.indexOf("*", i + 1);
      if (
        closeIdx !== -1 &&
        (closeIdx + 1 >= text.length || text[closeIdx + 1] !== "*")
      ) {
        nodes.push(
          <span key={key++} style={{ fontStyle: "italic" }}>
            {text.slice(i + 1, closeIdx)}
          </span>,
        );
        i = closeIdx + 1;
        continue;
      }
    }

    if (text[i] === "`") {
      const closeIdx = text.indexOf("`", i + 1);
      if (closeIdx !== -1) {
        nodes.push(
          <span
            key={key++}
            style={{
              fontFamily: "monospace",
              background: "rgba(0,0,0,0.08)",
              borderRadius: 4,
              padding: "1px 5px",
            }}
          >
            {text.slice(i + 1, closeIdx)}
          </span>,
        );
        i = closeIdx + 1;
        continue;
      }
    }

    let end = i + 1;
    while (end < text.length) {
      const ch = text[end];
      if (ch === "*" || ch === "`") break;
      end++;
    }
    nodes.push(text.slice(i, end));
    i = end;
  }

  return nodes;
}

// ─── Organic SVG tail ─────────────────────────────────────────────────────────

function TailDesktop() {
  return (
    <svg
      aria-hidden="true"
      width="28"
      height="24"
      viewBox="0 0 28 24"
      style={{
        position: "absolute",
        bottom: -20,
        right: 32,
        overflow: "visible",
        filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.10))",
        pointerEvents: "none",
      }}
    >
      <path
        d="M0,0 C4,0 10,4 14,10 C18,16 22,22 28,24 C20,24 8,18 0,0 Z"
        fill={BUBBLE_BG}
      />
    </svg>
  );
}

function TailPortrait() {
  return (
    <svg
      aria-hidden="true"
      width="28"
      height="24"
      viewBox="0 0 28 24"
      style={{
        position: "absolute",
        bottom: -20,
        left: "50%",
        transform: "translateX(-50%)",
        overflow: "visible",
        filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.10))",
        pointerEvents: "none",
      }}
    >
      <path
        d="M4,0 C8,0 20,0 24,0 C20,8 16,16 14,24 C12,16 8,8 4,0 Z"
        fill={BUBBLE_BG}
      />
    </svg>
  );
}

// ─── Explicit dialogue state machine ─────────────────────────────────────────
//
//   IDLE
//     ↓ play() called
//   ENTERING
//     ↓ entrance animation done (or immediate if entrance === 'none')
//   CRAWLING
//     ↓ crawl reaches MTBE → MTBE_FIRING
//     ↓ crawl completes with no more segments → WAITING_FOR_CLICK  ← STOPS
//   MTBE_FIRING
//     ↓ MTBE animation done (or immediate) → CRAWLING (next segment)
//   WAITING_FOR_CLICK
//     ↓ user click ONLY → EXITING
//   EXITING
//     ↓ exit animation done → ENTERING (next block) or IDLE (no more blocks)

type DialogueState =
  | "IDLE"
  | "ENTERING"
  | "CRAWLING"
  | "MTBE_FIRING"
  | "WAITING_FOR_CLICK"
  | "EXITING";

// ─── DialoguePlayer ───────────────────────────────────────────────────────────

export function DialoguePlayer() {
  const { activeBlocks, isPreview, onComplete, stop, resetRef } = useDialogue();

  // ── stable refs for async callbacks ─────────────────────────────────────
  const isPreviewRef = useRef(isPreview);
  isPreviewRef.current = isPreview;

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // ── mascot registry ──────────────────────────────────────────────────────
  const [mascotAssets, setMascotAssets] = useState<MascotAssets | null>(null);

  useEffect(() => {
    ensureStyles();
  }, []);

  useEffect(() => {
    if (!activeBlocks) return;

    let cancelled = false;
    void (async () => {
      try {
        const actor = await createActorWithConfig();
        const result = await actor.getMascotAssets();
        if (!cancelled) {
          if (isPreviewRef.current) {
            const expressionNames = new Set(result.expressions.map(([n]) => n));
            const animationNames = new Set(result.animations.map(([n]) => n));

            for (const block of activeBlocks) {
              if (block.expression && !expressionNames.has(block.expression)) {
                stopRef.current();
                toast.error(
                  `Preview stopped — expression not found: ${block.expression}`,
                );
                return;
              }
              if (block.animation && !animationNames.has(block.animation)) {
                stopRef.current();
                toast.error(
                  `Preview stopped — animation not found: ${block.animation}`,
                );
                return;
              }
              for (const seg of block.segments) {
                if (
                  seg.type === "mtbe" &&
                  seg.expression &&
                  !expressionNames.has(seg.expression)
                ) {
                  stopRef.current();
                  toast.error(
                    `Preview stopped — expression not found: ${seg.expression}`,
                  );
                  return;
                }
                if (
                  seg.type === "mtbe" &&
                  seg.animation &&
                  !animationNames.has(seg.animation)
                ) {
                  stopRef.current();
                  toast.error(
                    `Preview stopped — animation not found: ${seg.animation}`,
                  );
                  return;
                }
              }
            }
          }

          setMascotAssets(result);
        }
      } catch {
        if (!cancelled) {
          if (isPreviewRef.current) {
            stopRef.current();
            toast.error("Preview stopped — mascot assets could not be loaded");
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBlocks]);

  // ── layout ───────────────────────────────────────────────────────────────
  const [layout, setLayout] = useState<Layout>(detectLayout);

  useEffect(() => {
    const handler = () => setLayout(detectLayout());
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── explicit state machine ────────────────────────────────────────────────
  const [dialogueState, setDialogueState] = useState<DialogueState>("IDLE");

  // ── playback state ────────────────────────────────────────────────────────
  const [blockIdx, setBlockIdx] = useState(0);
  const [segIdx, setSegIdx] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [currentExpression, setCurrentExpression] = useState<string | null>(
    null,
  );
  const [isCrossfading, setIsCrossfading] = useState(false);
  const [nextExpression, setNextExpression] = useState<string | null>(null);
  const [bubbleAnimClass, setBubbleAnimClass] = useState("");

  // ── pre-measured bubble content height ───────────────────────────────────
  // Set to a number (px) before the crawl starts. Cleared (null) when idle.
  // The bubble text area is locked to this height during crawl so the bubble
  // never resizes as characters are revealed.
  const [bubbleContentHeight, setBubbleContentHeight] = useState<number | null>(
    null,
  );

  // Hidden off-screen div used to measure full-text height before each crawl.
  // Created once, never removed, never visible.
  const measureDivRef = useRef<HTMLDivElement | null>(null);

  const getMeasureDiv = useCallback((): HTMLDivElement => {
    if (!measureDivRef.current) {
      const div = document.createElement("div");
      div.setAttribute("aria-hidden", "true");
      div.style.cssText = [
        "position:fixed",
        "visibility:hidden",
        "pointerEvents:none",
        "top:-9999px",
        "left:-9999px",
        "zIndex:-1",
        "whiteSpace:pre-wrap",
        "wordBreak:break-word",
      ].join(";");
      document.body.appendChild(div);
      measureDivRef.current = div;
    }
    return measureDivRef.current;
  }, []);

  /**
   * Measure the height that the full text of `block` will occupy inside the
   * bubble at the current font settings and bubble max-width.
   * Returns the measured offsetHeight in px.
   */
  const measureBubbleHeight = useCallback(
    (block: DialogueBlock, maxWidth: number | string, fs: number): number => {
      const div = getMeasureDiv();
      // Match the bubble's inner text container exactly
      const mw = typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth;
      // Subtract horizontal padding from both sides to get the inner content width
      const innerWidth = `calc(${mw} - ${BUBBLE_PADDING_H * 2}px)`;
      div.style.width = innerWidth;
      div.style.maxWidth = innerWidth;
      div.style.fontSize = `${fs}px`;
      div.style.fontFamily = "'Figtree', 'Inter', sans-serif";
      div.style.fontWeight = "400";
      div.style.lineHeight = "1.6";
      div.style.padding = "0";
      div.textContent = blockFullText(block);
      return div.offsetHeight;
    },
    [getMeasureDiv],
  );

  // Stable refs for dialogueState / indices used inside async callbacks
  const dialogueStateRef = useRef<DialogueState>("IDLE");
  dialogueStateRef.current = dialogueState;

  const blockIdxRef = useRef(0);
  blockIdxRef.current = blockIdx;
  const segIdxRef = useRef(0);
  segIdxRef.current = segIdx;

  const activeBlocksRef = useRef<DialogueBlock[] | null>(null);
  activeBlocksRef.current = activeBlocks ?? null;

  // ── lottie ───────────────────────────────────────────────────────────────
  const lottieContainerRef = useRef<HTMLDivElement>(null);
  const lottieInstanceRef = useRef<AnimationItem | null>(null);
  const mascotAssetsRef = useRef<MascotAssets | null>(null);
  mascotAssetsRef.current = mascotAssets;

  // ── pending setTimeout handles ────────────────────────────────────────────
  const pendingTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearAllPendingTimers = useCallback(() => {
    for (const t of pendingTimersRef.current) clearTimeout(t);
    pendingTimersRef.current = [];
  }, []);

  const scheduleTimer = useCallback(
    (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
      const handle = setTimeout(() => {
        pendingTimersRef.current = pendingTimersRef.current.filter(
          (h) => h !== handle,
        );
        fn();
      }, ms);
      pendingTimersRef.current.push(handle);
      return handle;
    },
    [],
  );

  // ── crawl internals ───────────────────────────────────────────────────────
  const crawlRef = useRef<{
    text: string;
    pos: number;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ text: "", pos: 0, timer: null });

  const clearCrawlTimer = useCallback(() => {
    if (crawlRef.current.timer !== null) {
      clearTimeout(crawlRef.current.timer);
      pendingTimersRef.current = pendingTimersRef.current.filter(
        (h) => h !== crawlRef.current.timer,
      );
      crawlRef.current.timer = null;
    }
  }, []);

  // ── run counter — incremented on every fresh play() call ─────────────────
  // Every async callback captures the run counter at the time it was created.
  // If the counter has changed by the time the callback fires, it is stale and
  // must be discarded. This is the synchronous gate that prevents any residual
  // callback from the previous run from touching the new run's state.
  const runCounterRef = useRef(0);

  // ── full synchronous reset — called from context's play() and stop() ────────
  // This runs BEFORE React processes the new activeBlocks state, so all stale
  // timers, RAF handles, and state machine state are cleared before the new run.
  const doFullReset = useCallback(() => {
    // 1. Invalidate all in-flight callbacks immediately (synchronous)
    runCounterRef.current += 1;

    // 2. Cancel every pending setTimeout
    clearAllPendingTimers();

    // 3. Cancel crawl timer
    clearCrawlTimer();

    // 4. Destroy Lottie instance
    if (lottieInstanceRef.current) {
      lottieInstanceRef.current.destroy();
      lottieInstanceRef.current = null;
    }

    // 5. Reset state machine to IDLE (synchronous ref + async React state)
    dialogueStateRef.current = "IDLE";
    setDialogueState("IDLE");

    // 6. Reset all playback indices and displayed content
    blockIdxRef.current = 0;
    segIdxRef.current = 0;
    crawlRef.current = { text: "", pos: 0, timer: null };
    setBlockIdx(0);
    setSegIdx(0);
    setDisplayedText("");
    setBubbleContentHeight(null);

    // 7. Reset expression / animation state
    setCurrentExpression(null);
    setIsCrossfading(false);
    setNextExpression(null);
    setBubbleAnimClass("");
  }, [clearAllPendingTimers, clearCrawlTimer]);

  // Register doFullReset into the context ref so play() and stop() can call it.
  // We use a layout effect so the ref is always populated before any play() call.
  useEffect(() => {
    resetRef.current = doFullReset;
    return () => {
      // On unmount, unregister to avoid calling reset on an unmounted component
      resetRef.current = null;
    };
  }, [resetRef, doFullReset]);

  // ── load lottie animation ─────────────────────────────────────────────────
  const loadLottieRef = useRef<
    ((name: string | null, loop: boolean) => void) | null
  >(null);

  useEffect(() => {
    loadLottieRef.current = (animationName: string | null, loop: boolean) => {
      if (lottieInstanceRef.current) {
        lottieInstanceRef.current.destroy();
        lottieInstanceRef.current = null;
      }
      if (
        !animationName ||
        !lottieContainerRef.current ||
        !mascotAssetsRef.current
      )
        return;

      const entry = mascotAssetsRef.current.animations.find(
        ([n]) => n === animationName,
      );
      if (!entry) {
        if (isPreviewRef.current) {
          stopRef.current();
          toast.error(
            `Preview stopped — animation not found: ${animationName}`,
          );
        }
        return;
      }

      try {
        const instance = lottie.loadAnimation({
          container: lottieContainerRef.current,
          renderer: "svg",
          loop,
          autoplay: true,
          path: entry[1],
        });
        lottieInstanceRef.current = instance;

        if (!loop) {
          instance.addEventListener("complete", () => {
            const idle =
              mascotAssetsRef.current?.defaultIdleAnimationName ?? null;
            if (idle && loadLottieRef.current)
              loadLottieRef.current(idle, true);
          });
        }
      } catch {
        // skip silently
      }
    };
  });

  const loadLottie = useCallback((name: string | null, loop: boolean) => {
    loadLottieRef.current?.(name, loop);
  }, []);

  // ── crossfade expression ──────────────────────────────────────────────────
  const triggerCrossfade = useCallback(
    (newExpr: string | null) => {
      setIsCrossfading(true);
      setNextExpression(newExpr);
      scheduleTimer(() => {
        setCurrentExpression(newExpr);
        setIsCrossfading(false);
        setNextExpression(null);
      }, DIALOGUE_EXPRESSION_CROSSFADE_MS);
    },
    [scheduleTimer],
  );

  // ── resolve expression with preview guard ────────────────────────────────
  const resolveExpression = useCallback(
    (name: string | null): string | null => {
      if (!name) return null;
      if (!mascotAssetsRef.current) return null;
      const found = mascotAssetsRef.current.expressions.find(
        ([n]) => n === name,
      );
      if (!found) {
        if (isPreviewRef.current) {
          stopRef.current();
          toast.error(`Preview stopped — expression not found: ${name}`);
        }
        return null;
      }
      return name;
    },
    [],
  );

  // ── fire MTBE ─────────────────────────────────────────────────────────────
  const fireMTBE = useCallback(
    (seg: DialogueSegment) => {
      if (seg.expression !== undefined) {
        const resolved = resolveExpression(seg.expression ?? null);
        triggerCrossfade(resolved);
      }
      if (seg.animation) loadLottie(seg.animation, false);
      if (seg.sfx) console.log("[DialoguePlayer STUB] sfx:", seg.sfx);
      if (seg.music) console.log("[DialoguePlayer STUB] music:", seg.music);
    },
    [triggerCrossfade, loadLottie, resolveExpression],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // startCrawl
  //
  // Crawls a single text segment character by character.
  // The bubble is already sized to its final height before this is called —
  // startCrawl only advances the visible text, never changes the bubble size.
  // ─────────────────────────────────────────────────────────────────────────
  const startCrawlRef = useRef<
    ((text: string, whole: boolean, runId: number) => void) | null
  >(null);

  startCrawlRef.current = (text: string, whole: boolean, runId: number) => {
    clearCrawlTimer();

    if (whole || text.length === 0) {
      setDisplayedText(text);
      setDialogueState("WAITING_FOR_CLICK");
      dialogueStateRef.current = "WAITING_FOR_CLICK";
      return;
    }

    const state = crawlRef.current;
    state.text = text;
    state.pos = 0;
    state.timer = null;
    setDisplayedText("");
    setDialogueState("CRAWLING");
    dialogueStateRef.current = "CRAWLING";

    const msPerChar = 1000 / DIALOGUE_CRAWL_SPEED_CPS;

    const step = () => {
      // Guard: discard if this crawl belongs to a stale run
      if (runId !== runCounterRef.current) return;

      const s = crawlRef.current;
      if (s.pos >= s.text.length) {
        setDialogueState("WAITING_FOR_CLICK");
        dialogueStateRef.current = "WAITING_FOR_CLICK";
        return;
      }
      const ch = s.text[s.pos];
      s.pos++;
      setDisplayedText(s.text.slice(0, s.pos));

      let delay = msPerChar;
      if (".!?".includes(ch)) delay = DIALOGUE_PAUSE_SENTENCE_MS;
      else if (",…".includes(ch)) delay = DIALOGUE_PAUSE_PUNCTUATION_MS;

      s.timer = setTimeout(step, delay);
    };

    crawlRef.current.timer = setTimeout(step, msPerChar);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // advanceSegment
  // ─────────────────────────────────────────────────────────────────────────
  const advanceSegmentRef = useRef<
    | ((
        blocks: DialogueBlock[],
        bIdx: number,
        sIdx: number,
        runId: number,
      ) => void)
    | null
  >(null);

  advanceSegmentRef.current = (
    blocks: DialogueBlock[],
    bIdx: number,
    sIdx: number,
    runId: number,
  ) => {
    if (runId !== runCounterRef.current) return;

    const block = blocks[bIdx];
    if (!block) return;

    const nextIdx = sIdx + 1;
    const nextSeg = block.segments[nextIdx];

    if (!nextSeg) {
      setDialogueState("WAITING_FOR_CLICK");
      dialogueStateRef.current = "WAITING_FOR_CLICK";
      return;
    }

    setSegIdx(nextIdx);

    if (nextSeg.type === "mtbe") {
      setDialogueState("MTBE_FIRING");
      dialogueStateRef.current = "MTBE_FIRING";
      fireMTBE(nextSeg);
      const afterMtbe = block.segments[nextIdx + 1];
      if (!afterMtbe) {
        setDialogueState("WAITING_FOR_CLICK");
        dialogueStateRef.current = "WAITING_FOR_CLICK";
        return;
      }
      setSegIdx(nextIdx + 1);
      if (afterMtbe.type === "text") {
        startCrawlRef.current?.(
          afterMtbe.text ?? "",
          afterMtbe.wholePhraseUnit ?? false,
          runId,
        );
      } else {
        advanceSegmentRef.current?.(blocks, bIdx, nextIdx + 1, runId);
      }
    } else {
      startCrawlRef.current?.(
        nextSeg.text ?? "",
        nextSeg.wholePhraseUnit ?? false,
        runId,
      );
    }
  };

  const advanceSegment = useCallback(
    (blocks: DialogueBlock[], bIdx: number, sIdx: number, runId: number) => {
      advanceSegmentRef.current?.(blocks, bIdx, sIdx, runId);
    },
    [],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // beginBlock
  //
  // Pre-sizes the bubble by measuring the full text, then sets bubbleContentHeight
  // BEFORE starting the crawl. The bubble never resizes during crawl.
  // ─────────────────────────────────────────────────────────────────────────
  const beginBlock = useCallback(
    (
      blocks: DialogueBlock[],
      idx: number,
      maxWidth: number | string,
      fs: number,
      runId: number,
    ) => {
      if (runId !== runCounterRef.current) return;

      const block = blocks[idx];
      if (!block) {
        // No block at this index — sequence is done.
        setDialogueState("IDLE");
        dialogueStateRef.current = "IDLE";
        setBubbleContentHeight(null);
        onCompleteRef.current?.();
        stopRef.current();
        return;
      }

      // ── Pre-measure bubble height from full block text ─────────────────
      // This sets the bubble to its final size BEFORE the crawl starts so it
      // never grows or shrinks during character reveal.
      const measured = measureBubbleHeight(block, maxWidth, fs);
      // Ensure a sensible minimum (~3 lines) even for very short text
      const minH = Math.round(3 * fs * 1.6);
      setBubbleContentHeight(Math.max(measured, minH));

      const rawExpr =
        block.expression ??
        mascotAssetsRef.current?.defaultExpressionName ??
        null;
      const expr = rawExpr ? resolveExpression(rawExpr) : null;
      setCurrentExpression(expr);
      setBubbleAnimClass(entranceClass(block.entrance));

      if (block.sfx) console.log("[DialoguePlayer STUB] sfx:", block.sfx);
      if (block.music) console.log("[DialoguePlayer STUB] music:", block.music);

      const anim = block.animation ?? null;
      if (anim) {
        loadLottie(anim, false);
      } else {
        const idle = mascotAssetsRef.current?.defaultIdleAnimationName ?? null;
        loadLottie(idle, true);
      }

      setSegIdx(0);
      setDisplayedText("");

      const entranceCls = entranceClass(block.entrance);
      const entranceDuration = entranceCls ? 220 : 0;

      setDialogueState("ENTERING");
      dialogueStateRef.current = "ENTERING";

      const startFirstSegment = () => {
        if (runId !== runCounterRef.current) return;

        const firstSeg = block.segments[0];
        if (!firstSeg) {
          setDialogueState("WAITING_FOR_CLICK");
          dialogueStateRef.current = "WAITING_FOR_CLICK";
          return;
        }

        if (firstSeg.type === "mtbe") {
          setDialogueState("MTBE_FIRING");
          dialogueStateRef.current = "MTBE_FIRING";
          fireMTBE(firstSeg);
          const nextSeg = block.segments[1];
          if (!nextSeg) {
            setDialogueState("WAITING_FOR_CLICK");
            dialogueStateRef.current = "WAITING_FOR_CLICK";
            return;
          }
          setSegIdx(1);
          if (nextSeg.type === "text") {
            startCrawlRef.current?.(
              nextSeg.text ?? "",
              nextSeg.wholePhraseUnit ?? false,
              runId,
            );
          } else {
            advanceSegmentRef.current?.(blocks, idx, 1, runId);
          }
        } else {
          startCrawlRef.current?.(
            firstSeg.text ?? "",
            firstSeg.wholePhraseUnit ?? false,
            runId,
          );
        }
      };

      if (entranceDuration > 0) {
        scheduleTimer(startFirstSegment, entranceDuration);
      } else {
        startFirstSegment();
      }
    },
    [
      loadLottie,
      fireMTBE,
      resolveExpression,
      scheduleTimer,
      measureBubbleHeight,
    ],
  );

  // ── trigger beginBlock when activeBlocks / blockIdx changes ───────────────
  const prevActiveBlocksRef = useRef<DialogueBlock[] | null>(null);
  const prevBlockIdxRef = useRef(-1);

  // Derived layout/size values for the current render — needed by beginBlock
  const fontSize =
    layout === "desktop"
      ? DIALOGUE_FONT_SIZE_DESKTOP
      : DIALOGUE_FONT_SIZE_MOBILE;
  const bubbleMaxWidth: number | string =
    layout === "portrait" ? 340 : layout === "landscape" ? "50vw" : 420;

  useEffect(() => {
    if (!activeBlocks) {
      prevActiveBlocksRef.current = null;
      prevBlockIdxRef.current = -1;
      // activeBlocks becoming null means stop() was called — fullReset already
      // ran synchronously in handlePlay/handleStop, so we only need to tidy up
      // the React state that fullReset couldn't set because it runs before React
      // re-renders (blockIdx / segIdx might still be non-zero from last run).
      clearAllPendingTimers();
      clearCrawlTimer();
      setDialogueState("IDLE");
      dialogueStateRef.current = "IDLE";
      setBubbleContentHeight(null);
      lottieInstanceRef.current?.destroy();
      lottieInstanceRef.current = null;
      return;
    }

    const blocksChanged = activeBlocks !== prevActiveBlocksRef.current;
    const idxChanged = blockIdx !== prevBlockIdxRef.current;

    if (blocksChanged || idxChanged) {
      if (blocksChanged) {
        // New play() call — fullReset already ran, indices are already 0.
        // Just update the tracking refs and begin.
        blockIdxRef.current = 0;
        segIdxRef.current = 0;

        if (blockIdx !== 0) {
          // If blockIdx is still non-zero from a previous run (React hasn't
          // processed the setBlockIdx(0) from fullReset yet), defer and let
          // the re-run settle to 0 first.
          setBlockIdx(0);
          prevActiveBlocksRef.current = activeBlocks;
          prevBlockIdxRef.current = 0;
          return;
        }
      } else {
        clearCrawlTimer();
        setDisplayedText("");
      }

      prevActiveBlocksRef.current = activeBlocks;
      prevBlockIdxRef.current = blockIdx;

      beginBlock(
        activeBlocks,
        blockIdx,
        bubbleMaxWidth,
        fontSize,
        runCounterRef.current,
      );
    }
  }, [
    activeBlocks,
    blockIdx,
    beginBlock,
    clearCrawlTimer,
    clearAllPendingTimers,
    bubbleMaxWidth,
    fontSize,
  ]);

  // ── keyboard blocking for blocking mode ───────────────────────────────────
  useEffect(() => {
    if (!activeBlocks) return;
    const block = activeBlocks[blockIdx];
    if (!block || block.mode !== "blocking") return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () =>
      document.removeEventListener("keydown", handler, { capture: true });
  }, [activeBlocks, blockIdx]);

  // ── cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearAllPendingTimers();
      clearCrawlTimer();
      lottieInstanceRef.current?.destroy();
      lottieInstanceRef.current = null;
      // Remove measure div
      if (measureDivRef.current) {
        measureDivRef.current.remove();
        measureDivRef.current = null;
      }
    };
  }, [clearAllPendingTimers, clearCrawlTimer]);

  // ── complete crawl instantly ──────────────────────────────────────────────
  const completeCrawlInstantly = useCallback(() => {
    clearCrawlTimer();
    setDisplayedText(crawlRef.current.text);
  }, [clearCrawlTimer]);

  // ─────────────────────────────────────────────────────────────────────────
  // handleActivate — the ONLY path that may trigger WAITING_FOR_CLICK → EXITING
  // ─────────────────────────────────────────────────────────────────────────
  const handleActivate = useCallback(() => {
    const state = dialogueStateRef.current;
    const blocks = activeBlocksRef.current;
    if (!blocks) return;

    const bIdx = blockIdxRef.current;
    const sIdx = segIdxRef.current;
    const block = blocks[bIdx];
    if (!block) return;

    const runId = runCounterRef.current;

    if (state === "CRAWLING") {
      const remaining = block.segments.slice(sIdx + 1);
      const hasNextMtbe = remaining.some((s) => s.type === "mtbe");

      completeCrawlInstantly();

      if (hasNextMtbe || sIdx + 1 < block.segments.length) {
        advanceSegment(blocks, bIdx, sIdx, runId);
      } else {
        setDialogueState("WAITING_FOR_CLICK");
        dialogueStateRef.current = "WAITING_FOR_CLICK";
      }
      return;
    }

    if (state === "WAITING_FOR_CLICK") {
      setDialogueState("EXITING");
      dialogueStateRef.current = "EXITING";

      const exitCls = exitClass(block.exit);
      if (exitCls) {
        setBubbleAnimClass(exitCls);
        scheduleTimer(() => {
          if (runId !== runCounterRef.current) return;
          const nextBlockIdx = bIdx + 1;
          const currentBlocks = activeBlocksRef.current;
          if (currentBlocks && nextBlockIdx < currentBlocks.length) {
            setBubbleContentHeight(null);
            setBlockIdx(nextBlockIdx);
          } else {
            setBubbleContentHeight(null);
            setDialogueState("IDLE");
            dialogueStateRef.current = "IDLE";
            onCompleteRef.current?.();
            stopRef.current();
          }
        }, 220);
      } else {
        const nextBlockIdx = bIdx + 1;
        const currentBlocks = activeBlocksRef.current;
        if (currentBlocks && nextBlockIdx < currentBlocks.length) {
          setBubbleContentHeight(null);
          setBlockIdx(nextBlockIdx);
        } else {
          setBubbleContentHeight(null);
          setDialogueState("IDLE");
          dialogueStateRef.current = "IDLE";
          onCompleteRef.current?.();
          stopRef.current();
        }
      }
      return;
    }

    // ENTERING, EXITING, MTBE_FIRING, IDLE — ignore clicks
  }, [completeCrawlInstantly, advanceSegment, scheduleTimer]);

  // ── render nothing when inactive ──────────────────────────────────────────
  if (!activeBlocks) return null;

  const block = activeBlocks[blockIdx];
  if (!block) return null;

  const isBlocking = block.mode === "blocking";
  const isWaitingForClick = dialogueState === "WAITING_FOR_CLICK";

  const exprUrl =
    currentExpression && mascotAssets
      ? (mascotAssets.expressions.find(([n]) => n === currentExpression)?.[1] ??
        null)
      : null;
  const nextExprUrl =
    nextExpression && mascotAssets
      ? (mascotAssets.expressions.find(([n]) => n === nextExpression)?.[1] ??
        null)
      : null;

  const charHeight =
    layout === "portrait" ? 120 : layout === "landscape" ? 100 : 200;

  const charRight = layout === "landscape" ? 16 : 24;

  const charStyle: React.CSSProperties =
    layout === "portrait"
      ? {
          position: "fixed",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: charHeight,
          height: charHeight,
          zIndex: 9801,
          pointerEvents: "none",
        }
      : {
          position: "fixed",
          bottom: 0,
          right: charRight,
          width: charHeight,
          height: charHeight,
          zIndex: 9801,
          pointerEvents: "none",
        };

  const bubbleWrapperStyle: React.CSSProperties =
    layout === "portrait"
      ? {
          position: "fixed",
          bottom: charHeight + 36,
          left: "50%",
          transform: "translateX(-50%)",
          width: "85vw",
          maxWidth: bubbleMaxWidth,
          zIndex: 9801,
        }
      : {
          position: "fixed",
          bottom: charHeight + 40,
          right: charRight + charHeight + 8,
          maxWidth: bubbleMaxWidth,
          zIndex: 9801,
        };

  const isPortrait = layout === "portrait";

  return (
    <>
      {/* Full-screen overlay (blocking only) */}
      {isBlocking && (
        <button
          type="button"
          data-ocid="dialogue_player.overlay"
          onClick={handleActivate}
          aria-label="Continue dialogue"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9800,
            pointerEvents: "all",
            cursor: "default",
            outline: "none",
            background: "transparent",
            border: "none",
            padding: 0,
            margin: 0,
          }}
        />
      )}

      {/* Character */}
      <div style={charStyle}>
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {exprUrl && (
            <img
              src={exprUrl}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                opacity: isCrossfading ? 0 : 1,
                transition: `opacity ${DIALOGUE_EXPRESSION_CROSSFADE_MS}ms ease`,
              }}
            />
          )}
          {isCrossfading && nextExprUrl && (
            <img
              src={nextExprUrl}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                opacity: 1,
              }}
            />
          )}
          <div
            ref={lottieContainerRef}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
        </div>
      </div>

      {/* Speech bubble wrapper */}
      <div className={bubbleAnimClass} style={bubbleWrapperStyle}>
        <button
          type="button"
          data-ocid="dialogue_player.bubble"
          onClick={handleActivate}
          aria-label="Continue dialogue"
          style={{
            position: "relative",
            display: "block",
            width: "100%",
            background: BUBBLE_BG,
            border: "none",
            borderRadius: BUBBLE_BORDER_RADIUS,
            padding: `${BUBBLE_PADDING_V}px ${BUBBLE_PADDING_H}px`,
            color: BUBBLE_TEXT_COLOR,
            fontSize,
            fontFamily: "'Figtree', 'Inter', sans-serif",
            fontWeight: 400,
            lineHeight: 1.6,
            maxWidth: "100%",
            textAlign: "left",
            boxShadow: BUBBLE_SHADOW,
            userSelect: "none",
            pointerEvents: "all",
            cursor: "pointer",
            outline: "none",
            overflow: "visible",
          }}
        >
          {/*
           * Text content area — fixed to the pre-measured height so the bubble
           * never resizes during the crawl. The crawled text grows inside this
           * fixed-height container; characters not yet revealed are invisible
           * (their space is already reserved by the container height).
           */}
          <span
            style={{
              display: "block",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              // Lock the height to the pre-measured full-text height.
              // When bubbleContentHeight is null (between blocks or idle) we
              // let the container size naturally.
              height:
                bubbleContentHeight !== null ? bubbleContentHeight : undefined,
              overflow: "hidden",
            }}
          >
            {renderFormattedText(displayedText)}
          </span>

          {isWaitingForClick &&
            activeBlocks &&
            blockIdx < activeBlocks.length - 1 && (
              <span
                data-ocid="dialogue_player.continue_hint"
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  marginLeft: 6,
                  opacity: 0.45,
                  fontSize: fontSize * 0.65,
                  verticalAlign: "middle",
                  color: BUBBLE_TEXT_COLOR,
                }}
              >
                ▶
              </span>
            )}

          {isPortrait ? <TailPortrait /> : <TailDesktop />}
        </button>
      </div>
    </>
  );
}

export type { DialogueBlock, DialogueSegment };
