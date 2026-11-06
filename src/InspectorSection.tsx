import { useState, type ReactNode } from "react";

const STORAGE_KEY = "momo-sound-forge:inspector:v1";
export type InspectorTab = "sound" | "playback" | "mix" | "automation";

function readPreferences(): { tab?: InspectorTab; closed?: Record<string, boolean> } {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return {
      tab: ["sound", "playback", "mix", "automation"].includes(value.tab) ? value.tab : undefined,
      closed: value.closed && typeof value.closed === "object" && !Array.isArray(value.closed)
        ? Object.fromEntries(Object.entries(value.closed).filter((entry): entry is [string, boolean] => entry[0].length < 100 && typeof entry[1] === "boolean"))
        : {},
    };
  } catch { return {}; }
}

function savePreferences(value: ReturnType<typeof readPreferences>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Preferences are optional. */ }
}

export function useInspectorTab() {
  const [tab, setTab] = useState<InspectorTab>(() => readPreferences().tab ?? "sound");
  return [tab, (next: InspectorTab) => {
    setTab(next);
    savePreferences({ ...readPreferences(), tab: next });
  }] as const;
}

/** Layout preferences never touch the project or its undo history. */
export function InspectorSection({ id, title, scope, children, defaultOpen = true }: {
  id: string; title: string; scope?: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => !(readPreferences().closed?.[id] ?? !defaultOpen));
  return (
    <details className="inspector-section" open={open} onToggle={event => {
      const next = event.currentTarget.open;
      if (next === open) return;
      setOpen(next);
      const preferences = readPreferences();
      savePreferences({ ...preferences, closed: { ...preferences.closed, [id]: !next } });
    }}>
      <summary><span>{title}</span>{scope && <small>{scope}</small>}</summary>
      <div className="inspector-section-body">{children}</div>
    </details>
  );
}
