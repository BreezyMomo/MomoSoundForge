import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Project } from "./model";
import { nodeKey, nodeParent, type NodeAddress } from "./nodeTree";

type Hover = {
  key: string;
  mode: "before" | "after" | "inside";
  address: NodeAddress;
};
type Gesture = {
  pointer: number;
  handle: HTMLButtonElement;
  path: string[];
  ids: string[];
  originX: number;
  originY: number;
  x: number;
  y: number;
  name: string;
  moved: boolean;
};

// List dragging is separate from timeline gestures: it never edits start times.
export function useNodeReorder(
  root: Project,
  onMove: (
    path: string[],
    ids: string[],
    target: string[],
    before?: string,
  ) => void,
  onBegin: () => void,
) {
  const gesture = useRef<Gesture | null>(null);
  const target = useRef<Hover | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [active, setActive] = useState<{
    x: number;
    y: number;
    name: string;
    keys: string[];
  } | null>(null);
  const cancel = () => {
    const g = gesture.current;
    gesture.current = null;
    target.current = null;
    setHover(null);
    setActive(null);
    if (g?.handle.hasPointerCapture(g.pointer))
      g.handle.releasePointerCapture(g.pointer);
  };
  const locate = (g: Gesture) => {
    const row = document
      .elementFromPoint(g.x, g.y)
      ?.closest<HTMLElement>("[data-node-address]");
    let next: Hover | null = null;
    if (row) {
      const key = row.dataset.nodeAddress!,
        path = JSON.parse(key) as string[];
      // Neither the dragged nodes nor their descendants are valid destinations.
      const cyclic = g.ids.some((id) =>
        [...g.path, id].every((part, i) => path[i] === part),
      );
      if (!cyclic) {
        const rect = row.getBoundingClientRect(),
          fraction = (g.y - rect.top) / rect.height;
        const mode =
          row.dataset.nodeGroup === "true" && fraction > 0.25 && fraction < 0.75
            ? "inside"
            : fraction < 0.5
              ? "before"
              : "after";
        next = {
          key,
          mode,
          address: { path: path.slice(0, -1), id: path.at(-1)! },
        };
      }
    }
    target.current = next;
    setHover((old) =>
      old?.key === next?.key && old?.mode === next?.mode ? old : next,
    );
  };
  useEffect(() => {
    cancel();
  }, [root]);
  useEffect(() => {
    if (!active) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && gesture.current) {
        e.preventDefault();
        cancel();
      }
    };
    const blur = () => cancel();
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", blur);
    let frame = 0;
    const tick = () => {
      const g = gesture.current;
      if (g?.moved) {
        let host: HTMLElement | null = g.handle.parentElement;
        while (host && host.scrollHeight <= host.clientHeight + 1)
          host = host.parentElement;
        if (host) {
          const rect = host.getBoundingClientRect();
          const delta =
            g.y < rect.top + 32 ? -8 : g.y > rect.bottom - 32 ? 8 : 0;
          if (delta) {
            host.scrollTop += delta;
            locate(g);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", blur);
      const g = gesture.current;
      gesture.current = null;
      if (g?.handle.hasPointerCapture(g.pointer))
        g.handle.releasePointerCapture(g.pointer);
    };
  }, [Boolean(active)]);
  return {
    active,
    hover,
    cancel,
    begin(
      e: ReactPointerEvent<HTMLButtonElement>,
      address: NodeAddress,
      ids: string[],
      name: string,
    ) {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      e.stopPropagation();
      onBegin();
      e.currentTarget.focus({ preventScroll: true });
      gesture.current = {
        pointer: e.pointerId,
        handle: e.currentTarget,
        path: address.path,
        ids,
        originX: e.clientX,
        originY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        name,
        moved: false,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    move(e: ReactPointerEvent<HTMLButtonElement>) {
      const g = gesture.current;
      if (!g || g.pointer !== e.pointerId) return;
      g.x = e.clientX;
      g.y = e.clientY;
      if (!g.moved && Math.hypot(g.x - g.originX, g.y - g.originY) < 6) return;
      e.preventDefault();
      g.moved = true;
      setActive({
        x: g.x,
        y: g.y,
        name: g.name,
        keys: g.ids.map((id) => nodeKey({ path: g.path, id })),
      });
      locate(g);
    },
    end(e: ReactPointerEvent<HTMLButtonElement>) {
      const g = gesture.current;
      if (!g || g.pointer !== e.pointerId) return;
      g.x = e.clientX;
      g.y = e.clientY;
      if (g.moved) locate(g);
      const landing = target.current;
      cancel();
      if (!g.moved || !landing) return;
      const { address, mode } = landing;
      const destination =
        mode === "inside" ? [...address.path, address.id] : address.path;
      const siblings = nodeParent(root, address.path).layers;
      const index = siblings.findIndex((l) => l.id === address.id);
      const before =
        mode === "inside"
          ? undefined
          : mode === "before"
            ? address.id
            : siblings
                .slice(index + 1)
                .find(
                  (l) =>
                    JSON.stringify(g.path) !== JSON.stringify(address.path) ||
                    !g.ids.includes(l.id),
                )?.id;
      onMove(g.path, g.ids, destination, before);
    },
  };
}
