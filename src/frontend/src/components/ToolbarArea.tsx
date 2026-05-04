import { Lock, Unlock } from "lucide-react";
import type { RefObject } from "react";
import { Toolbar } from "./Toolbar";
import type { LassoMode, Tool } from "./Toolbar";

export interface ToolbarAreaProps {
  activeTool: Tool;
  activeSubpanel: string | null;
  activeLassoMode: LassoMode;
  onToolChange: (tool: Tool) => void;
  onToolReselect: (tool: Tool) => void;
  zoomLocked: boolean;
  rotateLocked: boolean;
  panLocked: boolean;
  isFlipped: boolean;
  onZoomLockToggle: () => void;
  onRotateLockToggle: () => void;
  onPanLockToggle: () => void;
  onFlipToggle: () => void;
  onAdminOpen: () => void;
  onSaveFile: () => void;
  onOpenFile: () => void;
  hasUnsavedChanges: boolean;
  isMobile: boolean;
  leftHanded: boolean;
  fileLoadInputRef: RefObject<HTMLInputElement | null>;
  onFileLoad: (file: File) => void;
  onNavigateToSplash?: () => void;
  /** Whether proportional transform is toggled on */
  transformProportional: boolean;
  /** Called when the user clicks the proportional toggle */
  onTransformProportionalToggle: () => void;
}

export function ToolbarArea({
  activeTool,
  activeSubpanel,
  activeLassoMode,
  onToolChange,
  onToolReselect,
  zoomLocked,
  rotateLocked,
  panLocked,
  isFlipped,
  onZoomLockToggle,
  onRotateLockToggle,
  onPanLockToggle,
  onFlipToggle,
  onAdminOpen,
  onSaveFile,
  onOpenFile,
  hasUnsavedChanges,
  isMobile,
  leftHanded,
  fileLoadInputRef,
  onFileLoad,
  onNavigateToSplash,
  transformProportional,
  onTransformProportionalToggle,
}: ToolbarAreaProps) {
  const showTransformToggle = activeTool === "transform";

  return (
    <>
      {/* Left toolbar */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "relative",
          flexShrink: 0,
          order: isMobile && leftHanded ? 3 : undefined,
        }}
      >
        <Toolbar
          activeTool={activeTool}
          activeSubpanel={activeSubpanel}
          activeLassoMode={activeLassoMode}
          onToolChange={onToolChange}
          onToolReselect={onToolReselect}
          zoomLocked={zoomLocked}
          rotateLocked={rotateLocked}
          panLocked={panLocked}
          isFlipped={isFlipped}
          onZoomLockToggle={onZoomLockToggle}
          onRotateLockToggle={onRotateLockToggle}
          onPanLockToggle={onPanLockToggle}
          onFlipToggle={onFlipToggle}
          onAdminOpen={onAdminOpen}
          onSaveFile={onSaveFile}
          onOpenFile={onOpenFile}
          hasUnsavedChanges={hasUnsavedChanges}
          isMobile={isMobile}
          onNavigateToSplash={onNavigateToSplash}
        />

        {/* Proportional transform toggle — shown below toolbar when transform tool is active (desktop only) */}
        {showTransformToggle && !isMobile && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "6px 4px 4px",
              gap: 2,
            }}
          >
            <button
              type="button"
              data-ocid="transform.proportional_toggle"
              onClick={onTransformProportionalToggle}
              title={
                transformProportional
                  ? "Proportional transform ON — Shift to free transform"
                  : "Proportional transform OFF — Shift to constrain"
              }
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                width: 40,
                padding: "5px 4px",
                borderRadius: 6,
                border: "1px solid",
                borderColor: transformProportional
                  ? "var(--color-primary)"
                  : "var(--color-border)",
                background: transformProportional
                  ? "var(--color-primary)"
                  : "transparent",
                color: transformProportional
                  ? "var(--color-primary-foreground)"
                  : "var(--color-muted-foreground)",
                cursor: "pointer",
                transition: "all 0.15s ease",
                outline: "none",
              }}
            >
              {transformProportional ? (
                <Lock size={14} strokeWidth={2} />
              ) : (
                <Unlock size={14} strokeWidth={2} />
              )}
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 600,
                  lineHeight: 1,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {transformProportional ? "Lock" : "Free"}
              </span>
            </button>
          </div>
        )}
      </div>{" "}
      {/* end toolbar wrapper */}
      {/* Hidden file input for loading .sktch files */}
      <input
        ref={fileLoadInputRef}
        type="file"
        accept=".sktch"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFileLoad(f);
          e.target.value = "";
        }}
      />
    </>
  );
}
