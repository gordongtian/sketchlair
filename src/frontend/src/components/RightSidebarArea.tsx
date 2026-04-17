import type { ViewTransform } from "../types";
import type { LayerNode } from "../types";
import type { Layer } from "./LayersPanel";
import { LayersPanel } from "./LayersPanel";
import { NavigatorPanel } from "./NavigatorPanel";

// ── Delete-group confirmation shape ──────────────────────────────────────────

export interface DeleteGroupConfirm {
  groupId: string;
  groupName: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface RightSidebarAreaProps {
  // Layout / visibility
  isMobile: boolean;
  rightSidebarCollapsed: boolean;
  rightPanelWidth: number;
  setRightPanelWidth: (w: number) => void;
  setRightSidebarCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;

  // Navigator
  viewTransform: ViewTransform;
  onSetTransform: (t: ViewTransform) => void;
  canvasWidth: number;
  canvasHeight: number;
  thumbnailCanvas: HTMLCanvasElement | null;
  thumbnailVersion: number;
  isFlipped: boolean;

  // Layers
  layers: Layer[];
  layerTree: LayerNode[];
  activeLayerId: string;
  selectedLayerIds: Set<string>;
  layerThumbnails: Record<string, string>;
  onSetActive: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
  onSetOpacityLive: (id: string, opacity: number) => void;
  onSetOpacityCommit: (id: string, before: number, after: number) => void;
  onSetBlendMode: (id: string, blendMode: string) => void;
  onAddLayer: () => void;
  onDeleteLayer: (id: string) => void;
  onReorderLayers: (ids: string[]) => void;
  onClearLayer: () => void;
  onToggleClippingMask: (id: string) => void;
  onMergeLayers: () => void;
  onRenameLayer: (id: string, name: string) => void;
  onToggleAlphaLock: (id: string) => void;
  onCtrlClickLayer: (id: string) => void;
  onToggleRulerActive: (id: string) => void;
  onToggleGroupCollapse: (groupId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onSetGroupOpacity: (groupId: string, opacity: number) => void;
  onSetGroupOpacityLive: (groupId: string, opacity: number) => void;
  onSetGroupOpacityCommit: (
    groupId: string,
    before: number,
    after: number,
  ) => void;
  onToggleGroupVisible: (groupId: string) => void;
  onOpenDeleteGroup: (groupId: string) => void;
  onReorderTree: (newTree: LayerNode[] | Layer[]) => void;
  onReorderTreeSilent: (newTree: LayerNode[] | Layer[]) => void;
  onReorderLayersSilent: (ids: string[]) => void;
  onCommitReorderHistory: (
    treeBefore: LayerNode[],
    treeAfter: LayerNode[],
    layersBefore: Layer[],
    layersAfter: Layer[],
  ) => void;
  onToggleLayerSelection: (id: string, shiftHeld: boolean) => void;
  onCreateGroup: () => void;
  /** Whether the Shift key is currently held — drives ruler On/Off indicator XOR display */
  shiftHeld: boolean;
  /** When true: hides the navigator and layers panel (brush tip editor mode) */
  brushTipEditorActive?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RightSidebarArea({
  isMobile,
  rightSidebarCollapsed,
  rightPanelWidth,
  setRightPanelWidth,
  setRightSidebarCollapsed,
  viewTransform,
  onSetTransform,
  canvasWidth,
  canvasHeight,
  thumbnailCanvas,
  thumbnailVersion,
  isFlipped,
  layers,
  layerTree,
  activeLayerId,
  selectedLayerIds,
  layerThumbnails,
  onSetActive,
  onToggleVisible,
  onSetOpacity,
  onSetOpacityLive,
  onSetOpacityCommit,
  onSetBlendMode,
  onAddLayer,
  onDeleteLayer,
  onReorderLayers,
  onClearLayer,
  onToggleClippingMask,
  onMergeLayers,
  onRenameLayer,
  onToggleAlphaLock,
  onCtrlClickLayer,
  onToggleRulerActive,
  onToggleGroupCollapse,
  onRenameGroup,
  onSetGroupOpacity,
  onSetGroupOpacityLive,
  onSetGroupOpacityCommit,
  onToggleGroupVisible,
  onOpenDeleteGroup,
  onReorderTree,
  onReorderTreeSilent,
  onReorderLayersSilent,
  onCommitReorderHistory,
  onToggleLayerSelection,
  onCreateGroup,
  shiftHeld,
  brushTipEditorActive = false,
}: RightSidebarAreaProps) {
  return (
    <div
      className="flex flex-col border-l border-border"
      style={
        isMobile
          ? {
              // Mobile: fixed overlay from right edge
              position: "fixed",
              right: 0,
              top: 0,
              bottom: 0,
              width: 280,
              zIndex: 60,
              paddingBottom: "env(safe-area-inset-bottom)",
              paddingTop: "env(safe-area-inset-top)",
              overflowX: "hidden",
              background: "oklch(var(--sidebar-right))",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
              // Explicitly enable pointer events on the panel itself
              pointerEvents: "auto",
            }
          : {
              width: rightSidebarCollapsed ? 16 : rightPanelWidth,
              minWidth: rightSidebarCollapsed ? 16 : 160,
              maxWidth: rightSidebarCollapsed ? 16 : 380,
              position: "relative",
              height: "100%",
              overflow: "hidden",
              paddingBottom: "env(safe-area-inset-bottom)",
              background: "oklch(var(--sidebar-right))",
            }
      }
      // Bug fix: on mobile, capture ALL pointer/touch events at the panel container
      // so taps never fall through to canvas or UI elements behind it.
      // stopPropagation alone is not sufficient — we also need preventDefault on
      // touch events to stop browser gesture recognition from consuming the events.
      onClick={isMobile ? (e) => e.stopPropagation() : undefined}
      onKeyDown={isMobile ? (e) => e.stopPropagation() : undefined}
      onPointerDown={
        isMobile
          ? (e) => {
              e.stopPropagation();
            }
          : undefined
      }
      onPointerUp={isMobile ? (e) => e.stopPropagation() : undefined}
      onPointerMove={isMobile ? (e) => e.stopPropagation() : undefined}
      onTouchStart={
        isMobile
          ? (e) => {
              e.stopPropagation();
              // Don't call preventDefault here — it would break scrolling inside the panel
            }
          : undefined
      }
      onTouchEnd={
        isMobile
          ? (e) => {
              e.stopPropagation();
            }
          : undefined
      }
      onTouchMove={
        isMobile
          ? (e) => {
              e.stopPropagation();
            }
          : undefined
      }
    >
      {/* Mobile: backdrop to close layers panel — covers the area to the LEFT of the panel */}
      {isMobile && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 280, // only cover the area to the left of the panel (panel is 280px wide)
            bottom: 0,
            zIndex: -1, // behind sibling panel content within this stacking context
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setRightSidebarCollapsed(true);
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setRightSidebarCollapsed(true);
          }}
        />
      )}
      {!rightSidebarCollapsed && (
        <>
          {/* Resize handle — desktop only */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              cursor: "col-resize",
              zIndex: 10,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = rightPanelWidth;
              const onMove = (me: PointerEvent) => {
                const delta = startX - me.clientX;
                setRightPanelWidth(
                  Math.min(380, Math.max(160, startW + delta)),
                );
              };
              const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
              };
              window.addEventListener("pointermove", onMove);
              window.addEventListener("pointerup", onUp);
            }}
          />
          {!isMobile && !brushTipEditorActive && (
            <>
              {/* Navigator: capped at 25% of sidebar height so portrait canvases don't dominate */}
              <div
                style={{
                  flexShrink: 0,
                  maxHeight: "25%",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <NavigatorPanel
                  viewTransform={viewTransform}
                  onSetTransform={onSetTransform}
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  thumbnailCanvas={thumbnailCanvas}
                  thumbnailVersion={thumbnailVersion}
                  isFlipped={isFlipped}
                />
              </div>
              <div
                className="border-t border-border"
                style={{ flexShrink: 0 }}
              />
            </>
          )}
          {/* Layers panel: fills remaining space and scrolls internally */}
          {/* Hidden entirely in brush tip editor mode */}
          {!brushTipEditorActive && (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <LayersPanel
                layers={layers}
                layerTree={layerTree}
                activeLayerId={activeLayerId}
                selectedLayerIds={selectedLayerIds}
                onSetActive={onSetActive}
                onToggleVisible={onToggleVisible}
                onSetOpacity={onSetOpacity}
                onSetOpacityLive={onSetOpacityLive}
                onSetOpacityCommit={onSetOpacityCommit}
                onSetBlendMode={onSetBlendMode}
                onAddLayer={onAddLayer}
                onDeleteLayer={onDeleteLayer}
                onReorderLayers={onReorderLayers}
                onClearLayer={onClearLayer}
                onToggleClippingMask={onToggleClippingMask}
                onMergeLayers={onMergeLayers}
                onRenameLayer={onRenameLayer}
                onToggleAlphaLock={onToggleAlphaLock}
                thumbnails={layerThumbnails}
                onCtrlClickLayer={onCtrlClickLayer}
                onToggleRulerActive={onToggleRulerActive}
                onToggleGroupCollapse={onToggleGroupCollapse}
                onRenameGroup={onRenameGroup}
                onSetGroupOpacity={onSetGroupOpacity}
                onSetGroupOpacityLive={onSetGroupOpacityLive}
                onSetGroupOpacityCommit={onSetGroupOpacityCommit}
                onToggleGroupVisible={onToggleGroupVisible}
                onDeleteGroup={onOpenDeleteGroup}
                onReorderTree={onReorderTree}
                onReorderTreeSilent={onReorderTreeSilent}
                onReorderLayersSilent={onReorderLayersSilent}
                onCommitReorderHistory={onCommitReorderHistory}
                onToggleLayerSelection={onToggleLayerSelection}
                onCreateGroup={onCreateGroup}
                shiftHeld={shiftHeld}
                onClose={
                  isMobile ? () => setRightSidebarCollapsed(true) : undefined
                }
              />
            </div>
          )}
        </>
      )}
      {/* Desktop collapse toggle — hidden on mobile */}
      {!isMobile && (
        <button
          type="button"
          data-ocid="right_sidebar.toggle"
          onClick={() => setRightSidebarCollapsed((c) => !c)}
          className="absolute top-1/2 -translate-y-1/2 left-0 -translate-x-full z-20 flex items-center justify-center bg-card border border-border rounded-l-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          style={{ width: 14, height: 40, fontSize: 9 }}
          title={rightSidebarCollapsed ? "Expand panel" : "Collapse panel"}
        >
          {rightSidebarCollapsed ? "‹" : "›"}
        </button>
      )}
    </div>
  );
}
