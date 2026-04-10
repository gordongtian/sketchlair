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
}: ToolbarAreaProps) {
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
        />
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
