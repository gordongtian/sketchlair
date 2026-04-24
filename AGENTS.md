# Project Guidance

## User Preferences

[No preferences yet]

## Verified Commands

**Frontend** (run from `src/frontend/`):

- **install**: `pnpm install --prefer-offline`
- **typecheck**: `pnpm typecheck`
- **lint fix**: `pnpm fix`
- **build**: `pnpm build`

**Backend** (run from `src/backend/`):

- **install**: `mops install`
- **typecheck**: `mops check --fix`
- **build**: `mops build`

**Backend and frontend integration** (run from root):

- **generate bindings**: `pnpm bindgen` This step is necessary to ensure the frontend can call the backend methods.

## Learnings

- Layer order convention: the composite loop iterates BACKWARDS (high index = bottom, low index = top). Background (bottom layer) must be at the LAST/highest index, Layer 1 must be at a lower index. The useState default and the Phase 2 toDoc.layers assignment must both use [Layer1, Background] order.
- Layer order in the initial useState default must match the Phase 2 swap initialization — Background at index 0 (bottom), Layer 1 at index 1 (top). These two places must stay in sync.
- `system func init()` on ICP only runs on fresh canister install (--mode reinstall), NOT on --mode upgrade. Top-level `do { }` blocks in an actor share the same limitation. For one-time data seeding that must survive upgrades, use a `var seedApplied : Bool = false` migration flag (persisted via enhanced orthogonal persistence) and check it lazily on first access — this ensures the seed runs on the next canister access after any upgrade deployment.
- **CRITICAL**: Never call state-mutating functions from `public query func` — query functions run in a read-only context on ICP and cannot mutate state. Any mutation inside a query is silently dropped. Always place mutating logic in `public shared func` (update calls) only.
- When resizing the canvas for figure drawing (or any mid-session canvas resize), calling setCanvasWidth/setCanvasHeight React state setters alone causes a pixel-vs-CSS-size mismatch: the wrapper CSS changes but displayCanvas.width, canvasWidthRef.current, the WebGL brush, and offscreen compositing canvases all stay at the old size. Always use the resizeCanvas(w,h) atomic callback that updates ALL of: canvasWidthRef.current, canvasHeightRef.current, displayCanvasRef.current.width/height, webglBrushRef.current.resize(), all offscreen canvas dimensions, invalidateCompositeContextCaches(), strokeCanvasCacheKeyRef, needsFullCompositeRef — BEFORE calling setCanvasWidth/setCanvasHeight.

## Admin Accounts — Hardcoded Principals

Both of the following principals are hardcoded as admins in `src/backend/main.mo` via a `HARDCODED_ADMINS` array and are guaranteed to always be admins regardless of canister upgrade history or state:

1. `l4bkr-kc7sl-rwtfp-35m3x-tehtd-ncdll-3lkn3-6im7y-uabuj-wci4d-tae` — gen / production account
2. `4oonm-seqtd-whea7-bwcol-elxvd-dlik6-lha53-v6irf-oq6ao-ygjes-eqe` — draft / preview account

Admin status is checked via pure text comparison in `isHardcodedAdmin()` — no mutation, no lazy seed, no migration flags. This is safe to call from query functions. Dynamic admins (added via `addAdmin`) are stored in the `admins` Set and checked after the hardcoded list. If you need to add additional admins, use the `addAdmin` canister call from one of the two principals above.

**Important:** The two default image sets (Starter Set Male, Starter Set Female) cannot be deleted via `deleteImageSet` — only their image contents can be modified.

## Deploy Requirements

- **The preferences canister must always be deployed with `--mode upgrade`** to preserve user data. Never use `--mode reinstall` on this canister — reinstall wipes all stored preferences, usernames, image sets, and entitlements.
