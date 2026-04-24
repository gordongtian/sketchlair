/**
 * AdminPortal — full-screen admin view.
 *
 * Only accessible to principals with admin status (isCallerAdmin).
 * Currently contains one section: Image Set Manager.
 * Sidebar nav is structured for future expansion.
 */

import { ImageSetManager } from "@/components/ImageSetManager";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Image, ShieldCheck } from "lucide-react";
import { useState } from "react";

interface AdminPortalProps {
  onBack: () => void;
}

type AdminSection = "image-sets";

const NAV_ITEMS: { id: AdminSection; label: string; icon: typeof Image }[] = [
  { id: "image-sets", label: "Image Sets", icon: Image },
];

export function AdminPortal({ onBack }: AdminPortalProps) {
  const { identity } = useAuth();
  const [activeSection, setActiveSection] =
    useState<AdminSection>("image-sets");

  return (
    <div
      data-ocid="admin_portal.panel"
      className="fixed inset-0 z-[9500] flex flex-col"
      style={{
        backgroundColor: "oklch(var(--canvas-bg) / 0.98)",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-4 px-6 py-4 shrink-0 border-b"
        style={{
          backgroundColor: "oklch(var(--toolbar))",
          borderColor: "oklch(var(--outline))",
        }}
      >
        <button
          type="button"
          data-ocid="admin_portal.back_button"
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-opacity hover:opacity-80"
          style={{
            backgroundColor: "oklch(var(--sidebar-left))",
            color: "oklch(var(--text))",
            border: "1px solid oklch(var(--outline))",
          }}
          aria-label="Back to splash screen"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "oklch(var(--accent) / 0.2)" }}
          >
            <ShieldCheck size={14} style={{ color: "oklch(var(--accent))" }} />
          </div>
          <h1
            className="text-sm font-semibold"
            style={{ color: "oklch(var(--text))" }}
          >
            Admin Portal
          </h1>
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar nav */}
        <nav
          className="flex flex-col gap-1 p-4 w-52 shrink-0 border-r"
          style={{
            backgroundColor: "oklch(var(--toolbar))",
            borderColor: "oklch(var(--outline))",
          }}
          aria-label="Admin sections"
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-2 px-2"
            style={{ color: "oklch(var(--muted-text))" }}
          >
            Sections
          </p>
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              data-ocid={`admin_portal.tab.${id}`}
              onClick={() => setActiveSection(id)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-all"
              style={{
                backgroundColor:
                  activeSection === id
                    ? "oklch(var(--accent) / 0.15)"
                    : "transparent",
                color:
                  activeSection === id
                    ? "oklch(var(--accent))"
                    : "oklch(var(--text))",
                border:
                  activeSection === id
                    ? "1px solid oklch(var(--accent) / 0.3)"
                    : "1px solid transparent",
              }}
            >
              <Icon
                size={14}
                style={{
                  color:
                    activeSection === id
                      ? "oklch(var(--accent))"
                      : "oklch(var(--muted-text))",
                }}
              />
              {label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main
          className="flex-1 min-w-0 p-6 overflow-y-auto"
          style={{ backgroundColor: "oklch(var(--canvas-bg))" }}
        >
          {activeSection === "image-sets" && (
            <ImageSetManager identity={identity!} />
          )}
        </main>
      </div>
    </div>
  );
}
