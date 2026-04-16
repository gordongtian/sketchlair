// ── PaintingAppWrapper ────────────────────────────────────────────────────────
//
// This component has been eliminated. All responsibilities have been moved to:
//   - DocumentManager / useDocumentManager (swap coordination, document operations)
//   - DocumentContext (registerSwapFn, createDocument, openFileAsDocument)
//   - App.tsx (tab bar, modals, dialogs, splash wiring)
//   - PaintingApp (reads from DocumentContext directly on mount)
//
// This file is kept as a no-op to avoid breaking any imports that may still
// reference it during transition. Delete this file once all imports are confirmed clean.

export {};
