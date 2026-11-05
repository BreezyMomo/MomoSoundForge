import {
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { createDockWorkspace, type DockWorkspace } from "@momo/workbench/dock";
import { mountDockMenu } from "@momo/workbench/react";
import { appearance } from "./AppearancePreferences";
import {
  createSoundLayout,
  SOUND_PANELS as panels,
  SOUND_TASK_LAYOUTS,
} from "./workbenchLayout";
import { t, language } from "./i18n";
import "@momo/workbench/dock.css";
import "@momo/workbench/motion.css";
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
  const [compact, setCompact] = useState(
    () => matchMedia("(max-width:900px)").matches,
  );
  const previousPanel = useRef<string | null>(null);
  useEffect(() => {
    const query = matchMedia("(max-width:900px)");
    const change = () => setCompact(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
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
    const model = createSoundLayout(compact);
    const manager = createDockWorkspace({
      host: host.current,
      menuHost: menuHost.current,
      panels: containers,
      model,
      renderMenu: (options) =>
        mountDockMenu({ ...options, appearance, language }),
      storageKey: `momo-sound-forge:layout:v1${compact ? ":compact" : ""}`,
      ui: { text: t, format: t, onLanguageChange: language.onLanguageChange },
      menuPresets: [...SOUND_TASK_LAYOUTS],
      onMessage: (message) => notify.current(message),
    });
    managerRef.current = manager;
    if (previousPanel.current) {
      const panel = previousPanel.current;
      if (manager.has(panel)) manager.show(panel);
      else if (panel === "notes" || panel === "video")
        manager.control([{ action: "preset", preset: panel }]);
    }
    return () => {
      previousPanel.current = manager.active("notes")
        ? "notes"
        : manager.active("video")
          ? "video"
          : "editor";
      manager.dispose();
      managerRef.current = null;
    };
  }, [containers, menuHost, managerRef, compact]);
  return (
    <>
      <div ref={host} className="workbench" aria-label="Momo Sound Forge" />
      {Object.entries(contents).map(([id, node]) =>
        createPortal(node, containers[id], id),
      )}
    </>
  );
}
