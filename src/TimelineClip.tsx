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
  adjustCrop,
  stretchClip,
  type CropEdit,
  timingChanged,
  type ClipEdit,
} from "./timeline";
import { Waveform } from "./Waveform";
import { t } from "./i18n";

type Gesture = {
  pointerId: number;
  originX: number;
  width: number;
  mode: ClipEdit | CropEdit;
  layer: Layer;
  projectDuration: number;
  node: HTMLButtonElement;
  timing: Layer;
  moved: boolean;
};
export function TimelineClip({
  layer,
  projectDuration,
  position,
  cropMode,
  data,
  onSelect,
  onBegin,
  onCommit,
}: {
  layer: Layer;
  projectDuration: number;
  position: number;
  cropMode: boolean;
  data?: Float32Array;
  onSelect: () => void;
  onBegin: () => void;
  onCommit: (timing: Partial<Layer>) => void;
}) {
  const lane = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null);
  const waveform = useRef(data);
  if (data) waveform.current = data;
  const [draft, setDraft] = useState<Layer | null>(null);
  const timing = draft ?? layer;
  const changed = (a: Layer, b: Layer) => timingChanged(a, b) || a.cropStart !== b.cropStart || a.cropEnd !== b.cropEnd;
  const adjust = (original: Layer, mode: ClipEdit | CropEdit, delta: number, duration: number, step: number): Layer => ({
    ...original,
    ...(mode === "cropStart" || mode === "cropEnd"
      ? adjustCrop(original, mode, Math.round(delta / step) * step)
      : stretchClip(original, adjustClipTiming(original, mode, delta, duration, step))),
  });
  const finish = (commit: boolean) => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    setDraft(null);
    if (active.node.hasPointerCapture(active.pointerId))
      active.node.releasePointerCapture(active.pointerId);
    if (commit && active.moved && changed(active.layer, active.timing))
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
  const begin = (event: PointerEvent<HTMLButtonElement>, mode: ClipEdit | CropEdit) => {
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
      timing: layer,
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
    active.timing = adjust(
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
    mode: ClipEdit | CropEdit,
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
      next = adjust(
        layer,
        mode,
        event.key === "ArrowLeft" ? -step : step,
        projectDuration,
        step,
      );
    if (changed(layer, next)) onCommit(next);
  };
  const events = (mode: ClipEdit | CropEdit) => ({
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
            {timing.sourceDuration !== undefined && ` · ${(timing.sourceDuration / timing.duration).toFixed(2)}×`}
          </span>
          <Waveform data={waveform.current} label={layer.name} />
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
        <div className="clip-crop-mask clip-crop-before" style={{ width: `${(timing.cropStart ?? 0) * 100}%` }} />
        <div className="clip-crop-mask clip-crop-after" style={{ width: `${(1 - (timing.cropEnd ?? 1)) * 100}%` }} />
        {cropMode && <>
          <button className="clip-crop-handle" style={{ left: `${(timing.cropStart ?? 0) * 100}%` }} aria-label={t("editor.cropStart", layer.name)} title={t("editor.cropStart", layer.name)} {...events("cropStart")} />
          <button className="clip-crop-handle clip-crop-end" style={{ left: `${(timing.cropEnd ?? 1) * 100}%` }} aria-label={t("editor.cropEnd", layer.name)} title={t("editor.cropEnd", layer.name)} {...events("cropEnd")} />
        </>}
      </div>
      <div className="layer-playhead" aria-hidden="true" style={{ left: `clamp(0px, ${Math.max(0, Math.min(1, position / projectDuration)) * 100}%, calc(100% - 1px))` }} />
    </div>
  );
}
