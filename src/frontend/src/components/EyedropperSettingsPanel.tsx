import { ScrollArea } from "@/components/ui/scroll-area";

interface EyedropperSettingsPanelProps {
  sampleSource: "canvas" | "layer";
  onSampleSourceChange: (v: "canvas" | "layer") => void;
  sampleSize: 1 | 3 | 5;
  onSampleSizeChange: (v: 1 | 3 | 5) => void;
}

export function EyedropperSettingsPanel({
  sampleSource,
  onSampleSourceChange,
  sampleSize,
  onSampleSizeChange,
}: EyedropperSettingsPanelProps) {
  const sampleSizes: { value: 1 | 3 | 5; label: string }[] = [
    { value: 1, label: "1px" },
    { value: 3, label: "3×3 avg" },
    { value: 5, label: "5×5 avg" },
  ];

  return (
    <div
      className="flex flex-col border-r border-border bg-card h-full"
      style={{ width: "100%", minWidth: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Eyedropper
        </span>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 p-3">
          {/* Sample Source */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
              Sample Source
            </span>
            <div className="flex flex-col gap-1">
              {(
                [
                  { value: "canvas" as const, label: "Entire Canvas" },
                  { value: "layer" as const, label: "Active Layer" },
                ] as const
              ).map((item) => {
                const isActive = sampleSource === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    data-ocid={`eyedropper.sample_source.${item.value}`}
                    onClick={() => onSampleSourceChange(item.value)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium w-full text-left transition-all duration-100 ${
                      isActive
                        ? "bg-primary/10 border border-primary text-primary"
                        : "border border-border bg-muted/30 hover:bg-muted/60 text-foreground"
                    }`}
                  >
                    <span
                      className={`w-3 h-3 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        isActive ? "border-primary" : "border-muted-foreground"
                      }`}
                    >
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sample Size */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
              Sample Size
            </span>
            <div className="flex gap-1">
              {sampleSizes.map((item) => {
                const isActive = sampleSize === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    data-ocid={`eyedropper.sample_size.${item.value}`}
                    onClick={() => onSampleSizeChange(item.value)}
                    className={`flex-1 py-1.5 text-xs rounded border transition-colors font-medium ${
                      isActive
                        ? "bg-primary/10 border-primary text-primary"
                        : "border-border bg-muted/30 text-foreground hover:bg-muted/60"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
