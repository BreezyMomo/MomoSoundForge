import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import type { Layer } from "./model";
import {
  adjustClipTiming,
  timingChanged,
  type ClipTiming,
  type ClipEdit,
} from "./timeline";
import { Waveform } from "./Waveform";
import { t } from "./i18n";

type Gesture = {
  pointerId: number;
  originX: number;
  width: number;
  mode: ClipEdit;
  layer: Layer;
  projectDuration: number;
  node: HTMLButtonElement;
  timing: ClipTiming;
  moved: boolean;
};
export function TimelineClip({
  layer,
  projectDuration,
  data,
  onSelect,
  onBegin,
  onCommit,
}: {
  layer: Layer;
  projectDuration: number;
  data?: Float32Array;
  onSelect: () => void;
  onBegin: () => void;
  onCommit: (timing: ClipTiming) => void;
}) {
  const lane = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<ClipTiming | null>(null);
  const timing = draft ?? layer;
  const finish = (commit: boolean) => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    setDraft(null);
    if (active.node.hasPointerCapture(active.pointerId))
      active.node.releasePointerCapture(active.pointerId);
    if (commit && active.moved && timingChanged(active.layer, active.timing))
      onCommit(active.timing);
  };
  useEffect(() => {
    // Undo, importing another project, or another edit invalidates a captured gesture.
    if (
      gesture.current &&
      (gesture.current.layer !== layer ||
        gesture.current.projectDuration !== projectDuration)
    )
      finish(false);
  }, [layer, projectDuration]);
  useEffect(
    () => () => {
      const active = gesture.current;
      gesture.current = null;
      if (active?.node.hasPointerCapture(active.pointerId))
        active.node.releasePointerCapture(active.pointerId);
    },
    [],
  );
  const begin = (event: PointerEvent<HTMLButtonElement>, mode: ClipEdit) => {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    const width = lane.current?.getBoundingClientRect().width ?? 0;
    if (!width) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    gesture.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      width,
      mode,
      layer,
      projectDuration,
      node: event.currentTarget,
      timing: { start: layer.start, duration: layer.duration },
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect();
    onBegin();
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.originX;
    if (!active.moved && Math.abs(dx) < 3) return;
    active.moved = true;
    active.timing = adjustClipTiming(
      active.layer,
      active.mode,
      (dx / active.width) * active.projectDuration,
      active.projectDuration,
      event.shiftKey ? 0.001 : 0.01,
    );
    setDraft(active.timing);
  };
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    move(event);
    finish(true);
  };
  const keyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    mode: ClipEdit,
  ) => {
    if (event.key === "Escape" && gesture.current) {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
      return;
    }
    if (gesture.current || !["ArrowLeft", "ArrowRight"].includes(event.key))
      return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    onBegin();
    const step = event.shiftKey ? 0.001 : 0.01,
      next = adjustClipTiming(
        layer,
        mode,
        event.key === "ArrowLeft" ? -step : step,
        projectDuration,
        step,
      );
    if (timingChanged(layer, next)) onCommit(next);
  };
  const events = (mode: ClipEdit) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) =>
      begin(event, mode),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: () => finish(false),
    onLostPointerCapture: () => finish(false),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) =>
      keyboard(event, mode),
  });
  const seconds = (value: number) => value.toFixed(draft ? 3 : 2);
  return (
    <div className="layer-lane" ref={lane} onClick={onSelect}>
      <div
        className={`layer-clip ${draft ? "is-dragging" : ""}`}
        style={{
          left: `clamp(0px,${Math.min(100, (timing.start / projectDuration) * 100)}%,calc(100% - 28px))`,
          width: `${Math.max(0, (Math.min(timing.duration, projectDuration - timing.start) / projectDuration) * 100)}%`,
        }}
      >
        <button
          className="clip-move"
          aria-label={t("editor.moveLayer", layer.name)}
          title={t("editor.clipDragHint")}
          {...events("move")}
        >
          <span className="clip-label">
            {seconds(timing.start)} s · {seconds(timing.duration)} s
          </span>
          <Waveform data={data} label={layer.name} />
        </button>
        <button
          className="clip-resize clip-resize-start"
          aria-label={t("editor.resizeStart", layer.name)}
          title={t("editor.resizeStart", layer.name)}
          {...events("start")}
        />
        <button
          className="clip-resize clip-resize-end"
          aria-label={t("editor.resizeEnd", layer.name)}
          title={t("editor.resizeEnd", layer.name)}
          {...events("end")}
        />
      </div>
    </div>
  );
}
