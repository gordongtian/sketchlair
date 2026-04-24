// ── FigureDrawingSetup ─────────────────────────────────────────────────────────
//
// 4-screen setup wizard for Figure Drawing sessions.
// Screens: 1 Image Sets → 2 Pose Count → 3 Pose Duration → 4 Reference Mode
// Selections are preserved when navigating back.

import { createActorWithConfig } from "@/config";
import { useInternetIdentity } from "@/hooks/useInternetIdentity";
import type {
  FigureDrawingConfig,
  ImageSet,
  ReferenceMode,
} from "@/types/learn";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Layers,
  Maximize2,
  Play,
  ShoppingBag,
  Tv2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

// ── Default image sets ────────────────────────────────────────────────────────

const DEFAULT_SETS: ImageSet[] = [
  {
    id: "starter-male",
    name: "Starter Set — Male",
    previewThumbnail: "https://blob.caffeine.ai/placeholder/male-preview.jpg",
    imageCount: 20,
    isDefault: true,
    images: [],
  },
  {
    id: "starter-female",
    name: "Starter Set — Female",
    previewThumbnail: "https://blob.caffeine.ai/placeholder/female-preview.jpg",
    imageCount: 20,
    isDefault: true,
    images: [],
  },
];

// ── Option data ───────────────────────────────────────────────────────────────

const POSE_COUNTS: Array<number | "all"> = [2, 5, 10, 15, 20, "all"];

const DURATION_OPTIONS: { label: string; value: number | null }[] = [
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "1.5m", value: 90 },
  { label: "2m", value: 120 },
  { label: "3m", value: 180 },
  { label: "5m", value: 300 },
  { label: "10m", value: 600 },
  { label: "∞", value: null },
];

const REFERENCE_MODES: {
  mode: ReferenceMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    mode: "flash",
    label: "Flash and Disappear",
    description:
      "Reference appears for 5 seconds, then disappears. Draw from memory.",
    icon: <EyeOff size={18} />,
  },
  {
    mode: "side",
    label: "Side Canvas",
    description: "Reference sits beside your canvas, moving with the camera.",
    icon: <Tv2 size={18} />,
  },
  {
    mode: "floating",
    label: "Floating",
    description:
      "A small draggable window with the reference. Position it anywhere.",
    icon: <Maximize2 size={18} />,
  },
  {
    mode: "tracing",
    label: "Tracing",
    description:
      "Reference is a faint layer beneath your drawing. Trace directly over it.",
    icon: <Layers size={18} />,
  },
];

// ── Animation helpers ─────────────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 32 : -32 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -32 : 32 }),
};

const transition = { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const };

// ── Shared pill button ────────────────────────────────────────────────────────

function PillButton({
  selected,
  onClick,
  children,
  ocid,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ocid?: string;
}) {
  return (
    <button
      type="button"
      data-ocid={ocid}
      onClick={onClick}
      className="relative px-4 py-2 rounded-lg text-sm font-medium transition-all"
      style={{
        backgroundColor: selected
          ? "oklch(var(--accent))"
          : "oklch(var(--toolbar))",
        color: selected ? "oklch(var(--accent-text))" : "oklch(var(--text))",
        border: selected
          ? "1.5px solid oklch(var(--accent))"
          : "1.5px solid oklch(var(--outline))",
        boxShadow: selected
          ? "0 0 0 2px oklch(var(--accent) / 0.18)"
          : undefined,
      }}
    >
      {children}
    </button>
  );
}

// ── Step header ───────────────────────────────────────────────────────────────

function StepHeader({
  step,
  total,
  title,
}: {
  step: number;
  total: number;
  title: string;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={`step-dot-${i + 1}`}
            className="h-1 flex-1 rounded-full transition-all duration-300"
            style={{
              backgroundColor:
                i < step ? "oklch(var(--accent))" : "oklch(var(--outline))",
            }}
          />
        ))}
      </div>
      <p
        className="text-[11px] font-semibold uppercase tracking-widest"
        style={{ color: "oklch(var(--muted-text))" }}
      >
        Step {step} of {total}
      </p>
      <h2
        className="text-lg font-bold mt-0.5"
        style={{ color: "oklch(var(--text))" }}
      >
        {title}
      </h2>
    </div>
  );
}

// ── Nav row ───────────────────────────────────────────────────────────────────

function NavRow({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  nextOcid,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextOcid?: string;
}) {
  return (
    <div
      className="flex items-center justify-between mt-6 pt-4 border-t"
      style={{ borderColor: "oklch(var(--outline))" }}
    >
      <button
        type="button"
        data-ocid="figure_drawing_setup.back_button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
        style={{
          color: "oklch(var(--muted-text))",
          backgroundColor: "oklch(var(--sidebar-left))",
          border: "1px solid oklch(var(--outline))",
        }}
      >
        <ArrowLeft size={14} />
        Back
      </button>
      <button
        type="button"
        data-ocid={nextOcid ?? "figure_drawing_setup.next_button"}
        onClick={onNext}
        disabled={nextDisabled}
        className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-lg font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          backgroundColor: "oklch(var(--accent))",
          color: "oklch(var(--accent-text))",
        }}
      >
        {nextLabel ?? "Next"}
        {nextLabel ? <Play size={13} /> : <ArrowRight size={14} />}
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface FigureDrawingSetupProps {
  onStart: (config: FigureDrawingConfig, imageSets: ImageSet[]) => void;
  onBack: () => void;
  /** Called when the user clicks "Get More Image Sets" — opens the marketplace */
  onShowMarketplace?: () => void;
}

export function FigureDrawingSetup({
  onStart,
  onBack,
  onShowMarketplace,
}: FigureDrawingSetupProps) {
  const { identity } = useInternetIdentity();
  const isAuthenticated = !!identity && !identity.getPrincipal().isAnonymous();

  // Wizard state
  const [screen, setScreen] = useState(1);
  const [direction, setDirection] = useState(1); // +1 = forward, -1 = back

  const [imageSets, setImageSets] = useState<ImageSet[]>([]);
  const [setsLoading, setSetsLoading] = useState(true);
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  const [triedNext, setTriedNext] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [poseCount, setPoseCount] = useState<number | "all">(10);
  const [poseDuration, setPoseDuration] = useState<number | null>(60);
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("side");

  // Toast state
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3500);
  };

  // Fetch image sets from canister, fall back to defaults
  useEffect(() => {
    let cancelled = false;
    setSetsLoading(true);

    const loadSets = async () => {
      try {
        const actor = await createActorWithConfig(
          identity ? { identity } : undefined,
        );
        const rawSets = await actor.getAvailableImageSets();
        if (cancelled) return;
        if (rawSets.length > 0) {
          // Map backend bigint fields to number for the frontend ImageSet type
          const sets: ImageSet[] = rawSets.map((s) => ({
            id: s.id,
            name: s.name,
            previewThumbnail: s.previewThumbnail,
            imageCount: Number(s.imageCount),
            isDefault: s.isDefault,
            images: s.images.map((img) => ({
              id: img.id,
              assetUrl: img.assetUrl,
              width: Number(img.width),
              height: Number(img.height),
            })),
            tags: s.tags ?? [],
          }));
          setImageSets(sets);
        } else {
          setImageSets(DEFAULT_SETS);
        }
      } catch {
        if (!cancelled) setImageSets(DEFAULT_SETS);
      } finally {
        if (!cancelled) setSetsLoading(false);
      }
    };

    void loadSets();
    return () => {
      cancelled = true;
    };
  }, [identity]);

  const navigate = (nextScreen: number) => {
    setDirection(nextScreen > screen ? 1 : -1);
    if (nextScreen !== 1) {
      // leaving screen 1 — reset the "tried next" flag so it doesn't bleed
      setTriedNext(false);
    }
    setScreen(nextScreen);
  };

  const handleStart = () => {
    onStart(
      { selectedSetIds, poseCount, poseDuration, referenceMode },
      imageSets,
    );
  };

  const canDeselect = (setId: string): boolean =>
    selectedSetIds.length > 1 || !selectedSetIds.includes(setId);

  const toggleSet = (id: string) => {
    if (!canDeselect(id)) return;
    setSelectedSetIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  return (
    <div className="relative w-full max-w-md">
      {/* Toast */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="absolute -top-12 left-0 right-0 flex justify-center z-10"
          >
            <div
              className="text-xs px-4 py-2 rounded-xl font-medium"
              style={{
                backgroundColor: "oklch(var(--toolbar))",
                border: "1px solid oklch(var(--accent) / 0.4)",
                color: "oklch(var(--text))",
              }}
            >
              {toastMsg}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Wizard screens */}
      <AnimatePresence mode="wait" custom={direction}>
        {screen === 1 && (
          <motion.div
            key="screen-1"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
          >
            <Screen1ImageSets
              imageSets={imageSets}
              setsLoading={setsLoading}
              selectedSetIds={selectedSetIds}
              isAuthenticated={isAuthenticated}
              triedNext={triedNext}
              selectedTags={selectedTags}
              onTagToggle={(tag) => {
                if (tag === "all") {
                  setSelectedTags([]);
                } else {
                  setSelectedTags((prev) =>
                    prev.includes(tag)
                      ? prev.filter((t) => t !== tag)
                      : [...prev, tag],
                  );
                }
              }}
              onToggle={toggleSet}
              canDeselect={canDeselect}
              onGetMore={() => {
                if (onShowMarketplace) {
                  onShowMarketplace();
                } else {
                  showToast("Marketplace coming soon");
                }
              }}
              onBack={onBack}
              onNext={() => {
                if (selectedSetIds.length === 0) {
                  setTriedNext(true);
                } else {
                  navigate(2);
                }
              }}
            />
          </motion.div>
        )}

        {screen === 2 && (
          <motion.div
            key="screen-2"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
          >
            <Screen2PoseCount
              poseCount={poseCount}
              onSelect={setPoseCount}
              onBack={() => navigate(1)}
              onNext={() => navigate(3)}
            />
          </motion.div>
        )}

        {screen === 3 && (
          <motion.div
            key="screen-3"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
          >
            <Screen3PoseDuration
              poseDuration={poseDuration}
              onSelect={setPoseDuration}
              onBack={() => navigate(2)}
              onNext={() => navigate(4)}
            />
          </motion.div>
        )}

        {screen === 4 && (
          <motion.div
            key="screen-4"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
          >
            <Screen4ReferenceMode
              referenceMode={referenceMode}
              onSelect={setReferenceMode}
              onBack={() => navigate(3)}
              onStart={handleStart}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Screen 1: Image Sets ──────────────────────────────────────────────────────

function Screen1ImageSets({
  imageSets,
  setsLoading,
  selectedSetIds,
  isAuthenticated,
  triedNext,
  selectedTags,
  onTagToggle,
  onToggle,
  canDeselect,
  onGetMore,
  onBack,
  onNext,
}: {
  imageSets: ImageSet[];
  setsLoading: boolean;
  selectedSetIds: string[];
  isAuthenticated: boolean;
  triedNext: boolean;
  selectedTags: string[];
  onTagToggle: (tag: string | "all") => void;
  onToggle: (id: string) => void;
  canDeselect: (id: string) => boolean;
  onGetMore: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  // Collect unique tags across all sets, sorted alphabetically
  const allTags = Array.from(
    new Set(
      imageSets.flatMap((s) => (s.tags ?? []).map((t) => t.toLowerCase())),
    ),
  ).sort();

  // Whether to show the filter bar (only if at least one set has at least one tag)
  const showFilterBar = allTags.length > 0;

  // Filtered sets: when no tags selected show all; otherwise show matching + untagged
  const filteredSets =
    selectedTags.length === 0
      ? imageSets
      : imageSets.filter((s) => {
          const setTags = (s.tags ?? []).map((t) => t.toLowerCase());
          if (setTags.length === 0) return true; // untagged sets always show
          return setTags.some((t) => selectedTags.includes(t));
        });

  const showError = triedNext && selectedSetIds.length === 0;

  return (
    <div>
      <StepHeader step={1} total={4} title="Choose Your Image Sets" />

      {/* Tag filter bar — only shown when sets have tags */}
      {showFilterBar && !setsLoading && (
        <div
          className="flex gap-1.5 overflow-x-auto pb-1 mb-3 scrollbar-none"
          style={{ scrollbarWidth: "none" }}
          data-ocid="figure_drawing_setup.tag_filter_bar"
        >
          {/* All pill */}
          <button
            type="button"
            data-ocid="figure_drawing_setup.tag_filter_all"
            onClick={() => onTagToggle("all")}
            className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
            style={{
              backgroundColor:
                selectedTags.length === 0
                  ? "oklch(var(--accent))"
                  : "oklch(var(--toolbar))",
              color:
                selectedTags.length === 0
                  ? "oklch(var(--accent-text))"
                  : "oklch(var(--muted-text))",
              border:
                selectedTags.length === 0
                  ? "1.5px solid oklch(var(--accent))"
                  : "1.5px solid oklch(var(--outline))",
            }}
          >
            All
          </button>

          {/* One pill per unique tag */}
          {allTags.map((tag) => {
            const isActive = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                data-ocid={`figure_drawing_setup.tag_filter.${tag.replace(/[^a-z0-9]/g, "_")}`}
                onClick={() => onTagToggle(tag)}
                className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                style={{
                  backgroundColor: isActive
                    ? "oklch(var(--accent))"
                    : "oklch(var(--toolbar))",
                  color: isActive
                    ? "oklch(var(--accent-text))"
                    : "oklch(var(--muted-text))",
                  border: isActive
                    ? "1.5px solid oklch(var(--accent))"
                    : "1.5px solid oklch(var(--outline))",
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {/* Loading skeleton */}
      {setsLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {(["skeleton-a", "skeleton-b"] as const).map((k) => (
            <div
              key={k}
              className="rounded-xl h-36 animate-pulse"
              style={{ backgroundColor: "oklch(var(--toolbar))" }}
            />
          ))}
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          }}
        >
          {filteredSets.map((set, idx) => {
            const isSelected = selectedSetIds.includes(set.id);
            const isDisabled = isSelected && !canDeselect(set.id);
            const thumbnailUrl =
              set.previewThumbnail ||
              (set.images && set.images.length > 0
                ? set.images[0].assetUrl
                : "");
            console.log(
              `[SetSelection] set "${set.name}" thumbnail URL: "${thumbnailUrl}" images count: ${set.images?.length ?? 0}`,
            );
            return (
              <button
                key={set.id}
                type="button"
                data-ocid={`figure_drawing_setup.image_set.${idx + 1}`}
                onClick={() => !isDisabled && onToggle(set.id)}
                disabled={isDisabled}
                title={
                  isDisabled ? "At least one set must be selected" : undefined
                }
                className="relative rounded-xl text-left overflow-hidden transition-all"
                style={{
                  backgroundColor: "oklch(var(--toolbar))",
                  border: isSelected
                    ? "2px solid oklch(var(--accent))"
                    : "2px solid oklch(var(--outline))",
                  boxShadow: isSelected
                    ? "0 0 0 2px oklch(var(--accent) / 0.18)"
                    : undefined,
                  opacity: isDisabled ? 0.55 : 1,
                  cursor: isDisabled ? "not-allowed" : "pointer",
                }}
              >
                {/* Thumbnail */}
                <div
                  className="w-full aspect-video overflow-hidden flex items-center justify-center"
                  style={{ backgroundColor: "oklch(var(--sidebar-left))" }}
                >
                  {thumbnailUrl ? (
                    <img
                      src={thumbnailUrl}
                      alt={set.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <span
                      className="text-xs text-center px-2 leading-tight"
                      style={{ color: "oklch(var(--muted-text))" }}
                    >
                      {set.name}
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="p-3">
                  <div
                    className="text-sm font-semibold leading-tight"
                    style={{ color: "oklch(var(--text))" }}
                  >
                    {set.name}
                  </div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: "oklch(var(--muted-text))" }}
                  >
                    {set.imageCount} images
                  </div>
                </div>

                {/* Selected badge */}
                {isSelected && (
                  <div
                    className="absolute top-2 right-2 rounded-full p-0.5"
                    style={{ backgroundColor: "oklch(var(--accent))" }}
                  >
                    <CheckCircle2
                      size={14}
                      style={{ color: "oklch(var(--accent-text))" }}
                    />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Auth note */}
      {!isAuthenticated && (
        <p
          className="text-xs mt-3"
          style={{ color: "oklch(var(--muted-text))" }}
        >
          Sign in to purchase additional image sets
        </p>
      )}

      {/* Get More button */}
      <button
        type="button"
        data-ocid="figure_drawing_setup.get_more_sets_button"
        onClick={onGetMore}
        className="flex items-center gap-2 w-full mt-4 px-4 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
        style={{
          backgroundColor: "oklch(var(--sidebar-left))",
          border: "1px solid oklch(var(--outline))",
          color: "oklch(var(--muted-text))",
        }}
      >
        <ShoppingBag size={15} />
        Get More Image Sets
      </button>

      {/* Inline error when user tries to proceed without selecting a set */}
      <AnimatePresence>
        {showError && (
          <motion.p
            key="no-set-error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            data-ocid="figure_drawing_setup.no_set_error_state"
            className="text-xs mt-3 overflow-hidden"
            style={{ color: "oklch(var(--error, 0.65 0.22 25))" }}
          >
            Please select at least one image set to continue.
          </motion.p>
        )}
      </AnimatePresence>

      {/* Nav */}
      <NavRow
        onBack={onBack}
        onNext={onNext}
        nextOcid="figure_drawing_setup.screen1_next_button"
      />
    </div>
  );
}

// ── Screen 2: Pose Count ──────────────────────────────────────────────────────

function Screen2PoseCount({
  poseCount,
  onSelect,
  onBack,
  onNext,
}: {
  poseCount: number | "all";
  onSelect: (n: number | "all") => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <StepHeader step={2} total={4} title="How many poses?" />
      <div className="flex flex-wrap gap-2">
        {POSE_COUNTS.map((n) => (
          <PillButton
            key={String(n)}
            selected={poseCount === n}
            onClick={() => onSelect(n)}
            ocid={`figure_drawing_setup.pose_count_${n}`}
          >
            {n === "all" ? "All" : n}
          </PillButton>
        ))}
      </div>
      <NavRow
        onBack={onBack}
        onNext={onNext}
        nextOcid="figure_drawing_setup.screen2_next_button"
      />
    </div>
  );
}

// ── Screen 3: Pose Duration ───────────────────────────────────────────────────

function Screen3PoseDuration({
  poseDuration,
  onSelect,
  onBack,
  onNext,
}: {
  poseDuration: number | null;
  onSelect: (d: number | null) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <StepHeader step={3} total={4} title="How long per pose?" />
      <div className="flex flex-wrap gap-2">
        {DURATION_OPTIONS.map(({ label, value }) => (
          <PillButton
            key={label}
            selected={poseDuration === value}
            onClick={() => onSelect(value)}
            ocid={`figure_drawing_setup.duration_${label.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`}
          >
            {label}
          </PillButton>
        ))}
      </div>

      {/* Infinite mode note */}
      <AnimatePresence>
        {poseDuration === null && (
          <motion.p
            key="inf-note"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="text-xs mt-3 overflow-hidden"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            Timer counts up and you advance poses manually
          </motion.p>
        )}
      </AnimatePresence>

      <NavRow
        onBack={onBack}
        onNext={onNext}
        nextOcid="figure_drawing_setup.screen3_next_button"
      />
    </div>
  );
}

// ── Screen 4: Reference Mode ──────────────────────────────────────────────────

function Screen4ReferenceMode({
  referenceMode,
  onSelect,
  onBack,
  onStart,
}: {
  referenceMode: ReferenceMode;
  onSelect: (m: ReferenceMode) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  return (
    <div>
      <StepHeader
        step={4}
        total={4}
        title="How do you want to see the reference?"
      />

      <div className="flex flex-col gap-2">
        {REFERENCE_MODES.map(({ mode, label, description, icon }) => {
          const isSelected = referenceMode === mode;
          return (
            <button
              key={mode}
              type="button"
              data-ocid={`figure_drawing_setup.reference_mode_${mode}`}
              onClick={() => onSelect(mode)}
              className="flex items-start gap-3 p-3.5 rounded-xl text-left transition-all hover:opacity-90"
              style={{
                backgroundColor: isSelected
                  ? "oklch(var(--accent) / 0.12)"
                  : "oklch(var(--toolbar))",
                border: isSelected
                  ? "2px solid oklch(var(--accent))"
                  : "2px solid oklch(var(--outline))",
              }}
            >
              <div
                className="mt-0.5 p-1.5 rounded-lg shrink-0"
                style={{
                  backgroundColor: isSelected
                    ? "oklch(var(--accent) / 0.2)"
                    : "oklch(var(--sidebar-left))",
                  color: isSelected
                    ? "oklch(var(--accent))"
                    : "oklch(var(--muted-text))",
                }}
              >
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className="text-sm font-semibold"
                  style={{ color: "oklch(var(--text))" }}
                >
                  {label}
                </div>
                <div
                  className="text-xs mt-0.5 leading-relaxed"
                  style={{ color: "oklch(var(--muted-text))" }}
                >
                  {description}
                </div>
              </div>
              {isSelected && (
                <CheckCircle2
                  size={16}
                  className="shrink-0 mt-0.5"
                  style={{ color: "oklch(var(--accent))" }}
                />
              )}
            </button>
          );
        })}
      </div>

      <NavRow
        onBack={onBack}
        onNext={onStart}
        nextLabel="Start Session"
        nextOcid="figure_drawing_setup.start_session_button"
      />
    </div>
  );
}
