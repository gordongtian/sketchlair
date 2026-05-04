/**
 * OneEuroFilter — speed-adaptive low-pass filter for interactive input smoothing.
 *
 * Reference: Casiez, Roussel, Vogel (CHI 2012)
 * "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems"
 *
 * At low signal speeds → aggressive smoothing kills jitter.
 * At high signal speeds → smoothing relaxes to preserve responsiveness.
 *
 * Instantiate once per stroke per filtered channel. Reset between strokes.
 * Do NOT use as a global singleton.
 */

/** Minimum cutoff frequency in Hz. Lower = more smoothing at low speed. */
export const PRESSURE_FILTER_MIN_CUTOFF = 1.0;

/** Speed coefficient. Higher = smoothing relaxes faster on rapid changes. */
export const PRESSURE_FILTER_BETA = 0.007;

/** Fix C — maximum allowed pressure change between adjacent line tool samples. */
export const MAX_PRESSURE_DELTA = 0.15;

/** Fix D — rolling median half-window size for commit-time line pressure smoothing. */
export const MEDIAN_WINDOW = 2;

export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(
    minCutoff = PRESSURE_FILTER_MIN_CUTOFF,
    beta = PRESSURE_FILTER_BETA,
  ) {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  private computeAlpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /**
   * Filter a raw value sampled at the given timestamp (milliseconds).
   * Returns the smoothed value. On the very first call, returns rawValue unchanged.
   */
  filter(rawValue: number, timestamp: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = rawValue;
      this.dxPrev = 0;
      this.tPrev = timestamp;
      return rawValue;
    }

    let dt = (timestamp - this.tPrev) / 1000; // ms → seconds
    if (dt <= 0) dt = 1 / 60; // fallback for zero/negative dt (same-frame events)

    // Estimate current signal speed
    const dx = (rawValue - this.xPrev) / dt;

    // Smooth the derivative with a fixed low-pass (dCutoff = 1 Hz)
    const dCutoff = 1.0;
    const dAlpha = this.computeAlpha(dCutoff, dt);
    const dxSmoothed = dAlpha * dx + (1 - dAlpha) * this.dxPrev;

    // Adaptive cutoff based on signal speed
    const cutoff = this.minCutoff + this.beta * Math.abs(dxSmoothed);

    // Low-pass the value with adaptive cutoff
    const alpha = this.computeAlpha(cutoff, dt);
    const xFiltered = alpha * rawValue + (1 - alpha) * this.xPrev;

    this.xPrev = xFiltered;
    this.dxPrev = dxSmoothed;
    this.tPrev = timestamp;

    return xFiltered;
  }

  /** Reset all internal state. Call when starting a new stroke. */
  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}
