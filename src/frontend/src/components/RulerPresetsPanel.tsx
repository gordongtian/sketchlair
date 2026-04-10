import { Circle, Grid, Minus, Ruler } from "lucide-react";

export type RulerPresetType =
  | "perspective-1pt"
  | "perspective-2pt"
  | "perspective-3pt"
  | "perspective-5pt"
  | "line"
  | "oval"
  | "grid";

interface RulerPresetsPanelProps {
  rulerPresetType: RulerPresetType;
  onRulerPresetTypeChange: (type: RulerPresetType) => void;
  rulerColor: string;
  onRulerColorChange: (color: string) => void;
  // Per-VP colors (2pt and 3pt)
  vp1Color?: string;
  vp2Color?: string;
  vp3Color?: string;
  onVp1ColorChange?: (c: string) => void;
  onVp2ColorChange?: (c: string) => void;
  onVp3ColorChange?: (c: string) => void;
  // Perspective-specific
  rulerWarmupDist: number;
  onRulerWarmupDistChange: (val: number) => void;
  // Line-specific
  lineSnapMode: "line" | "parallel";
  onLineSnapModeChange: (mode: "line" | "parallel") => void;
  // 2pt-specific
  lockFocalLength: boolean;
  onLockFocalLengthChange: (val: boolean) => void;
  // Oval-specific
  ovalSnapMode?: "ellipse" | "parallel-minor";
  onOvalSnapModeChange?: (mode: "ellipse" | "parallel-minor") => void;
  // 5pt-specific colors
  fivePtCenterColor?: string;
  fivePtLRColor?: string;
  fivePtUDColor?: string;
  onFivePtCenterColorChange?: (c: string) => void;
  onFivePtLRColorChange?: (c: string) => void;
  onFivePtUDColorChange?: (c: string) => void;
  // 5pt guidance toggles
  fivePtEnableCenter?: boolean;
  fivePtEnableLR?: boolean;
  fivePtEnableUD?: boolean;
  onFivePtEnableCenterChange?: (v: boolean) => void;
  onFivePtEnableLRChange?: (v: boolean) => void;
  onFivePtEnableUDChange?: (v: boolean) => void;
  // Grid-specific
  gridMode?: "subdivide" | "extrude";
  onGridModeChange?: (mode: "subdivide" | "extrude") => void;
  gridVertSegments?: number;
  onGridVertSegmentsChange?: (v: number) => void;
  gridHorizSegments?: number;
  onGridHorizSegmentsChange?: (v: number) => void;
  gridPerspective?: boolean;
  onGridPerspectiveChange?: (v: boolean) => void;
  onGridReset?: () => void;
}

export function RulerPresetsPanel({
  rulerPresetType,
  onRulerPresetTypeChange,
  rulerColor,
  onRulerColorChange,
  vp1Color = "#ff0000",
  vp2Color = "#0000ff",
  vp3Color = "#00ff00",
  onVp1ColorChange,
  onVp2ColorChange,
  onVp3ColorChange,
  rulerWarmupDist,
  onRulerWarmupDistChange,
  lineSnapMode,
  onLineSnapModeChange,
  lockFocalLength,
  ovalSnapMode,
  onOvalSnapModeChange,
  onLockFocalLengthChange,
  gridMode = "subdivide",
  onGridModeChange,
  gridVertSegments = 4,
  onGridVertSegmentsChange,
  gridHorizSegments = 8,
  onGridHorizSegmentsChange,
  onGridReset,
  fivePtCenterColor = "#9333ea",
  fivePtLRColor = "#ff0000",
  fivePtUDColor = "#0000ff",
  onFivePtCenterColorChange,
  onFivePtLRColorChange,
  onFivePtUDColorChange,
  fivePtEnableCenter = true,
  fivePtEnableLR = true,
  fivePtEnableUD = true,
  onFivePtEnableCenterChange,
  onFivePtEnableLRChange,
  onFivePtEnableUDChange,
}: RulerPresetsPanelProps) {
  const is2pt = rulerPresetType === "perspective-2pt";
  const is3pt = rulerPresetType === "perspective-3pt";
  const isGrid = rulerPresetType === "grid";
  const is5pt = rulerPresetType === "perspective-5pt";

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2 mb-1">
        <Ruler size={14} className="text-primary" />
        <span className="text-xs font-semibold text-foreground">Ruler</span>
      </div>

      {/* Preset list */}
      <button
        type="button"
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs w-full text-left ${
          rulerPresetType === "line"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
        onClick={() => onRulerPresetTypeChange("line")}
        data-ocid="ruler.item.line"
      >
        <Minus size={12} />
        <span>Line</span>
      </button>

      <button
        type="button"
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs w-full text-left ${
          rulerPresetType === "grid"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
        onClick={() => onRulerPresetTypeChange("grid")}
        data-ocid="ruler.item.grid"
      >
        <Grid size={12} />
        <span>Grid</span>
      </button>

      <button
        type="button"
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs w-full text-left ${
          rulerPresetType === "oval"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
        onClick={() => onRulerPresetTypeChange("oval")}
        data-ocid="ruler.item.oval"
      >
        <Circle size={12} />
        <span>Ellipse</span>
      </button>

      <button
        type="button"
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs w-full text-left ${
          rulerPresetType === "perspective-1pt"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
        onClick={() => onRulerPresetTypeChange("perspective-1pt")}
        data-ocid="ruler.item.perspective-1pt"
      >
        <Ruler size={12} />
        <span>1-Point Perspective</span>
      </button>

      <button
        type="button"
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs w-full text-left ${
          rulerPresetType === "perspective-2pt"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
        onClick={() => onRulerPresetTypeChange("perspective-2pt")}
        data-ocid="ruler.item.perspective-2pt"
      >
        <Ruler size={12} />
        <span>2-Point Perspective</span>
      </button>

      <button
        type="button"
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs w-full text-left ${
          rulerPresetType === "perspective-3pt"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
        onClick={() => onRulerPresetTypeChange("perspective-3pt")}
        data-ocid="ruler.item.perspective-3pt"
      >
        <Ruler size={12} />
        <span>3-Point Perspective</span>
      </button>

      <button
        type="button"
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs w-full text-left ${
          rulerPresetType === "perspective-5pt"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
        onClick={() => onRulerPresetTypeChange("perspective-5pt")}
        data-ocid="ruler.item.perspective-5pt"
      >
        <Ruler size={12} />
        <span>5-Point Perspective</span>
      </button>

      {/* Ruler color — shown for all ruler types */}
      {
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[11px] text-muted-foreground flex-1">
            Ruler Color
          </span>
          <input
            type="color"
            value={rulerColor}
            onChange={(e) => onRulerColorChange(e.target.value)}
            className="w-7 h-7 rounded cursor-pointer border border-border p-0.5 bg-transparent"
            data-ocid="ruler.color_input"
          />
        </div>
      }

      {/* VP colors for 2pt */}
      {is2pt && (
        <div className="flex flex-col gap-1.5 mt-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground flex-1">
              VP1 Color
            </span>
            <input
              type="color"
              value={vp1Color}
              onChange={(e) => onVp1ColorChange?.(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border border-border p-0.5 bg-transparent"
              data-ocid="ruler.vp1_color_input"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground flex-1">
              VP2 Color
            </span>
            <input
              type="color"
              value={vp2Color}
              onChange={(e) => onVp2ColorChange?.(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border border-border p-0.5 bg-transparent"
              data-ocid="ruler.vp2_color_input"
            />
          </div>
        </div>
      )}

      {/* VP colors for 3pt */}
      {is3pt && (
        <div className="flex flex-col gap-1.5 mt-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground flex-1">
              VP1 Color
            </span>
            <input
              type="color"
              value={vp1Color}
              onChange={(e) => onVp1ColorChange?.(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border border-border p-0.5 bg-transparent"
              data-ocid="ruler.vp1_color_input"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground flex-1">
              VP2 Color
            </span>
            <input
              type="color"
              value={vp2Color}
              onChange={(e) => onVp2ColorChange?.(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border border-border p-0.5 bg-transparent"
              data-ocid="ruler.vp2_color_input"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground flex-1">
              VP3 Color
            </span>
            <input
              type="color"
              value={vp3Color}
              onChange={(e) => onVp3ColorChange?.(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border border-border p-0.5 bg-transparent"
              data-ocid="ruler.vp3_color_input"
            />
          </div>
        </div>
      )}

      {/* Perspective-1pt specific settings */}
      {rulerPresetType === "perspective-1pt" && (
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Warm-up Distance
            </span>
            <input
              type="number"
              min={4}
              max={24}
              value={rulerWarmupDist}
              onChange={(e) => {
                const v = Math.max(4, Math.min(24, Number(e.target.value)));
                onRulerWarmupDistChange(v);
              }}
              className="w-10 text-[11px] text-right bg-transparent border-b border-border text-foreground focus:outline-none"
            />
          </div>
          <input
            type="range"
            min={4}
            max={24}
            step={1}
            value={rulerWarmupDist}
            style={
              {
                "--fill-pct": `${((rulerWarmupDist - 4) / 20) * 100}%`,
              } as React.CSSProperties
            }
            onChange={(e) => onRulerWarmupDistChange(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
            Click canvas to place vanishing point. Drag handles to adjust. Shift
            inverts snap.
          </p>
        </div>
      )}

      {/* Perspective-2pt specific settings */}
      {rulerPresetType === "perspective-2pt" && (
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Warm-up Distance
            </span>
            <input
              type="number"
              min={4}
              max={24}
              value={rulerWarmupDist}
              onChange={(e) => {
                const v = Math.max(4, Math.min(24, Number(e.target.value)));
                onRulerWarmupDistChange(v);
              }}
              className="w-10 text-[11px] text-right bg-transparent border-b border-border text-foreground focus:outline-none"
            />
          </div>
          <input
            type="range"
            min={4}
            max={24}
            step={1}
            value={rulerWarmupDist}
            style={
              {
                "--fill-pct": `${((rulerWarmupDist - 4) / 20) * 100}%`,
              } as React.CSSProperties
            }
            onChange={(e) => onRulerWarmupDistChange(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[11px] text-muted-foreground">
              Lock Focal Length
            </span>
            <button
              type="button"
              onClick={() => onLockFocalLengthChange(!lockFocalLength)}
              className={`w-8 h-4 rounded-full transition-colors relative ${
                lockFocalLength ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0 w-3 h-3 rounded-full bg-white transition-transform ${
                  lockFocalLength ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
            Click canvas to place horizon center. Drag VP handles and horizon
            rotation handle to adjust. Shift inverts snap.
          </p>
        </div>
      )}

      {/* Perspective-3pt specific settings */}
      {rulerPresetType === "perspective-3pt" && (
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Warm-up Distance
            </span>
            <input
              type="number"
              min={4}
              max={24}
              value={rulerWarmupDist}
              onChange={(e) => {
                const v = Math.max(4, Math.min(24, Number(e.target.value)));
                onRulerWarmupDistChange(v);
              }}
              className="w-10 text-[11px] text-right bg-transparent border-b border-border text-foreground focus:outline-none"
            />
          </div>
          <input
            type="range"
            min={4}
            max={24}
            step={1}
            value={rulerWarmupDist}
            style={
              {
                "--fill-pct": `${((rulerWarmupDist - 4) / 20) * 100}%`,
              } as React.CSSProperties
            }
            onChange={(e) => onRulerWarmupDistChange(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[11px] text-muted-foreground">
              Lock Focal Length
            </span>
            <button
              type="button"
              onClick={() => onLockFocalLengthChange(!lockFocalLength)}
              className={`w-8 h-4 rounded-full transition-colors relative ${
                lockFocalLength ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0 w-3 h-3 rounded-full bg-white transition-transform ${
                  lockFocalLength ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
            Click canvas to place horizon. Drag VP1, VP2, D handles to adjust. D
            governs the vertical vanishing point (VP3). Shift inverts snap.
          </p>
        </div>
      )}

      {/* Line-specific settings */}
      {rulerPresetType === "line" && (
        <div className="flex flex-col gap-2 mt-1">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Snap Mode</span>
            <div className="flex gap-1">
              <button
                type="button"
                className={`flex-1 text-[11px] py-1 rounded ${
                  lineSnapMode === "line"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
                onClick={() => onLineSnapModeChange("line")}
              >
                Snap to Line
              </button>
              <button
                type="button"
                className={`flex-1 text-[11px] py-1 rounded ${
                  lineSnapMode === "parallel"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
                onClick={() => onLineSnapModeChange("parallel")}
              >
                Parallel
              </button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-tight">
            Click canvas to place line endpoints. Drag endpoints or center
            handle. Shift inverts snap.
          </p>
        </div>
      )}

      {/* Oval-specific settings */}
      {rulerPresetType === "oval" && (
        <div className="flex flex-col gap-2 mt-1">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Snap Mode</span>
            <div className="flex gap-1">
              <button
                type="button"
                className={`flex-1 text-[11px] py-1 rounded ${(ovalSnapMode ?? "ellipse") === "ellipse" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
                onClick={() => onOvalSnapModeChange?.("ellipse")}
              >
                Snap to Ellipse
              </button>
              <button
                type="button"
                className={`flex-1 text-[11px] py-1 rounded ${(ovalSnapMode ?? "ellipse") === "parallel-minor" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
                onClick={() => onOvalSnapModeChange?.("parallel-minor")}
              >
                Parallel to Minor
              </button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-tight">
            Click canvas to place ellipse. Drag handles to adjust. Shift inverts
            snap.
          </p>
        </div>
      )}

      {/* Grid-specific settings */}
      {isGrid && (
        <div className="flex flex-col gap-2 mt-1">
          {/* Mode toggle */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Mode</span>
            <div className="flex gap-1">
              <button
                type="button"
                className={`flex-1 text-[11px] py-1 rounded ${
                  gridMode === "subdivide"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
                onClick={() => onGridModeChange?.("subdivide")}
                data-ocid="ruler.grid_subdivide_button"
              >
                Subdivide
              </button>
              <button
                type="button"
                className={`flex-1 text-[11px] py-1 rounded ${
                  gridMode === "extrude"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
                onClick={() => onGridModeChange?.("extrude")}
                data-ocid="ruler.grid_extrude_button"
              >
                Extrude
              </button>
            </div>
          </div>

          {/* Subdivide-specific: segment sliders */}
          {gridMode === "subdivide" && (
            <>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Vertical Segments
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={gridVertSegments}
                    onChange={(e) => {
                      const v = Math.max(
                        1,
                        Math.min(20, Number(e.target.value)),
                      );
                      onGridVertSegmentsChange?.(v);
                    }}
                    className="w-10 text-[11px] text-right bg-transparent border-b border-border text-foreground focus:outline-none"
                    data-ocid="ruler.grid_vert_segments_input"
                  />
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={gridVertSegments}
                  onChange={(e) =>
                    onGridVertSegmentsChange?.(Number(e.target.value))
                  }
                  style={
                    {
                      "--fill-pct": `${((gridVertSegments - 1) / 19) * 100}%`,
                    } as React.CSSProperties
                  }
                  className="w-full"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Horizontal Segments
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={gridHorizSegments}
                    onChange={(e) => {
                      const v = Math.max(
                        1,
                        Math.min(20, Number(e.target.value)),
                      );
                      onGridHorizSegmentsChange?.(v);
                    }}
                    className="w-10 text-[11px] text-right bg-transparent border-b border-border text-foreground focus:outline-none"
                    data-ocid="ruler.grid_horiz_segments_input"
                  />
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={gridHorizSegments}
                  onChange={(e) =>
                    onGridHorizSegmentsChange?.(Number(e.target.value))
                  }
                  style={
                    {
                      "--fill-pct": `${((gridHorizSegments - 1) / 19) * 100}%`,
                    } as React.CSSProperties
                  }
                  className="w-full"
                />
              </div>
            </>
          )}

          {/* Reset */}
          <button
            type="button"
            onClick={onGridReset}
            className="mt-1 text-[11px] py-1 rounded bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            data-ocid="ruler.grid_reset_button"
          >
            Reset
          </button>

          <p className="text-[10px] text-muted-foreground leading-tight">
            Drag corner or edge handles to reshape the grid quad. Shift inverts
            snap.
          </p>
        </div>
      )}
      {/* 5-Point Perspective specific settings */}
      {is5pt && (
        <div className="flex flex-col gap-1.5 mt-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground flex-1">
              Center Color
            </span>
            <input
              type="color"
              value={fivePtCenterColor}
              onChange={(e) => onFivePtCenterColorChange?.(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border border-border p-0.5 bg-transparent"
              data-ocid="ruler.fivepl_center_color_input"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground flex-1">
              Left/Right Color
            </span>
            <input
              type="color"
              value={fivePtLRColor}
              onChange={(e) => onFivePtLRColorChange?.(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border border-border p-0.5 bg-transparent"
              data-ocid="ruler.fivepl_lr_color_input"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground flex-1">
              Up/Down Color
            </span>
            <input
              type="color"
              value={fivePtUDColor}
              onChange={(e) => onFivePtUDColorChange?.(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border border-border p-0.5 bg-transparent"
              data-ocid="ruler.fivepl_ud_color_input"
            />
          </div>
          <div className="flex flex-col gap-1 mt-2">
            <span className="text-[11px] font-medium text-foreground">
              Guide Families
            </span>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={fivePtEnableCenter}
                onChange={(e) => onFivePtEnableCenterChange?.(e.target.checked)}
                className=""
                data-ocid="ruler.fivepl_enable_center_checkbox"
              />
              <span className="text-[11px] text-muted-foreground">
                Central VP
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={fivePtEnableLR}
                onChange={(e) => onFivePtEnableLRChange?.(e.target.checked)}
                className=""
                data-ocid="ruler.fivepl_enable_lr_checkbox"
              />
              <span className="text-[11px] text-muted-foreground">
                Left/Right VPs
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={fivePtEnableUD}
                onChange={(e) => onFivePtEnableUDChange?.(e.target.checked)}
                className=""
                data-ocid="ruler.fivepl_enable_ud_checkbox"
              />
              <span className="text-[11px] text-muted-foreground">
                Up/Down VPs
              </span>
            </label>
          </div>
          <div className="flex flex-col gap-1 mt-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                Warm-up Distance
              </span>
              <input
                type="number"
                min={4}
                max={24}
                value={rulerWarmupDist}
                onChange={(e) => {
                  const v = Math.max(4, Math.min(24, Number(e.target.value)));
                  onRulerWarmupDistChange(v);
                }}
                className="w-10 text-[11px] text-right bg-transparent border-b border-border text-foreground focus:outline-none"
              />
            </div>
            <input
              type="range"
              min={4}
              max={24}
              step={1}
              value={rulerWarmupDist}
              style={
                {
                  "--fill-pct": `${((rulerWarmupDist - 4) / 20) * 100}%`,
                } as React.CSSProperties
              }
              onChange={(e) => onRulerWarmupDistChange(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
            Click canvas to place the center. Drag handles A (up/down VP), B
            (left/right VP), C (free scale), D (rotate). Shift inverts snap.
          </p>
        </div>
      )}
    </div>
  );
}
