import {
  useEffect,
  useRef,
  useState,
  useMemo,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { Waveform } from "./Waveform";
import { adjustLoopBoundary, timeAtPointer } from "./playback";
import { clamp } from "./model";
import { t } from "./i18n";
import { rulerTicks } from "./timeline";

export function PlayheadTimeline({
  duration,
  position,
  left,
  right,
  disabled,
  version,
  onSeekStart,
  onSeek,
  onSeekEnd,
  compact = false,
  loopRegion,
  onLoopBegin,
  onLoopChange,
}: {
  duration: number;
  position: number;
  left?: Float32Array;
  right?: Float32Array;
  disabled: boolean;
  version: object;
  onSeekStart: () => void;
  onSeek: (time: number) => void;
  onSeekEnd: (time: number) => void;
  compact?: boolean;
  loopRegion?: { start: number; end: number };
  onLoopBegin?: () => void;
  onLoopChange?: (region: { start: number; end: number }) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    gesture = useRef<{
      id: number;
      original: number;
      value: number;
      node: HTMLDivElement;
    } | null>(null);
  const [width, setWidth] = useState(300);
  const [loopDraft, setLoopDraft] = useState<{ start: number; end: number } | null>(null);
  const loopDrag = useRef<{ id: number; node: HTMLButtonElement; edge: "start" | "end";
    x: number; width: number; original: { start: number; end: number }; next: { start: number; end: number } } | null>(null);
  const shownLoop = loopDraft ?? loopRegion;
  const clearLoop = () => {
    const active = loopDrag.current;
    loopDrag.current = null;
    if (active?.node.hasPointerCapture(active.id)) active.node.releasePointerCapture(active.id);
    return active;
  };
  const finishLoop = (cancel = false) => {
    const active = clearLoop();
    if (!active) return;
    setLoopDraft(null);
    if (!cancel && (active.next.start !== active.original.start || active.next.end !== active.original.end))
      onLoopChange?.(active.next);
  };
  const moveLoop = (event: PointerEvent<HTMLButtonElement>) => {
    const active = loopDrag.current;
    if (!active || active.id !== event.pointerId) return;
    const time = active.original[active.edge] + (event.clientX - active.x) / active.width * duration;
    active.next = adjustLoopBoundary(active.original, active.edge, time, duration);
    setLoopDraft(active.next);
  };
  useEffect(() => {
    if (!compact || !host.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [compact]);
  const ticks = useMemo(() => rulerTicks(duration, width), [duration, width]);
  const clear = () => {
    const active = gesture.current;
    gesture.current = null;
    if (active?.node.hasPointerCapture(active.id))
      active.node.releasePointerCapture(active.id);
    return active;
  };
  useEffect(() => {
    clear();
    clearLoop();
    setLoopDraft(null);
  }, [version, disabled]);
  useEffect(
    () => () => {
      clear();
      clearLoop();
    },
    [],
  );
  const pointerTime = (event: PointerEvent<HTMLDivElement>) => {
    const rect = host.current!.getBoundingClientRect();
    return timeAtPointer(event.clientX, rect.left, rect.width, duration);
  };
  const finish = (cancel = false) => {
    const active = clear();
    if (!active) return;
    const time = cancel ? active.original : active.value;
    onSeek(time);
    onSeekEnd(time);
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && gesture.current) {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
      return;
    }
    if (disabled || gesture.current) return;
    const step = event.shiftKey ? 0.001 : 0.01;
    const value =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? duration
          : event.key === "ArrowLeft"
            ? position - step
            : event.key === "ArrowRight"
              ? position + step
              : null;
    if (value === null) return;
    event.preventDefault();
    event.stopPropagation();
    const time = clamp(Math.round(value * 1000) / 1000, 0, duration);
    onSeekStart();
    onSeek(time);
    onSeekEnd(time);
  };
  return (
    <div className="timeline-shell">
    <div
      ref={host}
      className={`mix-timeline ${compact ? "layer-time-ruler" : ""} ${disabled ? "disabled" : ""}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={t(compact ? "editor.layerPlayhead" : "editor.playhead")}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Number(position.toFixed(3))}
      aria-valuetext={t(
        "editor.positionText",
        position.toFixed(3),
        duration.toFixed(3),
      )}
      aria-disabled={disabled}
      title={t("editor.seekHint")}
      onPointerDown={(event) => {
        if (
          disabled ||
          event.button !== 0 ||
          !event.isPrimary ||
          gesture.current
        )
          return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        const value = pointerTime(event);
        gesture.current = {
          id: event.pointerId,
          original: position,
          value,
          node: event.currentTarget,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        onSeekStart();
        onSeek(value);
      }}
      onPointerMove={(event) => {
        const active = gesture.current;
        if (!active || active.id !== event.pointerId) return;
        active.value = pointerTime(event);
        onSeek(active.value);
      }}
      onPointerUp={(event) => {
        const active = gesture.current;
        if (!active || active.id !== event.pointerId) return;
        active.value = pointerTime(event);
        finish();
      }}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)}
      onKeyDown={keyboard}
    >
      {shownLoop && (
        <div
          className="loop-region-overlay"
          aria-hidden="true"
          style={{
            left: `${(shownLoop.start / duration) * 100}%`,
            width: `${((shownLoop.end - shownLoop.start) / duration) * 100}%`,
          }}
        >
          <span>{t("pro.loopRange")}</span>
        </div>
      )}
      {!compact && (
        <div className="mix-wave">
          <Waveform data={left} right={right} label={t("editor.mix")} />
        </div>
      )}
      <div className={`time-ruler ${compact ? "adaptive" : ""}`}>
        {compact ? ticks.map((time, i) => <span key={time} style={{ left: `${time / duration * 100}%`,
          transform: i === 0 ? "none" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>
          {time.toFixed(2)}{i === ticks.length - 1 ? " s" : ""}
        </span>) : Array.from({ length: 5 }, (_, i) => (
          <span key={i}>
            {((duration * i) / 4).toFixed(2)}
            {i === 4 ? " s" : ""}
          </span>
        ))}
      </div>
      <div
        className="playhead"
        style={{ left: `${clamp(position / duration, 0, 1) * 100}%` }}
      >
        <span className="playhead-handle" />
      </div>
    </div>
    {!compact && shownLoop && onLoopChange && (["start", "end"] as const).map(edge => (
      <button key={edge} type="button" role="slider" className={`loop-boundary loop-boundary-${edge}`}
        style={{ left: `${shownLoop[edge] / duration * 100}%` }} disabled={disabled}
        aria-label={t(edge === "start" ? "pro.dragLoopStart" : "pro.dragLoopEnd")}
        aria-valuemin={edge === "start" ? 0 : shownLoop.start + 0.01}
        aria-valuemax={edge === "start" ? shownLoop.end - 0.01 : duration}
        aria-valuenow={Number(shownLoop[edge].toFixed(3))}
        aria-valuetext={`${shownLoop[edge].toFixed(3)} s`} title={t("pro.dragLoopHelp")}
        onPointerDown={event => {
          if (disabled || event.button !== 0 || !event.isPrimary || loopDrag.current) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          loopDrag.current = { id: event.pointerId, node: event.currentTarget, edge, x: event.clientX,
            width: host.current!.getBoundingClientRect().width, original: shownLoop, next: shownLoop };
          event.currentTarget.setPointerCapture(event.pointerId);
          onLoopBegin?.();
        }}
        onPointerMove={moveLoop}
        onPointerUp={event => { if (loopDrag.current?.id === event.pointerId) { moveLoop(event); finishLoop(); } }}
        onPointerCancel={() => finishLoop(true)} onLostPointerCapture={() => finishLoop(true)}
        onKeyDown={event => {
          if (event.key === "Escape" && loopDrag.current) {
            event.preventDefault(); event.stopPropagation(); finishLoop(true); return;
          }
          if (disabled || loopDrag.current) return;
          const step = event.shiftKey ? 0.001 : 0.01;
          const time = event.key === "ArrowLeft" ? shownLoop[edge] - step : event.key === "ArrowRight" ? shownLoop[edge] + step
            : event.key === "Home" ? 0 : event.key === "End" ? duration : null;
          if (time === null) return;
          event.preventDefault(); event.stopPropagation();
          const next = adjustLoopBoundary(shownLoop, edge, time, duration);
          if (next[edge] !== shownLoop[edge]) { onLoopBegin?.(); onLoopChange(next); }
        }}><i aria-hidden="true" /></button>
    ))}
    </div>
  );
}
