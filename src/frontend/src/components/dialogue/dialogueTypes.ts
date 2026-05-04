// ─── Timing constants ────────────────────────────────────────────────────────
export const DIALOGUE_CRAWL_SPEED_CPS = 40; // characters per second
export const DIALOGUE_PAUSE_PUNCTUATION_MS = 150; // pause after , during crawl
export const DIALOGUE_PAUSE_SENTENCE_MS = 400; // pause after . ! ? (overrides punctuation pause)
export const DIALOGUE_EXPRESSION_CROSSFADE_MS = 150; // expression PNG crossfade duration

// ─── Font size constants ──────────────────────────────────────────────────────
export const DIALOGUE_FONT_SIZE_MOBILE = 18; // px — mobile portrait and landscape
export const DIALOGUE_FONT_SIZE_DESKTOP = 20; // px — desktop

// ─── Transition types ────────────────────────────────────────────────────────
export type TransitionType = "fade_in" | "slide_up" | "pop_in" | "none";
export type ExitTransitionType = "fade_out" | "slide_down" | "none";

// ─── Segment ─────────────────────────────────────────────────────────────────

/**
 * A single unit within a dialogue block's text content.
 *
 * type === 'text'  → rendered character-by-character (or all at once when wholePhraseUnit is true)
 * type === 'mtbe'  → Mid-Text Block Event that fires when the crawl reaches this point
 */
export interface DialogueSegment {
  type: "text" | "mtbe";

  // ── text fields ──
  /** The string content (type === 'text' only) */
  text?: string;
  /**
   * When true the entire text segment is displayed all at once rather than
   * crawling letter-by-letter. Used for the word/phrase immediately before an
   * MTBE marker so the MTBE fires cleanly between words.
   */
  wholePhraseUnit?: boolean;

  // ── mtbe fields ──
  expression?: string | null;
  animation?: string | null;
  /** Stub — parsed and stored, never played */
  sfx?: string | null;
  /** Stub — parsed and stored, never played */
  music?: string | null;
}

// ─── Block ───────────────────────────────────────────────────────────────────

/**
 * A single dialogue block. Expression inheritance is resolved at parse time —
 * expression is never null in the final output array (it falls back to the
 * default expression name supplied to the parser, or null if none was given and
 * no prior block declared one).
 */
export interface DialogueBlock {
  /** Resolved expression name after inheritance walk */
  expression: string | null;
  entrance: TransitionType;
  exit: ExitTransitionType;
  mode: "blocking" | "hint";
  /** Animation to play at block start, or null */
  animation: string | null;
  /** Stub — parsed and stored, never played */
  sfx: string | null;
  /** Stub — parsed and stored, never played */
  music: string | null;
  segments: DialogueSegment[];
}
