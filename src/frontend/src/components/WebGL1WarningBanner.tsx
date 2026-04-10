interface WebGL1WarningBannerProps {
  visible: boolean;
  onDismiss: () => void;
}

export function WebGL1WarningBanner({
  visible,
  onDismiss,
}: WebGL1WarningBannerProps) {
  if (!visible) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-100 dark:bg-amber-900/50 border-b border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 text-sm z-50 shrink-0">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Warning"
        role="img"
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
      <span className="flex-1">
        Your device is using WebGL 1 — some features may have reduced quality.
        For best results, use a modern browser or device that supports WebGL 2.
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-2 p-0.5 rounded hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
        aria-label="Dismiss warning"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-label="Close"
          role="img"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
}
