import type { DocumentTab } from "@/types/DocumentTypes";
import { FileText, FolderOpen, Loader2, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// ── Props ─────────────────────────────────────────────────────────────────────

interface DocumentTabBarProps {
  documents: DocumentTab[];
  activeDocumentId: string | null;
  /** ID of the tab currently being swapped to — shows a spinner on that tab. */
  swappingToId: string | null;
  onSwitchDocument: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewDocument: () => void;
  onOpenDocument: () => void;
  /** Hide the tab bar when true and forceDesktop is false. */
  isMobile: boolean;
  /** Show the tab bar even on mobile if true (e.g. user requests desktop UI). */
  forceDesktop: boolean;
}

// ── Tab component ─────────────────────────────────────────────────────────────

interface TabProps {
  tab: DocumentTab;
  isActive: boolean;
  isSwapping: boolean;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
}

function Tab({ tab, isActive, isSwapping, onSwitch, onClose }: TabProps) {
  return (
    <button
      type="button"
      data-ocid={`doc_tab.${tab.id}`}
      onClick={() => onSwitch(tab.id)}
      className="group relative flex h-full min-w-[120px] max-w-[200px] shrink-0 items-center gap-1.5 px-3 text-xs select-none transition-colors duration-150"
      style={
        isActive
          ? {
              borderTop: "2px solid oklch(var(--accent))",
              backgroundColor: "oklch(var(--sidebar-left))",
              color: "oklch(var(--text))",
            }
          : {
              borderTop: "2px solid transparent",
              backgroundColor: "oklch(var(--toolbar))",
              color: "oklch(var(--muted-text))",
            }
      }
      title={tab.filename}
    >
      {/* Spinner — shown while this tab is the swap destination */}
      {isSwapping ? (
        <Loader2
          size={11}
          className="shrink-0 animate-spin"
          style={{ color: "oklch(var(--accent))" }}
          aria-hidden="true"
        />
      ) : null}

      {/* Filename — truncated with ellipsis */}
      <span className="min-w-0 flex-1 truncate text-left">
        {tab.isDirty && (
          <span
            style={{ color: "oklch(var(--muted-text))", marginRight: "2px" }}
          >
            *
          </span>
        )}
        <span>{tab.filename}</span>
      </span>

      {/* Close button */}
      <button
        type="button"
        data-ocid={`doc_tab.close.${tab.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors duration-100"
        style={{
          color: isActive ? "oklch(var(--muted-text))" : "transparent",
        }}
        aria-label={`Close ${tab.filename}`}
      >
        <X size={10} strokeWidth={2.5} />
      </button>
    </button>
  );
}

// ── Plus button with popover ──────────────────────────────────────────────────

interface PlusButtonProps {
  onNewDocument: () => void;
  onOpenDocument: () => void;
}

function PlusButton({ onNewDocument, onOpenDocument }: PlusButtonProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative flex shrink-0 items-center">
      <button
        ref={buttonRef}
        type="button"
        data-ocid="doc_tab_bar.new_button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-full items-center justify-center px-3 transition-colors duration-150"
        style={{
          color: "oklch(var(--text))",
          backgroundColor: "oklch(var(--toolbar))",
          borderLeft: "1px solid oklch(var(--outline))",
        }}
        aria-label="New or open document"
        title="New / Open"
      >
        <Plus size={15} strokeWidth={2} />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute bottom-full right-0 mb-1 min-w-[160px] overflow-hidden rounded z-50 shadow-xl"
          style={{
            backgroundColor: "oklch(var(--toolbar))",
            border: "1px solid oklch(var(--outline))",
          }}
          role="menu"
        >
          <button
            type="button"
            data-ocid="doc_tab_bar.new_canvas"
            onClick={() => {
              setOpen(false);
              onNewDocument();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors duration-100"
            style={{
              color: "oklch(var(--text))",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "oklch(var(--sidebar-left))";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "transparent";
            }}
            role="menuitem"
          >
            <FileText size={13} />
            New canvas
          </button>
          <button
            type="button"
            data-ocid="doc_tab_bar.open_file"
            onClick={() => {
              setOpen(false);
              onOpenDocument();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors duration-100"
            style={{
              color: "oklch(var(--text))",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "oklch(var(--sidebar-left))";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "transparent";
            }}
            role="menuitem"
          >
            <FolderOpen size={13} />
            Open .sktch file
          </button>
        </div>
      )}
    </div>
  );
}

// ── DocumentTabBar ────────────────────────────────────────────────────────────

/**
 * Bottom tab bar for multi-document support.
 * Desktop only — renders null when isMobile is true and forceDesktop is false.
 */
export function DocumentTabBar({
  documents,
  activeDocumentId,
  swappingToId,
  onSwitchDocument,
  onCloseTab,
  onNewDocument,
  onOpenDocument,
  isMobile,
  forceDesktop,
}: DocumentTabBarProps) {
  // Hide on mobile unless the user has explicitly requested the desktop UI
  if (isMobile && !forceDesktop) return null;

  return (
    <div
      data-ocid="doc_tab_bar"
      className="fixed bottom-0 left-0 right-0 z-[1000] flex h-9 items-stretch select-none"
      style={{
        backgroundColor: "oklch(var(--toolbar))",
        borderTop: "1px solid oklch(var(--outline))",
        WebkitUserSelect: "none",
      }}
    >
      {/* Scrollable tab list */}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-none">
        {documents.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeDocumentId}
            isSwapping={tab.id === swappingToId}
            onSwitch={onSwitchDocument}
            onClose={onCloseTab}
          />
        ))}
      </div>

      {/* Plus button — pinned to the right, never scrolls */}
      <PlusButton
        onNewDocument={onNewDocument}
        onOpenDocument={onOpenDocument}
      />
    </div>
  );
}
