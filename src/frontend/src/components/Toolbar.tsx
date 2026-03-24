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
  Eraser,
  FlipHorizontal2,
  Lasso,
  Maximize2,
  PaintBucket,
  Pen,
  Pipette,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Square,
  Wand2,
  ZoomIn,
} from "lucide-react";

export type Tool =
  | "brush"
  | "eraser"
  | "smear"
  | "fill"
  | "eyedropper"
  | "lasso"
  | "move"
  | "transform"
  | "adjustments";

export type LassoMode = "rect" | "ellipse" | "free" | "poly" | "wand" | "mask";

const PAINT_TOOLS: {
  id: Tool;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
  ocid: string;
}[] = [
  {
    id: "brush",
    icon: <Brush size={20} />,
    label: "Brush",
    shortcut: "B",
    ocid: "toolbar.brush_button",
  },
  {
    id: "eraser",
    icon: <Eraser size={20} />,
    label: "Eraser",
    shortcut: "E",
    ocid: "toolbar.eraser_button",
  },
  {
    id: "smear",
    icon: <Blend size={20} />,
    label: "Smear",
    shortcut: "S",
    ocid: "toolbar.smear_button",
  },
  {
    id: "fill",
    icon: <PaintBucket size={20} />,
    label: "Fill",
    shortcut: "F",
    ocid: "toolbar.fill_button",
  },
  {
    id: "eyedropper",
    icon: <Pipette size={20} />,
    label: "Eyedropper",
    shortcut: "I / Alt",
    ocid: "toolbar.eyedropper_button",
  },
];

const LASSO_ICONS: Record<LassoMode, React.ReactNode> = {
  rect: <Square size={20} />,
  ellipse: <Circle size={20} />,
  free: <Lasso size={20} />,
  poly: <Pen size={20} />,
  wand: <Wand2 size={20} />,
  mask: <Lasso size={20} />,
};

const LASSO_LABELS: Record<LassoMode, string> = {
  rect: "Rectangle Select",
  ellipse: "Ellipse Select",
  free: "Free Lasso",
  poly: "Polygon Lasso",
  wand: "Magic Wand",
  mask: "Combined Selection",
};

interface ToolbarProps {
  activeTool: Tool;
  activeSubpanel?: string | null;
  activeLassoMode: LassoMode;
  onToolChange: (tool: Tool) => void;
  onToolReselect: (tool: Tool) => void;
  zoomLocked: boolean;
  rotateLocked: boolean;
  isFlipped: boolean;
  onZoomLockToggle: () => void;
  onRotateLockToggle: () => void;
  onFlipToggle: () => void;
  onAdminOpen: () => void;
}

export function Toolbar({
  activeTool,
  activeSubpanel,
  activeLassoMode,
  onToolChange,
  onToolReselect,
  zoomLocked,
  rotateLocked,
  isFlipped,
  onZoomLockToggle,
  onRotateLockToggle,
  onFlipToggle,
  onAdminOpen,
}: ToolbarProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex flex-col items-center gap-1 py-3 border-r border-border"
        style={{ width: 52, minWidth: 52 }}
      >
        {PAINT_TOOLS.map((tool) => (
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
                className={`w-9 h-9 flex items-center justify-center rounded transition-all duration-100 ${
                  activeTool === tool.id
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {tool.icon}
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
              className={`w-9 h-9 flex items-center justify-center rounded transition-all duration-100 relative ${
                activeTool === "lasso"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {LASSO_ICONS[activeLassoMode]}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="flex flex-col gap-0.5">
            <span className="font-medium">{LASSO_LABELS[activeLassoMode]}</span>
            <span className="text-xs text-muted-foreground">
              L to cycle modes
            </span>
          </TooltipContent>
        </Tooltip>

        {/* Move/Transform tool (unified) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-ocid="toolbar.move_button"
              onClick={() => onToolChange("move")}
              className={`w-9 h-9 flex items-center justify-center rounded transition-all duration-100 ${
                activeTool === "move" || activeTool === "transform"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Maximize2 size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="flex items-center gap-2">
            <span>Move / Transform</span>
            <kbd className="text-xs bg-muted px-1 rounded">V</kbd>
          </TooltipContent>
        </Tooltip>

        {/* Adjustments tool */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-ocid="toolbar.adjustments_button"
              onClick={() => onToolChange("adjustments")}
              className={`w-9 h-9 flex items-center justify-center rounded transition-all duration-100 ${
                activeTool === "adjustments" || activeSubpanel === "adjustments"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <SlidersHorizontal size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <span>Adjustments</span>
          </TooltipContent>
        </Tooltip>

        {/* Divider */}
        <div className="w-6 border-t border-border my-1" />

        {/* Zoom lock button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-ocid="toolbar.zoom_button"
              onClick={onZoomLockToggle}
              className={`w-9 h-9 flex items-center justify-center rounded transition-all duration-100 ${
                zoomLocked
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

        {/* Rotate lock button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-ocid="toolbar.rotate_button"
              onClick={onRotateLockToggle}
              className={`w-9 h-9 flex items-center justify-center rounded transition-all duration-100 ${
                rotateLocked
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

        {/* Flip horizontal button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-ocid="toolbar.flip_button"
              onClick={onFlipToggle}
              className={`w-9 h-9 flex items-center justify-center rounded transition-all duration-100 ${
                isFlipped
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <FlipHorizontal2 size={20} />
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

        {/* Spacer */}
        <div className="flex-1" />

        {/* Admin / Brush Presets */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-ocid="toolbar.admin_button"
              onClick={onAdminOpen}
              className="w-9 h-9 flex items-center justify-center rounded transition-all duration-100 text-muted-foreground hover:text-foreground hover:bg-muted mb-1"
            >
              <Settings size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <span>Settings</span>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
