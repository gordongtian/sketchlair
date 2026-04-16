import {
  buildBlankDocState,
  useDocumentManager,
} from "@/hooks/useDocumentManager";
import type { DocumentManagerResult } from "@/hooks/useDocumentManager";
import type { DocumentState } from "@/types/DocumentTypes";
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

// ── Context value type ────────────────────────────────────────────────────────

export interface DocumentContextValue {
  documents: DocumentState[];
  activeDocumentId: string | null;
  activeDocument: DocumentState | null;
  /** ID of the tab currently being swapped TO — show spinner on this tab. */
  swappingToId: string | null;
  addDocument: (state: DocumentState) => void;
  removeDocument: (id: string) => void;
  switchDocument: (id: string) => void;
  updateDocument: (id: string, patch: Partial<DocumentState>) => void;
  setDirty: (id: string, dirty: boolean) => void;
  getNextUntitledIndex: () => number;
  /** Register PaintingApp's three-phase swap function so DocumentManager can call it on tab switch. */
  registerSwapFn: (
    fn: (fromDoc: DocumentState, toDoc: DocumentState) => void,
  ) => void;
  /** Create a blank document with exact dimensions, add it, and queue a swap into it. */
  createDocument: (width: number, height: number, filename?: string) => string;
  /** Register PaintingApp's loadFile function (called after swap when opening a file). */
  registerLoadFileFn: (fn: (file: File) => Promise<void>) => void;
  /** Open a .sktch file as a new document tab. */
  openFileAsDocument: (file: File) => void;
  /** Register PaintingApp's getSktchBlob function (used when saving before close). */
  registerGetSktchBlobFn: (fn: () => Promise<Blob>) => void;
  /** Get the current getSktchBlob function (null until PaintingApp registers it). */
  getSktchBlob: (() => Promise<Blob>) | null;
  /**
   * Switch to a document by ID, executing the full three-phase swap.
   * This is the correct entry point for the tab bar — do not call switchDocument directly.
   */
  handleSwitchDocument: (id: string) => void;
}

// Re-export buildBlankDocState so callers don't need to import from useDocumentManager directly
export { buildBlankDocState };

// ── Context object ────────────────────────────────────────────────────────────

export const DocumentContext = createContext<DocumentContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

interface DocumentProviderProps {
  children: ReactNode;
}

/**
 * Provides document manager state and actions to all descendant components.
 * Wrap the parts of the app that need multi-document access with this provider.
 */
export function DocumentProvider({
  children,
}: DocumentProviderProps): ReactElement {
  const manager: DocumentManagerResult = useDocumentManager();

  const value: DocumentContextValue = {
    documents: manager.documents,
    activeDocumentId: manager.activeDocumentId,
    activeDocument: manager.activeDocument,
    swappingToId: manager.swappingToId,
    addDocument: manager.addDocument,
    removeDocument: manager.removeDocument,
    switchDocument: manager.switchDocument,
    updateDocument: manager.updateDocument,
    setDirty: manager.setDirty,
    getNextUntitledIndex: manager.getNextUntitledIndex,
    registerSwapFn: manager.registerSwapFn,
    createDocument: manager.createDocument,
    registerLoadFileFn: manager.registerLoadFileFn,
    openFileAsDocument: manager.openFileAsDocument,
    registerGetSktchBlobFn: manager.registerGetSktchBlobFn,
    getSktchBlob: manager.getSktchBlob,
    handleSwitchDocument: manager.handleSwitchDocument,
  };

  return (
    <DocumentContext.Provider value={value}>
      {children}
    </DocumentContext.Provider>
  );
}

// ── Consumer hook ─────────────────────────────────────────────────────────────

/**
 * Access the document manager from any component inside DocumentProvider.
 *
 * @example
 * const { activeDocument, createDocument } = useDocumentContext();
 */
export function useDocumentContext(): DocumentContextValue {
  const ctx = useContext(DocumentContext);
  if (!ctx) {
    throw new Error(
      "useDocumentContext must be used within a <DocumentProvider>. " +
        "Wrap your component tree with <DocumentProvider>.",
    );
  }
  return ctx;
}
