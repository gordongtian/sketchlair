# Design Brief — SketchLair Learn Module (Figure Drawing)

## Visual Direction
Professional, minimal practice tool. UI fades into the background; focus is entirely on the canvas and timer. Dark-first aesthetic matching existing SketchLair interface — no new decorative elements, no gradients, only functional hierarchy.

## Palette
Reuses SketchLair dark theme: near-black backgrounds (L=0.14–0.23), cyan accent (L=0.7 H=233°) for active selections, bright text (L=0.9), muted gray (L=0.55) for secondary information. No new colors introduced.

| Token | OKLCH | Usage |
|-------|-------|-------|
| `--learn-panel-bg` | 0.16 0.01 250 | Module panels background |
| `--learn-card-bg` | 0.19 0.01 250 | Setup flow cards |
| `--learn-card-border` | 0.25 0.01 250 | Card and pill borders |
| `--learn-pill-active` | 0.7036 0.1441 233.05 | Selected option pill |
| `--learn-timer-text` | 0.9 0.01 250 | Timer display |

## Typography
Figtree (existing). Four-tier hierarchy: timer (2rem mono), headings (1.125rem), body (1rem), labels (0.875rem). No serif fonts, no variable weights beyond 400/600.

## Structural Zones
| Zone | Background | Elevation | Purpose |
|------|------------|-----------|---------|
| Learn Menu | `--learn-panel-bg` | Flat, no shadow | Module grid (Figure Drawing + future) |
| Setup Flow Cards | `--learn-card-bg` | Subtle 1px border | Image sets, option pills, reference modes |
| Session Workspace | `--canvas-bg` | Canvas primary | Timer overlay (top-right), pause indicator |
| Floating Reference | `--learn-card-bg` | 4px shadow, draggable | Non-editable reference image panel |
| Session End | `--learn-panel-bg` | Flat | Collage grid + action buttons |

## Spacing & Rhythm
Setup screens use 24px card padding, 16px gaps between cards. Pill selectors: 8px gaps, 16px h-padding. Timer: 16px from top-right corner. Floating panel: 12px title bar padding. Minimal whitespace — information density over visual relief.

## Component Patterns
- **Pill Selectors**: Rounded-full, 100% width on mobile, inline on desktop. Cyan background when selected, dark gray inactive. Border color matches state.
- **Setup Cards**: 1px borders, subtle hover state (bg lightens 2–3% on hover). No shadow or lift effect.
- **Module Cards**: Portrait orientation, preview thumbnail, text label, icon. Clickable border highlight on hover.
- **Floating Window**: Title bar (draggable), content below, 4px shadow (0 4px 12px rgba(0,0,0,0.3)). Left/right position determined by handedness preference.
- **Timer Display**: Monospace font, right-aligned, always visible during session. Counts down or up depending on mode.

## Motion & Interaction
Screen transitions use `cubic-bezier(0.4, 0, 0.2, 1)` easing, 200ms duration. Pill selectors highlight instantly (no transition delay). Pause overlay fades in 100ms. No entrance animations — only purposeful state transitions.

## Constraints & Guardrails
- No decorative gradients, patterns, or backgrounds
- No icons beyond GraduationCap (Learn), and standard controls (pause, download, share)
- No color outside the defined palette — all tokens must map to OKLCH vars
- Pill selectors must be keyboard-accessible (Tab, Enter)
- Floating panel must respect device bounds (no off-screen positioning)
- Timer must never overlap content on small screens — responsive sizing on mobile

## Learn Module UI Screens
1. **Learn Menu**: GraduationCap icon, "Figure Drawing" module card with description, "Get More" placeholder for future modules
2. **Screen 1 — Image Sets**: Card grid of sets (Starter Male/Female, purchased sets if any), checkbox/toggle on each, "Get More Sets" button
3. **Screen 2 — Pose Count**: Five pill options (2/5/10/15/20), default 10 selected
4. **Screen 3 — Pose Duration**: Nine pill options (15s–10m + ∞), default 1min selected
5. **Screen 4 — Reference Mode**: Four mode cards with icons and descriptions, default "Side Canvas" selected
6. **Session Workspace**: Full canvas with timer/pause in top-right overlay, reference viewer as floating panel or layer
7. **Session End**: Collage grid preview, Download/Share buttons, back to Learn menu on dismiss

## Signature Detail
Monospace timer display in cyan — single visual anchor during drawing session. No other colored elements. Restraint is the signature.
