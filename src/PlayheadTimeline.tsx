import {
  useEffect,
  useRef,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { Waveform } from "./Waveform";
import { timeAtPointer } from "./playback";
import { clamp } from "./model";
import { t } from "./i18n";

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
}) {
  const host = useRef<HTMLDivElement>(null),
    gesture = useRef<{
      id: number;
      original: number;
      value: number;
      node: HTMLDivElement;
    } | null>(null);
  const clear = () => {
    const active = gesture.current;
    gesture.current = null;
    if (active?.node.hasPointerCapture(active.id))
      active.node.releasePointerCapture(active.id);
    return active;
  };
  useEffect(() => {
    clear();
  }, [version]);
  useEffect(
    () => () => {
      clear();
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
      {loopRegion && (
        <div
          className="loop-region-overlay"
          title={t("pro.loop")}
          style={{
            left: `${(loopRegion.start / duration) * 100}%`,
            width: `${((loopRegion.end - loopRegion.start) / duration) * 100}%`,
          }}
        >
          <span>{t("pro.loop")}</span>
        </div>
      )}
      {!compact && (
        <div className="mix-wave">
          <Waveform data={left} right={right} label={t("editor.mix")} />
        </div>
      )}
      <div className="time-ruler">
        {Array.from({ length: 5 }, (_, i) => (
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
  );
}
