import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';

export function useTimelineNavigation(zoom: number, maxZoom: number, onZoom: (value: number) => void) {
  const viewport = useRef<HTMLDivElement>(null);
  const [hand, setHand] = useState(false);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const suppressMenu = useRef(false);
  const anchor = useRef<{ fraction: number; x: number } | null>(null);
  const zoomAt = (value: number, clientX?: number) => {
    const el = viewport.current, lane = el?.querySelector<HTMLElement>('.layer-time-ruler');
    if (el && lane) {
      const rect = lane.getBoundingClientRect();
      const view = el.getBoundingClientRect();
      const frozen = el.querySelector<HTMLElement>('.tree-frozen-identity')?.getBoundingClientRect();
      const left = Math.max(view.left, frozen?.right ?? view.left);
      const right = view.left + el.clientWidth;
      const x = Math.max(left, Math.min(right, clientX ?? (left + right) / 2));
      anchor.current = { fraction: Math.max(0, Math.min(1, (x - rect.left) / rect.width)), x };
    }
    onZoom(Math.max(1, Math.min(maxZoom, value)));
  };
  useLayoutEffect(() => {
    const el = viewport.current, lane = el?.querySelector<HTMLElement>('.layer-time-ruler');
    if (zoom === 1 && el) el.scrollLeft = 0;
    else if (el && lane && anchor.current) {
      const rect = lane.getBoundingClientRect();
      el.scrollLeft += rect.left + anchor.current.fraction * rect.width - anchor.current.x;
    }
    anchor.current = null;
  }, [zoom]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault(); event.stopPropagation();
        if (!drag.current) zoomAt(zoom * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.004), event.clientX);
      } else if (event.shiftKey) {
        event.preventDefault(); el.scrollLeft += event.deltaY || event.deltaX;
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoom, maxZoom, onZoom]);
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    event.stopPropagation();
    suppressClick.current = active.moved || hand;
    suppressMenu.current = active.moved;
    drag.current = null; setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { viewport, hand, setHand, panning, zoomAt, events: {
    onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
      suppressMenu.current = false; suppressClick.current = false;
      if (drag.current || !(event.button === 2 || (hand && event.button === 0)) || !event.isPrimary) return;
      if ((event.target as HTMLElement).closest('input,textarea,select,[role="dialog"]')) return;
      event.stopPropagation();
      if (event.button === 0) event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      event.stopPropagation();
      const dx = event.clientX - active.x, dy = event.clientY - active.y;
      if (!active.moved && Math.hypot(dx, dy) < 4) return;
      event.preventDefault(); active.moved = true; setPanning(true);
      event.currentTarget.scrollLeft = active.left - dx;
      event.currentTarget.scrollTop = active.top - dy;
    },
    onPointerUpCapture: finish,
    onPointerCancelCapture: finish,
    onLostPointerCapture: () => { drag.current = null; setPanning(false); },
    onKeyDownCapture: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape' || (!hand && !drag.current)) return;
      event.preventDefault(); event.stopPropagation();
      const active = drag.current;
      drag.current = null; setPanning(false); setHand(false);
      if (active && event.currentTarget.hasPointerCapture(active.id)) event.currentTarget.releasePointerCapture(active.id);
    },
    onClickCapture: (event: React.MouseEvent) => {
      if (suppressClick.current || hand) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    },
    onContextMenuCapture: (event: React.MouseEvent) => {
      if (suppressMenu.current || drag.current?.moved) { event.preventDefault(); event.stopPropagation(); }
    },
  } };
}
