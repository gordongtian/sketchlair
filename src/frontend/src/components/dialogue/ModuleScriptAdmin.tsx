/**
 * ModuleScriptAdmin — sidebar + ScriptEditor for managing per-module dialogue
 * scripts in the admin portal.
 */

import type { Identity } from "@icp-sdk/core/agent";
import { useState } from "react";
import { ScriptEditor } from "./ScriptEditor";

// ─── Module registry ──────────────────────────────────────────────────────────

interface AdminModule {
  id: string;
  name: string;
  available: boolean;
}

const ADMIN_MODULES: AdminModule[] = [
  { id: "guide", name: "Guide", available: true },
  { id: "figure-drawing", name: "Figure Drawing", available: true },
  { id: "still-life", name: "Still Life", available: false },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface ModuleScriptAdminProps {
  identity: Identity | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ModuleScriptAdmin({ identity }: ModuleScriptAdminProps) {
  const [selectedId, setSelectedId] = useState<string>(ADMIN_MODULES[0].id);

  const selectedModule =
    ADMIN_MODULES.find((m) => m.id === selectedId) ?? ADMIN_MODULES[0];

  return (
    <div
      data-ocid="module_script_admin.panel"
      style={{
        display: "flex",
        gap: 20,
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* Module selector sidebar */}
      <div
        style={{
          width: 180,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "oklch(var(--muted-text))",
            marginBottom: 6,
            padding: "0 4px",
          }}
        >
          Modules
        </p>

        {ADMIN_MODULES.map((mod) => {
          const isActive = mod.id === selectedId;
          return (
            <button
              key={mod.id}
              type="button"
              data-ocid={`module_script_admin.module_tab.${mod.id}`}
              onClick={() => setSelectedId(mod.id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 10px",
                borderRadius: 7,
                border: isActive
                  ? "1px solid oklch(var(--accent) / 0.3)"
                  : "1px solid transparent",
                backgroundColor: isActive
                  ? "oklch(var(--accent) / 0.12)"
                  : "transparent",
                color: isActive
                  ? "oklch(var(--accent))"
                  : mod.available
                    ? "oklch(var(--text))"
                    : "oklch(var(--muted-text))",
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                textAlign: "left",
                cursor: "pointer",
                transition: "all 0.15s",
                width: "100%",
              }}
            >
              <span
                style={
                  {
                    truncate: "ellipsis",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  } as React.CSSProperties
                }
              >
                {mod.name}
              </span>
              {!mod.available && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: "oklch(var(--muted-text))",
                    backgroundColor: "oklch(var(--muted-text) / 0.15)",
                    padding: "1px 5px",
                    borderRadius: 3,
                    letterSpacing: "0.04em",
                    flexShrink: 0,
                    marginLeft: 6,
                  }}
                >
                  SOON
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Script editor */}
      <div
        data-ocid="module_script_admin.editor_area"
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ScriptEditor
          key={selectedModule.id}
          moduleId={selectedModule.id}
          moduleName={selectedModule.name}
          identity={identity}
        />
      </div>
    </div>
  );
}
