import type {
  DialogueBlock,
  DialogueSegment,
  ExitTransitionType,
  TransitionType,
} from "./dialogueTypes";

// ─── Internal helpers ─────────────────────────────────────────────────────────

const VALID_ENTRANCES: TransitionType[] = [
  "fade_in",
  "slide_up",
  "pop_in",
  "none",
];
const VALID_EXITS: ExitTransitionType[] = ["fade_out", "slide_down", "none"];

function parseEntrance(raw: string): TransitionType {
  const v = raw.trim().toLowerCase();
  return (VALID_ENTRANCES as string[]).includes(v)
    ? (v as TransitionType)
    : "none";
}

function parseExit(raw: string): ExitTransitionType {
  const v = raw.trim().toLowerCase();
  return (VALID_EXITS as string[]).includes(v)
    ? (v as ExitTransitionType)
    : "none";
}

function parseMode(raw: string): "blocking" | "hint" {
  return raw.trim().toLowerCase() === "hint" ? "hint" : "blocking";
}

function nullIfEmpty(s: string): string | null {
  const t = s.trim();
  return t.length > 0 ? t : null;
}

// ─── MTBE parser ──────────────────────────────────────────────────────────────

/**
 * Parse a single MTBE body string (the content between [[ and ]]).
 * Format: "key: value | key: value"
 */
function parseMTBE(body: string): DialogueSegment {
  const seg: DialogueSegment = { type: "mtbe" };
  try {
    const pairs = body.split("|");
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(":");
      if (colonIdx === -1) continue;
      const key = pair.slice(0, colonIdx).trim().toLowerCase();
      const value = pair.slice(colonIdx + 1).trim();
      switch (key) {
        case "expression":
          seg.expression = nullIfEmpty(value);
          break;
        case "animation":
          seg.animation = nullIfEmpty(value);
          break;
        case "sfx":
          seg.sfx = nullIfEmpty(value);
          break;
        case "music":
          seg.music = nullIfEmpty(value);
          break;
      }
    }
  } catch {
    // silent — return whatever we parsed so far
  }
  return seg;
}

// ─── Text segment splitter ────────────────────────────────────────────────────

/**
 * Split a block's raw text string at [[...]] MTBE markers into an ordered list
 * of text and MTBE segments.
 *
 * The word/phrase immediately before each [[ marker is extracted as a separate
 * text segment with `wholePhraseUnit: true` so the renderer can display it all
 * at once before firing the MTBE.
 */
function splitTextIntoSegments(text: string): DialogueSegment[] {
  const segments: DialogueSegment[] = [];

  try {
    // Split on [[...]] markers, keeping the marker content
    const parts = text.split(/(\[\[.*?\]\])/s);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (part.startsWith("[[") && part.endsWith("]]")) {
        // MTBE
        const body = part.slice(2, -2);
        segments.push(parseMTBE(body));
        continue;
      }

      // Plain text part — check whether the next part is an MTBE
      const nextIsMTBE =
        i + 1 < parts.length &&
        parts[i + 1].startsWith("[[") &&
        parts[i + 1].endsWith("]]");

      if (nextIsMTBE && part.length > 0) {
        // Extract the last whitespace-delimited word as a wholePhraseUnit
        const match = part.match(/^([\s\S]*?)(\S+\s*)$/);
        if (match) {
          const before = match[1];
          const lastWord = match[2];
          if (before.length > 0) {
            segments.push({ type: "text", text: before });
          }
          // The last word/phrase right before the MTBE
          segments.push({
            type: "text",
            text: lastWord,
            wholePhraseUnit: true,
          });
        } else if (part.trim().length > 0) {
          // Single word — mark the whole thing
          segments.push({ type: "text", text: part, wholePhraseUnit: true });
        }
      } else {
        if (part.trim().length > 0) {
          segments.push({ type: "text", text: part });
        }
      }
    }
  } catch {
    // If anything goes wrong, return a single best-effort text segment
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      return [{ type: "text", text: trimmed }];
    }
  }

  return segments;
}

// ─── Block-level property tag parser ─────────────────────────────────────────

interface RawBlock {
  expression: string | null;
  entrance: TransitionType;
  exit: ExitTransitionType;
  mode: "blocking" | "hint";
  animation: string | null;
  sfx: string | null;
  music: string | null;
  rawText: string;
}

function emptyRawBlock(): RawBlock {
  return {
    expression: null,
    entrance: "none",
    exit: "none",
    mode: "blocking",
    animation: null,
    sfx: null,
    music: null,
    rawText: "",
  };
}

/**
 * Parse a `[key: value]` property tag line.
 * Returns the key and value strings, or null if the line is not a property tag
 * (e.g. it is `[block]`).
 */
function parsePropertyTag(line: string): { key: string; value: string } | null {
  const m = line.match(/^\[([^:\]]+):([^\]]*)\]$/);
  if (!m) return null;
  return { key: m[1].trim().toLowerCase(), value: m[2].trim() };
}

/**
 * Apply a parsed property tag to a RawBlock.
 */
function applyProperty(block: RawBlock, key: string, value: string): void {
  switch (key) {
    case "expression":
      block.expression = nullIfEmpty(value);
      break;
    case "entrance":
      block.entrance = parseEntrance(value);
      break;
    case "exit":
      block.exit = parseExit(value);
      break;
    case "mode":
      block.mode = parseMode(value);
      break;
    case "animation":
      block.animation = nullIfEmpty(value);
      break;
    case "sfx":
      block.sfx = nullIfEmpty(value);
      break;
    case "music":
      block.music = nullIfEmpty(value);
      break;
    // unknown keys are silently ignored
  }
}

// ─── Parse result type ────────────────────────────────────────────────────────

export interface ParseDialogueResult {
  blocks: DialogueBlock[];
  /**
   * Present only when the script contains a structural syntax error — e.g.
   * an unclosed quote, a malformed property tag, or an unclosed MTBE marker.
   * An empty script (no [block] markers, all comments) returns `{ blocks: [] }`
   * with NO error field — that is valid, not an error.
   */
  error?: string;
  /**
   * True when the script contained an explicit `[end]` marker. Content after
   * `[end]` is discarded; the blocks array contains only what preceded it.
   * When false (or absent), the script ended naturally (no [end] tag).
   */
  hasEndTag?: boolean;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a raw dialogue script string into a `ParseDialogueResult`.
 *
 * @param scriptText          The full script text.
 * @param defaultExpressionName  The canister-supplied default expression name,
 *                               used as the seed for expression inheritance when
 *                               no prior block has declared one.
 *
 * Expression inheritance is resolved at parse time — every block in the
 * returned array will have its expression field set to the most recently
 * declared expression, or `defaultExpressionName`, or `null` if neither exists.
 *
 * Structural syntax errors (unclosed quotes, malformed property tags, unclosed
 * MTBE markers) are reported via the `error` field. Unrecognised property names
 * and unknown values are silently ignored — they are not errors.
 *
 * The function never throws.
 */
export function parseDialogueScript(
  scriptText: string,
  defaultExpressionName?: string | null,
): ParseDialogueResult {
  try {
    const lines = scriptText.split("\n");

    // ── Pass 1: group lines into raw blocks ──────────────────────────────────

    const rawBlocks: RawBlock[] = [];
    let current: RawBlock | null = null;
    let inText = false;
    let textLines: string[] = [];
    // Track the line number where the current open quote started (1-based)
    let openQuoteLine = 0;
    // Set to true when [end] is encountered — processing stops immediately
    let foundEndTag = false;

    const flushText = () => {
      if (current && textLines.length > 0) {
        // Join and extract the string between the first " and the last "
        const joined = textLines.join("\n");
        const firstQuote = joined.indexOf('"');
        const lastQuote = joined.lastIndexOf('"');
        if (firstQuote !== -1 && lastQuote > firstQuote) {
          current.rawText = joined.slice(firstQuote + 1, lastQuote);
        } else if (firstQuote !== -1) {
          // Unclosed quote — take everything after the opening quote
          current.rawText = joined.slice(firstQuote + 1);
        }
        textLines = [];
        inText = false;
        openQuoteLine = 0;
      }
    };

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const rawLine = lines[lineIdx];
      const lineNum = lineIdx + 1;
      const line = rawLine.trim();

      // Skip blank lines and comments
      if (line.length === 0) continue;
      if (line.startsWith("//")) continue;

      // Check for [end] marker — stop processing, discard everything after it
      if (line.toLowerCase() === "[end]") {
        if (inText) {
          return {
            blocks: [],
            error: `Syntax error on line ${openQuoteLine}: unclosed quote — the opening " was never closed before [end].`,
          };
        }
        if (current) rawBlocks.push(current);
        foundEndTag = true;
        break;
      }

      // Check for [block] marker
      if (line.toLowerCase() === "[block]") {
        // If we're mid-text when a new [block] appears, the quote was never closed
        if (inText) {
          return {
            blocks: [],
            error: `Syntax error on line ${openQuoteLine}: unclosed quote — the opening " was never closed before the next [block].`,
          };
        }
        if (current) rawBlocks.push(current);
        current = emptyRawBlock();
        inText = false;
        textLines = [];
        openQuoteLine = 0;
        continue;
      }

      if (!current) continue; // lines before the first [block] are ignored

      // If we're accumulating text, keep going until we find the closing quote
      if (inText) {
        textLines.push(rawLine);
        if (rawLine.includes('"')) {
          // Check for unclosed MTBE markers in the accumulated text so far
          const joined = textLines.join("\n");
          const openMtbe = (joined.match(/\[\[/g) ?? []).length;
          const closeMtbe = (joined.match(/\]\]/g) ?? []).length;
          if (openMtbe > closeMtbe) {
            return {
              blocks: [],
              error: `Syntax error on line ${lineNum}: unclosed inline event marker [[...]] — every [[ must have a matching ]].`,
            };
          }
          flushText();
        }
        continue;
      }

      // Property tag line?  Must look like [key: value]
      // A line starting with [ but NOT [[ and NOT [block] — validate it
      if (line.startsWith("[") && !line.startsWith("[[")) {
        const prop = parsePropertyTag(line);
        if (prop) {
          applyProperty(current, prop.key, prop.value);
        } else {
          // Looks like a property tag but is malformed (missing colon, missing value, etc.)
          // Exception: [block] is already handled above — anything else starting with [
          // that doesn't parse as [key: value] is a syntax error.
          return {
            blocks: [],
            error: `Syntax error on line ${lineNum}: malformed property tag "${line}" — expected format is [key: value].`,
          };
        }
        continue;
      }

      // Text content starts with "
      if (line.startsWith('"')) {
        const withoutFirst = rawLine.slice(rawLine.indexOf('"') + 1);
        const closingInSameLine = withoutFirst.includes('"');
        if (closingInSameLine) {
          // Entire text is on one line — check for unclosed MTBE
          const singleLine = rawLine;
          const openMtbe = (singleLine.match(/\[\[/g) ?? []).length;
          const closeMtbe = (singleLine.match(/\]\]/g) ?? []).length;
          if (openMtbe > closeMtbe) {
            return {
              blocks: [],
              error: `Syntax error on line ${lineNum}: unclosed inline event marker [[...]] — every [[ must have a matching ]].`,
            };
          }
          textLines = [rawLine];
          flushText();
        } else {
          // Multi-line text — accumulate
          textLines = [rawLine];
          inText = true;
          openQuoteLine = lineNum;
        }
      }

      // Anything else (unexpected) is silently skipped
    }

    // After processing all lines — if still inside a multi-line quote, that's an error
    if (inText) {
      return {
        blocks: [],
        error: `Syntax error on line ${openQuoteLine}: unclosed quote — the opening " was never closed before end of script.`,
      };
    }

    // Flush the final block (only when [end] was NOT encountered — [end] already
    // flushed the current block before breaking out of the loop)
    if (!foundEndTag && current) rawBlocks.push(current);

    // ── Pass 2: convert RawBlocks → DialogueBlocks ───────────────────────────

    const blocks: DialogueBlock[] = rawBlocks.map((rb) => {
      const segments =
        rb.rawText.length > 0 ? splitTextIntoSegments(rb.rawText) : [];

      return {
        expression: rb.expression,
        entrance: rb.entrance,
        exit: rb.exit,
        mode: rb.mode,
        animation: rb.animation,
        sfx: rb.sfx,
        music: rb.music,
        segments,
      };
    });

    // ── Pass 3: resolve expression inheritance ───────────────────────────────

    let lastExpression: string | null = defaultExpressionName ?? null;

    for (const block of blocks) {
      if (block.expression === null) {
        block.expression = lastExpression;
      } else {
        lastExpression = block.expression;
      }
    }

    return { blocks, ...(foundEndTag ? { hasEndTag: true } : {}) };
  } catch (err) {
    // Top-level safety net — never throw, but do report unexpected exceptions
    const msg = err instanceof Error ? err.message : String(err);
    return { blocks: [], error: `Parse error: ${msg}` };
  }
}
