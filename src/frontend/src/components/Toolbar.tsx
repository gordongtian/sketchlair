import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Blend,
  Brush,
  Circle,
  Crop,
  Eraser,
  FlipHorizontal2,
  FolderOpen,
  Hand,
  Lasso,
  Maximize2,
  PaintBucket,
  Pipette,
  RotateCcw,
  Ruler,
  Save,
  Settings,
  SlidersHorizontal,
  Square,
  Wand2,
  Waves,
  ZoomIn,
} from "lucide-react";

export type Tool =
  | "brush"
  | "eraser"
  | "smudge"
  | "fill"
  | "eyedropper"
  | "lasso"
  | "move"
  | "transform"
  | "adjustments"
  | "ruler"
  | "zoom"
  | "rotate"
  | "pan"
  | "crop"
  | "liquify";

export type LassoMode = "rect" | "ellipse" | "free" | "poly" | "wand" | "mask";

// Group 1: paint tools
const GROUP1_TOOLS: {
  id: Tool;
  icon: React.ReactNode;
  mobileIcon: React.ReactNode;
  label: string;
  shortcut: string;
  ocid: string;
}[] = [
  {
    id: "brush",
    icon: <Brush size={20} />,
    mobileIcon: <Brush size={17} />,
    label: "Brush",
    shortcut: "B",
    ocid: "toolbar.brush_button",
  },
  {
    id: "eraser",
    icon: <Eraser size={20} />,
    mobileIcon: <Eraser size={17} />,
    label: "Eraser",
    shortcut: "E",
    ocid: "toolbar.eraser_button",
  },
  {
    id: "smudge",
    icon: <Blend size={20} />,
    mobileIcon: <Blend size={17} />,
    label: "Smudge",
    shortcut: "S",
    ocid: "toolbar.smudge_button",
  },
  {
    id: "liquify",
    icon: <Waves size={20} />,
    mobileIcon: <Waves size={17} />,
    label: "Liquify",
    shortcut: "W",
    ocid: "toolbar.liquify_button",
  },
];

// Group 2: selection/utility tools (fill, lasso, eyedropper — lasso is rendered inline)
const GROUP2_FILL_TOOL = {
  id: "fill" as Tool,
  icon: <PaintBucket size={20} />,
  mobileIcon: <PaintBucket size={17} />,
  label: "Fill",
  shortcut: "F",
  ocid: "toolbar.fill_button",
};

const GROUP2_EYEDROPPER_TOOL = {
  id: "eyedropper" as Tool,
  icon: <Pipette size={20} />,
  mobileIcon: <Pipette size={17} />,
  label: "Eyedropper",
  shortcut: "I / Alt",
  ocid: "toolbar.eyedropper_button",
};

// Group 3: canvas tools (ruler, adjustments, crop)
const GROUP3_CANVAS_TOOLS: {
  id: Tool;
  icon: React.ReactNode;
  mobileIcon: React.ReactNode;
  label: string;
  shortcut: string;
  ocid: string;
}[] = [
  {
    id: "crop",
    icon: <Crop size={20} />,
    mobileIcon: <Crop size={17} />,
    label: "Crop",
    shortcut: "Shift+C",
    ocid: "toolbar.crop_button",
  },
];

const LASSO_ICONS: Record<LassoMode, React.ReactNode> = {
  rect: <Square size={20} />,
  ellipse: <Circle size={20} />,
  free: <Lasso size={20} />,
  poly: <Lasso size={20} />,
  wand: <Wand2 size={20} />,
  mask: <Lasso size={20} />,
};

const LASSO_ICONS_MOBILE: Record<LassoMode, React.ReactNode> = {
  rect: <Square size={17} />,
  ellipse: <Circle size={17} />,
  free: <Lasso size={17} />,
  poly: <Lasso size={17} />,
  wand: <Wand2 size={17} />,
  mask: <Lasso size={17} />,
};

const LASSO_LABELS: Record<LassoMode, string> = {
  rect: "Rectangle Select",
  ellipse: "Ellipse Select",
  free: "Lasso",
  poly: "Lasso",
  wand: "Magic Wand",
  mask: "Combined Selection",
};

interface ToolbarProps {
  activeTool: Tool;
  activeSubpanel?: string | null;
  activeLassoMode: LassoMode;
  onToolChange: (tool: Tool) => void;
  onToolReselect: (tool: Tool) => void;
  zoomLocked?: boolean;
  rotateLocked?: boolean;
  panLocked?: boolean;
  isFlipped: boolean;
  onZoomLockToggle: () => void;
  onRotateLockToggle: () => void;
  onPanLockToggle: () => void;
  onFlipToggle: () => void;
  onAdminOpen: () => void;
  onSaveFile: () => void;
  onOpenFile: () => void;
  hasUnsavedChanges: boolean;
  isMobile?: boolean;
}

export function Toolbar({
  activeTool,
  activeSubpanel,
  activeLassoMode,
  onToolChange,
  onToolReselect,
  // zoomLocked,
  // rotateLocked,
  // panLocked,
  isFlipped,
  onZoomLockToggle,
  onRotateLockToggle,
  onPanLockToggle,
  onFlipToggle,
  onAdminOpen,
  onSaveFile,
  onOpenFile,
  hasUnsavedChanges,
  isMobile = false,
}: ToolbarProps) {
  // On mobile: smaller buttons to fit more tools, and zoom/rotate/pan are hidden
  const btnCls = isMobile
    ? "w-8 h-8 flex items-center justify-center rounded transition-all duration-100"
    : "w-9 h-9 flex items-center justify-center rounded transition-all duration-100";
  const bottomBtnCls = isMobile
    ? "w-8 h-8 flex items-center justify-center rounded transition-all duration-100 text-muted-foreground hover:text-foreground hover:bg-muted"
    : "w-9 h-9 flex items-center justify-center rounded transition-all duration-100 text-muted-foreground hover:text-foreground hover:bg-muted";
  const toolbarWidth = isMobile ? 46 : 52;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex flex-col items-center border-r border-border"
        style={{
          width: toolbarWidth,
          minWidth: toolbarWidth,
          paddingBottom: "env(safe-area-inset-bottom)",
          touchAction: "pan-y",
          overflowY: "hidden",
        }}
      >
        {/* Scrollable tool list */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            WebkitOverflowScrolling:
              "touch" as React.CSSProperties["WebkitOverflowScrolling"],
            touchAction: "pan-y",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: isMobile ? 2 : 4,
            paddingTop: isMobile ? 8 : 12,
            paddingBottom: 4,
            scrollbarWidth: "none" as React.CSSProperties["scrollbarWidth"],
          }}
        >
          {/* ── Group 1: Paint tools ── */}
          {GROUP1_TOOLS.map((tool) => (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-ocid={tool.ocid}
                  onClick={() => {
                    if (activeTool === tool.id) {
                      onToolReselect(tool.id);
                    } else {
                      onToolChange(tool.id);
                    }
                  }}
                  className={`${btnCls} ${
                    activeTool === tool.id
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {isMobile ? tool.mobileIcon : tool.icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="flex items-center gap-2">
                <span>{tool.label}</span>
                <kbd className="text-xs bg-muted px-1 rounded">
                  {tool.shortcut}
                </kbd>
              </TooltipContent>
            </Tooltip>
          ))}

          {/* Divider */}
          <div className="w-6 border-t border-border my-1" />

          {/* ── Group 2: Selection / utility ── */}
          {/* Fill */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid={GROUP2_FILL_TOOL.ocid}
                onClick={() => {
                  if (activeTool === GROUP2_FILL_TOOL.id) {
                    onToolReselect(GROUP2_FILL_TOOL.id);
                  } else {
                    onToolChange(GROUP2_FILL_TOOL.id);
                  }
                }}
                className={`${btnCls} ${
                  activeTool === GROUP2_FILL_TOOL.id
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {isMobile ? GROUP2_FILL_TOOL.mobileIcon : GROUP2_FILL_TOOL.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>{GROUP2_FILL_TOOL.label}</span>
              <kbd className="text-xs bg-muted px-1 rounded">
                {GROUP2_FILL_TOOL.shortcut}
              </kbd>
            </TooltipContent>
          </Tooltip>

          {/* Lasso selection tool */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="toolbar.lasso_button"
                onClick={() => {
                  if (activeTool === "lasso") {
                    onToolReselect("lasso");
                  } else {
                    onToolChange("lasso");
                  }
                }}
                className={`${btnCls} relative ${
                  activeTool === "lasso"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {isMobile
                  ? (LASSO_ICONS_MOBILE[activeLassoMode] ?? <Lasso size={17} />)
                  : (LASSO_ICONS[activeLassoMode] ?? <Lasso size={20} />)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex flex-col gap-0.5">
              <span className="font-medium">
                {LASSO_LABELS[activeLassoMode] ?? "Selection"}
              </span>
              <span className="text-xs text-muted-foreground">
                L to cycle modes
              </span>
            </TooltipContent>
          </Tooltip>

          {/* Eyedropper */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid={GROUP2_EYEDROPPER_TOOL.ocid}
                onClick={() => {
                  if (activeTool === GROUP2_EYEDROPPER_TOOL.id) {
                    onToolReselect(GROUP2_EYEDROPPER_TOOL.id);
                  } else {
                    onToolChange(GROUP2_EYEDROPPER_TOOL.id);
                  }
                }}
                className={`${btnCls} ${
                  activeTool === GROUP2_EYEDROPPER_TOOL.id
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {isMobile
                  ? GROUP2_EYEDROPPER_TOOL.mobileIcon
                  : GROUP2_EYEDROPPER_TOOL.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>{GROUP2_EYEDROPPER_TOOL.label}</span>
              <kbd className="text-xs bg-muted px-1 rounded">
                {GROUP2_EYEDROPPER_TOOL.shortcut}
              </kbd>
            </TooltipContent>
          </Tooltip>

          {/* Eyedropper — already in GROUP2_TOOLS, but lasso is inserted between fill and eyedropper */}

          {/* Divider */}
          <div className="w-6 border-t border-border my-1" />

          {/* ── Group 3: Canvas tools (ruler, adjustments, crop) ── */}
          {/* Ruler tool */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="toolbar.ruler_button"
                onClick={() => onToolChange("ruler")}
                className={`${btnCls} ${
                  activeTool === "ruler" || activeSubpanel === "ruler"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Ruler size={isMobile ? 17 : 20} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>Ruler</span>
              <kbd className="text-xs bg-muted px-1 rounded">G</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Adjustments tool */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="toolbar.adjustments_button"
                onClick={() => onToolChange("adjustments")}
                className={`${btnCls} ${
                  activeTool === "adjustments" ||
                  activeSubpanel === "adjustments"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <SlidersHorizontal size={isMobile ? 17 : 20} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <span>Adjustments</span>
            </TooltipContent>
          </Tooltip>

          {/* Crop tool */}
          {GROUP3_CANVAS_TOOLS.map((tool) => (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-ocid={tool.ocid}
                  onClick={() => {
                    if (activeTool === tool.id) {
                      onToolReselect(tool.id);
                    } else {
                      onToolChange(tool.id);
                    }
                  }}
                  className={`${btnCls} ${
                    activeTool === tool.id
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {isMobile ? tool.mobileIcon : tool.icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="flex items-center gap-2">
                <span>{tool.label}</span>
                <kbd className="text-xs bg-muted px-1 rounded">
                  {tool.shortcut}
                </kbd>
              </TooltipContent>
            </Tooltip>
          ))}

          {/* Divider */}
          <div className="w-6 border-t border-border my-1" />

          {/* ── Group 4: Navigation ── */}
          {/* Pan — hidden on mobile (use two-finger drag) */}
          {!isMobile && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-ocid="toolbar.pan_button"
                  onClick={() => {
                    onPanLockToggle();
                    onToolChange("pan");
                  }}
                  className={`${btnCls} ${
                    activeTool === "pan"
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <Hand size={20} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="flex flex-col gap-0.5 max-w-[160px]"
              >
                <span className="font-medium">Pan</span>
                <span className="text-xs text-muted-foreground">
                  Space + drag
                </span>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Zoom — hidden on mobile (use pinch gesture instead) */}
          {!isMobile && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-ocid="toolbar.zoom_button"
                  onClick={() => {
                    onZoomLockToggle();
                    onToolChange("zoom");
                  }}
                  className={`${btnCls} ${
                    activeTool === "zoom"
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <ZoomIn size={20} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="flex flex-col gap-0.5 max-w-[160px]"
              >
                <span className="font-medium">Zoom</span>
                <span className="text-xs text-muted-foreground">
                  Ctrl+Space drag or scroll
                </span>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Rotate — hidden on mobile (use two-finger rotate gesture) */}
          {!isMobile && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-ocid="toolbar.rotate_button"
                  onClick={() => {
                    onRotateLockToggle();
                    onToolChange("rotate");
                  }}
                  className={`${btnCls} ${
                    activeTool === "rotate"
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <RotateCcw size={20} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="flex flex-col gap-0.5 max-w-[160px]"
              >
                <span className="font-medium">Rotate</span>
                <span className="text-xs text-muted-foreground">R + drag</span>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Move / Transform */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="toolbar.move_button"
                onClick={() => onToolChange("move")}
                className={`${btnCls} ${
                  activeTool === "move" || activeTool === "transform"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Maximize2 size={isMobile ? 17 : 20} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>Move / Transform</span>
              <kbd className="text-xs bg-muted px-1 rounded">V</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Flip horizontal button — always visible */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="toolbar.flip_button"
                onClick={onFlipToggle}
                className={`${btnCls} ${
                  isFlipped
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <FlipHorizontal2 size={isMobile ? 17 : 20} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="flex flex-col gap-0.5 max-w-[160px]"
            >
              <span className="font-medium">Flip Canvas</span>
              <span className="text-xs text-muted-foreground">
                Mirror view (non-destructive)
              </span>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Bottom group (Group 5): save / load / settings — always visible, not scrolled */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: isMobile ? 2 : 4,
            paddingBottom: 8,
            paddingTop: 4,
            borderTop: "1px solid oklch(var(--border))",
          }}
        >
          {/* Save file button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="toolbar.save_button"
                onClick={onSaveFile}
                className={`relative ${bottomBtnCls}`}
              >
                <Save size={isMobile ? 16 : 18} />
                {hasUnsavedChanges && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-orange-400 rounded-full" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>Save</span>
              <kbd className="text-xs bg-muted px-1 rounded">Ctrl+S</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Open file button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="toolbar.open_button"
                onClick={onOpenFile}
                className={bottomBtnCls}
              >
                <FolderOpen size={isMobile ? 16 : 18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>Open</span>
              <kbd className="text-xs bg-muted px-1 rounded">Ctrl+O</kbd>
            </TooltipContent>
          </Tooltip>

          {/* Settings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-ocid="toolbar.admin_button"
                onClick={onAdminOpen}
                className={bottomBtnCls}
              >
                <Settings size={isMobile ? 16 : 18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <span>Settings</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
