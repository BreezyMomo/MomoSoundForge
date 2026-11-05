import {
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { createDockWorkspace, type DockWorkspace } from "@momo/workbench/dock";
import {mountDockMenu} from '@momo/workbench/react';
import {appearance} from './AppearancePreferences';
import { createLayoutModel, type LayoutNode } from "@momo/workbench/layout";
import { t, language } from "./i18n";
import "@momo/workbench/dock.css";
import "@momo/workbench/motion.css";
const panels = [
  { id: "video", title: "video.title", showEdge: "top", dockRatio: { y: 0.45 } },
  { id: "library", title: "panel.library", showEdge: "left" },
  { id: "editor", title: "panel.editor" },
  { id: "inspector", title: "panel.inspector", showEdge: "right" },
  { id: "variants", title: "panel.variants", showEdge: "bottom" },
] as const;
const stack = (id: string, items: string[]): LayoutNode => ({
  kind: "stack",
  id,
  panels: items,
  active: items[0],
});
const split = (
  id: string,
  axis: "x" | "y",
  ratio: number,
  first: LayoutNode,
  second: LayoutNode,
): LayoutNode => ({ kind: "split", id, axis, ratio, first, second });
export function Workbench({
  contents,
  menuHost,
  managerRef,
  onMessage,
}: {
  contents: Record<(typeof panels)[number]["id"], ReactNode>;
  menuHost: RefObject<HTMLDivElement | null>;
  managerRef: RefObject<DockWorkspace | null>;
  onMessage: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    notify = useRef(onMessage);
  notify.current = onMessage;
  const containers = useMemo(
    () =>
      Object.fromEntries(
        panels.map(({ id }) => {
          const node = document.createElement("div");
          node.className = `sound-panel sound-${id}`;
          return [id, node];
        }),
      ),
    [],
  );
  useLayoutEffect(() => {
    if (!host.current || !menuHost.current) return;
    const compact = matchMedia("(max-width:900px)").matches;
    const model = createLayoutModel({
      panels: panels.map((p) => ({ ...p })),
      anchorPanel: "editor",
      storageKey: "momo-sound-forge:layout:v1",
      defaultPreset: "default",
      presets: {
        default: () => ({
          root: compact
            ? stack("compact", ["editor", "library", "inspector", "variants"])
            : split(
                "columns",
                "x",
                0.18,
                stack("left", ["library"]),
                split(
                  "right",
                  "x",
                  0.72,
                  split(
                    "center",
                    "y",
                    0.8,
                    stack("main", ["editor"]),
                    stack("bottom", ["variants"]),
                  ),
                  stack("properties", ["inspector"]),
                ),
              ),
          floats: [],
        }),
        focus: () => ({ root: stack("focus", ["editor"]), floats: [] }),
        properties: () => ({
          root: stack("properties-only", ["inspector"]),
          floats: [],
        }),
      },
    });
    const manager = createDockWorkspace({
      host: host.current,
      menuHost: menuHost.current,
      panels: containers,
      model,
      renderMenu:options=>mountDockMenu({...options,appearance,language}),
      storageKey: `momo-sound-forge:layout:v1${compact ? ":compact" : ""}`,
      ui: { text: t, format: t, onLanguageChange: language.onLanguageChange },
      menuPresets: [
        { id: "default", title: "layout.default" },
        { id: "focus", title: "layout.focus" },
        { id: "properties", title: "layout.properties" },
      ],
      onMessage: (message) => notify.current(message),
    });
    managerRef.current = manager;
    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [containers, menuHost, managerRef]);
  return (
    <>
      <div ref={host} className="workbench" aria-label="Momo Sound Forge" />
      {Object.entries(contents).map(([id, node]) =>
        createPortal(node, containers[id], id),
      )}
    </>
  );
}
