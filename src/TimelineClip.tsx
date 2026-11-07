import { patchLayer, type LayerPatch } from "./model";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import type { PlayerInput } from "./model";
import {
  adjustCrop,
  editClip,
  cropReference,
  snapTime,
  type CropEdit,
  timingChanged,
  type ClipEdit,
} from "./timeline";
import { Waveform } from "./Waveform";
import { t } from "./i18n";
import { NoteRoll } from "./NoteRoll";
import type { NoteEvent } from "./instruments";

type Gesture = {
  pointerId: number;
  originX: number;
  width: number;
  mode: ClipEdit | CropEdit | "attack" | "release";
  layer: PlayerInput;
  projectDuration: number;
  node: HTMLButtonElement;
  timing: PlayerInput;
  moved: boolean;
  plainClick: boolean;
};
export function TimelineClip({
  layer: sourceLayer,
  offset = 0,
  tail = 0,
  sampleRate = 48000,
  moveOnly = false,
  projectDuration,
  position,
  snapTargets = [],
  displayLayer,
  constrain,
  disabledParameters = [],
  onPreview,
  data,
  tailData,
  onSelect,
  onClearSelection,
  onBegin,
  onCommit,
  onNoteChange,
  onNoteAudition,
  onExpandNotes,
}: {
  layer: PlayerInput;
  offset?: number;
  tail?: number;
  sampleRate?: number;
  moveOnly?: boolean;
  projectDuration: number;
  position: number;
  snapTargets?: number[];
  displayLayer?: PlayerInput;
  constrain?: (next: PlayerInput) => PlayerInput;
  disabledParameters?: string[];
  onPreview?: (next: PlayerInput | null) => void;
  data?: Float32Array;
  tailData?: Float32Array;
  onSelect: (event?: {
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }) => void;
  onClearSelection?: () => void;
  onBegin: () => void;
  onCommit: (timing: LayerPatch) => void;
  onNoteChange?: (note: NoteEvent) => void;
  onNoteAudition?: (note: NoteEvent) => void;
  onExpandNotes?: () => void;
}) {
  // Keep the source identity stable during selection and drag-preview renders.
  // Only a real source edit or parent-group move should invalidate a gesture.
  const layer = useMemo(
    () => ({ ...sourceLayer, start: sourceLayer.start + offset }),
    [sourceLayer, offset],
  );
  const lane = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null);
  const selectOnClick = useRef(false);
  const waveform = useRef(data);
  if (data) waveform.current = data;
  const [draft, setDraft] = useState<PlayerInput | null>(null);
  const timing = displayLayer ?? draft ?? layer;
  const changed = (a: PlayerInput, b: PlayerInput) =>
    timingChanged(a, b) ||
    a.sourceStart !== b.sourceStart ||
    a.sourceEnd !== b.sourceEnd ||
    a.player.attack !== b.player.attack ||
    a.player.release !== b.player.release;
  const adjust = (
    original: PlayerInput,
    mode: ClipEdit | CropEdit | "attack" | "release",
    delta: number,
    duration: number,
    step: number,
  ): PlayerInput => {
    if (mode === "attack" || mode === "release")
      return patchLayer(original, {
        player: {
          [mode]: Math.max(
            0,
            Math.min(
              original.player.duration ?? original.duration,
              mode === "attack" ? 3 : 5,
              original.player[mode] +
                ((mode === "release" ? -delta : delta) *
                  (original.player.duration ?? original.duration)) /
                  original.duration,
            ),
          ),
        },
      });
    if (mode === "cropStart" || mode === "cropEnd")
      return patchLayer(original, {
        ...adjustCrop(original, mode, Math.round(delta / step) * step),
      });
    return patchLayer(
      original,
      editClip(original, mode, delta, duration, step),
    );
  };
  const finish = (commit: boolean) => {
    const active = gesture.current;
    if (!active) return;
    selectOnClick.current = commit && !active.moved && active.plainClick;
    gesture.current = null;
    setDraft(null);
    onPreview?.(null);
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
  const begin = (
    event: PointerEvent<HTMLButtonElement>,
    mode: ClipEdit | CropEdit | "attack" | "release",
  ) => {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    const width = lane.current?.getBoundingClientRect().width ?? 0;
    if (!width) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    selectOnClick.current = false;
    // Modifier clicks toggle selection only; they must not start a drag of
    // a clip that has just been removed from the selection.
    if (event.ctrlKey || event.metaKey) {
      onSelect(event);
      return;
    }
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
      plainClick: !event.shiftKey,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(
      event.ctrlKey || event.metaKey || event.shiftKey ? event : undefined,
    );
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
    if (
      snapTargets.length &&
      !event.shiftKey &&
      (active.mode === "move" ||
        active.mode === "start" ||
        active.mode === "end")
    ) {
      const edge =
        active.mode === "end"
          ? active.timing.start + active.timing.duration
          : active.timing.start;
      const snapped = snapTime(
        edge,
        snapTargets,
        (8 / active.width) * active.projectDuration,
      );
      let shift = snapped - edge;
      if (active.mode === "move") {
        const end = active.timing.start + active.timing.duration;
        const endShift =
          snapTime(
            end,
            snapTargets,
            (8 / active.width) * active.projectDuration,
          ) - end;
        if (
          endShift !== 0 &&
          (shift === 0 || Math.abs(endShift) < Math.abs(shift))
        )
          shift = endShift;
      }
      const delta =
        active.mode === "end"
          ? active.timing.duration - active.layer.duration
          : active.timing.start - active.layer.start;
      active.timing = adjust(
        active.layer,
        active.mode,
        delta + shift,
        active.projectDuration,
        0.000001,
      );
    }
    active.timing = constrain?.(active.timing) ?? active.timing;
    setDraft(active.timing);
    onPreview?.(active.timing);
  };
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    move(event);
    finish(true);
  };
  const keyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    mode: ClipEdit | CropEdit | "attack" | "release",
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
  const events = (mode: ClipEdit | CropEdit | "attack" | "release") => ({
    disabled: disabledParameters.includes(
      mode === "move" || mode === "end" ? "start" : mode,
    ),
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) =>
      begin(event, mode),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: () => finish(false),
    onLostPointerCapture: () => finish(false),
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      // Preserve the set while dragging, but a plain click selects only this
      // clip after pointer-up. Modifier clicks were handled on pointer-down.
      event.stopPropagation();
      if (event.detail === 0 || selectOnClick.current) onSelect(event);
      selectOnClick.current = false;
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) =>
      keyboard(event, mode),
  });
  const visibleBody = Math.max(
    0,
    Math.min(timing.duration, projectDuration - timing.start),
  );
  const visibleTail = Math.max(
    0,
    Math.min(tail, projectDuration - timing.start - timing.duration),
  );
  const reference = cropReference(timing);
  const showReference = !timing.loop && !moveOnly && !!draft && (gesture.current?.mode === 'start' || gesture.current?.mode === 'end');
  const croppedBefore = !timing.loop && reference.before > 0.000001;
  const croppedAfter = !timing.loop && reference.after > 0.000001;
  const waveformStart = Math.round((layer.reverse ? layer.sourceEnd-timing.sourceEnd : timing.sourceStart-layer.sourceStart) / layer.speed * sampleRate);
  const bodyFrames = Math.round(layer.duration * sampleRate);
  const fadeIn = Math.min(1, timing.player.attack / (timing.player.duration || timing.duration));
  const fadeOut = Math.min(1, timing.player.release / (timing.player.duration || timing.duration));
  const fadeLabel = (mode: 'attack' | 'release') => t(mode === 'attack' ? 'editor.fadeInTime' : 'editor.fadeOutTime', timing.player[mode].toFixed(3));
  const seconds = (value: number) => value.toFixed(draft ? 3 : 2);
  return (
    <div
      className={`layer-lane ${layer.player.type === "instrument" ? "instrument-lane" : ""}`}
      ref={lane}
      onClick={(event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) onSelect(event);
        else onClearSelection?.();
      }}
    >
      {showReference && [{start:reference.start,end:timing.start,side:'before',seconds:reference.before},
        {start:timing.start+timing.duration,end:reference.end,side:'after',seconds:reference.after}].map(part=>{
          const start=Math.max(0,part.start),end=Math.min(projectDuration,part.end);
          return end>start&&<div key={part.side} className="clip-crop-reference" title={t('editor.excluded',part.seconds.toFixed(2))}
            style={{left:`${start/projectDuration*100}%`,width:`${(end-start)/projectDuration*100}%`}}>
            <span>{t('editor.excluded',part.seconds.toFixed(2))}</span>
          </div>;
        })}
      {visibleTail > 0 && (
        <div
          className="clip-effect-tail"
          title={t("tree.tail", tail.toFixed(2))}
          aria-label={t("tree.tail", tail.toFixed(2))}
          style={{
            left: `${((timing.start + timing.duration) / projectDuration) * 100}%`,
            width: `${(visibleTail / projectDuration) * 100}%`,
          }}
        >
          <span className="clip-tail-label">{t("tree.tailLabel")}</span>
          <Waveform
            data={tailData}
            label={t("tree.tailWave", layer.name)}
            startFrame={bodyFrames}
            endFrame={bodyFrames + Math.round(visibleTail * sampleRate)}
          />
        </div>
      )}
      <div
        className={`layer-clip ${draft ? "is-dragging" : ""} ${croppedBefore ? "is-cropped-before" : ""} ${croppedAfter ? "is-cropped-after" : ""}`}
        style={{
          left: `clamp(0px,${Math.min(100, (timing.start / projectDuration) * 100)}%,calc(100% - 28px))`,
          width: `${Math.max(0, (Math.min(timing.duration, projectDuration - timing.start) / projectDuration) * 100)}%`,
        }}
      >
        <button
          className="clip-move"
          aria-label={t("editor.moveLayer", layer.name)}
          title={t(
            layer.player.type === "instrument"
              ? "roll.clipHelp"
              : "editor.clipDragHint",
          )}
          {...events("move")}
          onDoubleClick={onExpandNotes}
        >
          <span className="clip-label">
            {seconds(timing.start)} s · {seconds(timing.duration)} s
            {(croppedBefore||croppedAfter)&&<span title={t('editor.readRange',seconds(timing.sourceStart),seconds(timing.sourceEnd))}> · {t('editor.trimmed')}</span>}
            {layer.player.type === "instrument" &&
              layer.player.score &&
              ` · ${t("roll.count", layer.player.score.notes.length)}`}
            {timing.player.duration !== undefined &&
              ` · ${timing.speed.toFixed(2)}×`}
          </span>
          <Waveform
            data={waveform.current}
            label={layer.name}
            startFrame={waveformStart}
            endFrame={waveformStart + Math.round(visibleBody * sampleRate)}
          />
        </button>
        {sourceLayer.player.type === "instrument" &&
          !sourceLayer.loop &&
          sourceLayer.player.score &&
          onNoteChange &&
          onNoteAudition && (
            <NoteRoll
              layer={sourceLayer}
              compact
              onChange={onNoteChange}
              onAudition={onNoteAudition}
              onSelect={onSelect}
              onBegin={onBegin}
              onExpand={onExpandNotes}
            />
          )}
        {!moveOnly && (
          <>
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
            <>
            <svg className="clip-fade-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {fadeIn > 0 && <g><path className="clip-fade-shade" d={`M0 100 L${fadeIn * 100} 0 L0 0 Z`} /><path d={`M0 100 L${fadeIn * 100} 0`} /></g>}
              {fadeOut > 0 && <g><path className="clip-fade-shade" d={`M${(1 - fadeOut) * 100} 0 L100 100 L100 0 Z`} /><path d={`M${(1 - fadeOut) * 100} 0 L100 100`} /></g>}
            </svg>
            <button
              className="clip-fade-handle"
              style={{
                left: `clamp(12px, ${fadeIn * 100}%, calc(100% - 12px))`,
              }}
              aria-label={t("pro.fadeIn", layer.name)}
              title={fadeLabel("attack")}
              data-hint={fadeLabel("attack")}
              data-active={gesture.current?.mode === "attack" || undefined}
              {...events("attack")}
            />
            <button
              className="clip-fade-handle clip-fade-end"
              style={{
                left: `clamp(12px, ${(1 - fadeOut) * 100}%, calc(100% - 12px))`,
              }}
              aria-label={t("pro.fadeOut", layer.name)}
              title={fadeLabel("release")}
              data-hint={fadeLabel("release")}
              data-active={gesture.current?.mode === "release" || undefined}
              {...events("release")}
            /></>
          </>
        )}

      </div>
      <div
        className="layer-playhead"
        aria-hidden="true"
        style={{
          left: `clamp(0px, ${Math.max(0, Math.min(1, position / projectDuration)) * 100}%, calc(100% - 1px))`,
        }}
      />
    </div>
  );
}
