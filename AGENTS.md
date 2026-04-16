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
