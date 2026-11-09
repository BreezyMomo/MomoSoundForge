import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import {
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  WorkbenchChoice,
} from "@momo/workbench/react";
import type { PlayerInput } from "./model";
import { secondsToBeats, type NoteEvent } from "./instruments";
import { editNote, noteSpan, pitchName, noteGridTicks } from "./noteEditing";
import { t } from "./i18n";
import "./note-roll.css";
import { NoteStrength } from "./NoteStrength";
import {
  noteCoverageIssue,
  playablePitches,
  velocityPercent,
  constrainNotePitch,
} from "./noteCoverage";
import {
  articulationName,
  coverageLabel,
  NoteCoverageNotice,
} from "./NoteCoverageNotice";

type Drag = {
  id: number;
  x: number;
  y: number;
  width: number;
  rowHeight: number;
  beatSpan: number;
  mode: "move" | "resize";
  note: NoteEvent;
  next: NoteEvent;
  layer: PlayerInput;
  moved: boolean;
  node: HTMLButtonElement;
};

export function NoteRoll({
  layer,
  compact = false,
  minimumRows = 12,
  onChange,
  onSelect,
  onBegin,
  onAudition,
  onExpand,
  playheadBeat,
  playheadVisible = true,
  followPlayhead = false,
  seekReady = false,
  onSeekStart,
  onSeekBeat,
  onSeekEnd,
}: {
  layer: PlayerInput;
  compact?: boolean;
  minimumRows?: number;
  onChange: (note: NoteEvent) => void;
  onSelect: () => void;
  onBegin: () => void;
  onAudition: (note: NoteEvent) => void;
  onExpand?: () => void;
  playheadBeat?: number;
  playheadVisible?: boolean;
  followPlayhead?: boolean;
  seekReady?: boolean;
  onSeekStart?: () => void;
  onSeekBeat?: (beat: number) => void;
  onSeekEnd?: (beat: number) => void;
}) {
  const score = layer.player.score!;
  const seeking = useRef<{
    id: number;
    beat: number;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState(0.25);
  const [draft, setDraft] = useState<NoteEvent | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const minimum = Math.min(
    ...(score.notes.length ? score.notes.map((n) => n.midi) : [60]),
  );
  const maximum = Math.max(
    ...(score.notes.length ? score.notes.map((n) => n.midi) : [60]),
  );
  const padding =
    compact || minimumRows <= 12 ? 3 : Math.floor((minimumRows - 1) / 2);
  const [range, setRange] = useState(() => ({
    low: Math.max(0, minimum - padding),
    high: Math.min(
      127,
      Math.max(
        minimum + (compact ? 4 : minimumRows - padding - 1),
        maximum + 3,
      ),
    ),
  }));
  // Keep the keyboard stationary while editing; expand only when notes leave it.
  useEffect(() => {
    setRange((previous) =>
      minimum < previous.low || maximum > previous.high
        ? {
            low: Math.min(previous.low, Math.max(0, minimum - 3)),
            high: Math.max(previous.high, Math.min(127, maximum + 3)),
          }
        : previous,
    );
  }, [minimum, maximum]);
  const { low, high } = range;
  const count = high - low + 1;
  const sourceBeats = secondsToBeats(
    layer.player.duration ?? layer.duration,
    score.bpm,
  );
  // The editable lane must cover the whole visible sound layer. The player
  // duration can be shorter than the layer's read/playback duration (for
  // example a 2 s source placed in a 10 s layer), so keep that tail visible
  // and mark it as outside the source range below.
  const layerBeats = secondsToBeats(layer.duration, score.bpm);
  const totalBeats = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(
      4,
      Math.ceil(sourceBeats),
      Math.ceil(layerBeats),
      ...score.notes.map((n) => Math.ceil(n.start + n.duration)),
    ),
  );
  const ticks = noteGridTicks(totalBeats);
  const cursor =
    playheadVisible &&
    playheadBeat !== undefined &&
    playheadBeat >= 0 &&
    playheadBeat <= totalBeats
      ? (playheadBeat / totalBeats) * 100
      : null;
  useEffect(() => {
    const host = scroll.current;
    if (!followPlayhead || cursor === null || !host || !grid.current) return;
    const x = 44 + (grid.current.clientWidth * cursor) / 100;
    if (x < host.scrollLeft + 44 || x > host.scrollLeft + host.clientWidth - 20)
      host.scrollLeft = Math.max(0, x - host.clientWidth / 3);
  }, [cursor, followPlayhead]);
  const pointerBeat = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        totalBeats,
        ((event.clientX - rect.left) / rect.width) * totalBeats,
      ),
    );
  };
  const rows = Array.from({ length: count }, (_, i) => high - i);
  const cancel = () => {
    const active = drag.current;
    drag.current = null;
    setDraft(null);
    if (active?.node.hasPointerCapture(active.id))
      active.node.releasePointerCapture(active.id);
  };
  useEffect(() => {
    if (drag.current && drag.current.layer !== layer) cancel();
  }, [layer]);
  useEffect(
    () => () => {
      const active = drag.current;
      drag.current = null;
      if (active?.node.hasPointerCapture(active.id))
        active.node.releasePointerCapture(active.id);
    },
    [],
  );
  const begin = (
    e: PointerEvent<HTMLButtonElement>,
    note: NoteEvent,
    mode: Drag["mode"],
  ) => {
    if (e.button !== 0 || !e.isPrimary || drag.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = grid.current!.getBoundingClientRect();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      rowHeight: rect.height / count,
      beatSpan: compact
        ? secondsToBeats(layer.duration, score.bpm) *
          layer.speed *
          (layer.reverse ? -1 : 1)
        : totalBeats,
      mode,
      note,
      next: note,
      layer,
      moved: false,
      node: e.currentTarget,
    };
    setSelected(note.id);
    onSelect();
    onBegin();
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.id !== e.pointerId) return;
    const dx = e.clientX - active.x,
      dy = e.clientY - active.y;
    if (!active.moved && Math.hypot(dx, dy) < 3) return;
    active.moved = true;
    active.next = constrainNotePitch(
      score.instruments.find((i) => i.id === active.note.instrumentId),
      editNote(
        active.note,
        active.mode,
        (dx / active.width) * active.beatSpan,
        -dy / active.rowHeight,
        score.bpm,
        e.shiftKey ? 0 : snap,
      ),
      active.next,
    );
    setDraft(active.next);
  };
  const end = (e: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    move(e);
    const active = drag.current!;
    cancel();
    if (active.moved) {
      if (
        active.next.start !== active.note.start ||
        active.next.midi !== active.note.midi ||
        active.next.duration !== active.note.duration
      )
        onChange(active.next);
    } else if (active.mode === "move") onAudition(active.note);
  };
  const key = (
    e: KeyboardEvent<HTMLButtonElement>,
    note: NoteEvent,
    mode: Drag["mode"],
  ) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      return;
    }
    if (drag.current) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      const step = e.shiftKey ? 0.01 : snap || 0.01;
      const next = constrainNotePitch(
        score.instruments.find((i) => i.id === note.instrumentId),
        editNote(
          note,
          mode,
          e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
          e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0,
          score.bpm,
          0,
        ),
        note,
      );
      if (
        next.midi !== note.midi ||
        next.start !== note.start ||
        next.duration !== note.duration
      ) {
        onBegin();
        onChange(next);
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onAudition(note);
    }
  };
  const events = (note: NoteEvent, mode: Drag["mode"]) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => begin(e, note, mode),
    onFocus: () => setSelected(note.id),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => key(e, note, mode),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onExpand?.();
    },
  });
  const current =
    draft ?? score.notes.find((n) => n.id === selected) ?? score.notes[0];
  const currentInstrument = score.instruments.find(
    (i) => i.id === current?.instrumentId,
  );
  const covered = new Set(
    !compact && current ? playablePitches(currentInstrument, current) : [],
  );
  const currentPitch = current?.midi;
  useEffect(() => {
    const viewport = scroll.current;
    if (compact || !viewport || currentPitch === undefined || drag.current)
      return;
    const top = (high - currentPitch) * 18;
    // Center the edited note and nearby pitches, including on first opening.
    viewport.scrollTop = Math.max(0, top + 24 - viewport.clientHeight / 2);
  }, [compact, currentPitch, high]);
  const outsideCount = compact
    ? score.notes.filter((n) => {
        const span = noteSpan(layer, n);
        return span.start >= 1 || span.start + span.width <= 0;
      }).length
    : 0;
  return (
    <section
      className={compact ? "note-roll compact" : "note-roll expanded"}
      aria-label={t("roll.title", layer.name)}
    >
      {compact && outsideCount > 0 && (
        <button
          className="roll-overflow"
          onClick={(e) => {
            e.stopPropagation();
            onExpand?.();
          }}
        >
          {t("roll.hidden", outsideCount)}
        </button>
      )}
      {!compact && (
        <>
          <div className="roll-toolbar">
            <strong>{t("roll.piano")}</strong>
            <span>{score.bpm} BPM</span>
            <FieldGroup className="sound-wrap-fields wb:items-center wb:gap-3">
              <Field orientation="horizontal" className="wb:w-auto">
                <FieldLabel>{t("score.snap")}</FieldLabel>
                <WorkbenchChoice
                  label={t("roll.snap")}
                  value={String(snap)}
                  onValueChange={(value) => setSnap(Number(value))}
                  items={[0, 0.125, 0.25, 0.5, 1].map((value) => ({
                    value: String(value),
                    label: value
                      ? value + " " + t("score.beats")
                      : t("score.off"),
                  }))}
                />
              </Field>
              {current && (
                <Field orientation="horizontal" className="wb:w-auto">
                  <FieldLabel>
                    {pitchName(current.midi)} · {t("note.basic.strength")}
                  </FieldLabel>
                  <NoteStrength
                    key={current.id}
                    instrument={currentInstrument}
                    note={current}
                    label={t("note.basic.strength")}
                    onChange={(velocity) => {
                      onBegin();
                      onChange({ ...current, velocity });
                    }}
                  />
                </Field>
              )}
            </FieldGroup>
            {onExpand && (
              <Button variant="outline" onClick={onExpand}>
                {t("roll.openWorkspace")}
              </Button>
            )}
          </div>
          <p className="field-help">{t("roll.help")}</p>
          <p className="field-help">{t("roll.sourceHint")}</p>
          {current && (
            <>
              <p className="field-help">
                {t(
                  "roll.coverage",
                  score.notes.findIndex((n) => n.id === current.id) + 1,
                  currentInstrument?.name ?? t("note.coverage.missing"),
                  articulationName(current.articulation, currentInstrument),
                  velocityPercent(current.velocity),
                  coverageLabel(currentInstrument, current),
                )}
              </p>
              <p className="field-help">{t("roll.coverageHint")}</p>
              <NoteCoverageNotice
                instrument={currentInstrument}
                note={current}
                onApply={(note) => {
                  onBegin();
                  onChange(note);
                }}
              />
            </>
          )}
        </>
      )}
      <div className="roll-scroll" ref={scroll}>
        <div
          className="roll-surface"
          style={
            compact
              ? undefined
              : { minWidth: Math.max(400, Math.min(2400, totalBeats * 48)) }
          }
        >
          {!compact && (
            <div
              className={`roll-ruler ${onSeekBeat ? "can-seek" : ""}`}
              role={onSeekBeat ? "slider" : undefined}
              tabIndex={onSeekBeat ? 0 : undefined}
              aria-label={onSeekBeat ? t("roll.playhead") : undefined}
              aria-valuemin={onSeekBeat ? 0 : undefined}
              aria-valuemax={onSeekBeat ? totalBeats : undefined}
              aria-valuenow={
                onSeekBeat
                  ? Math.max(0, Math.min(totalBeats, playheadBeat ?? 0))
                  : undefined
              }
              aria-disabled={onSeekBeat ? !seekReady : undefined}
              title={onSeekBeat ? t("roll.seekHelp") : undefined}
              onPointerDown={(event) => {
                if (
                  !onSeekBeat ||
                  !seekReady ||
                  event.button !== 0 ||
                  !event.isPrimary
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                seeking.current = {
                  id: event.pointerId,
                  beat: playheadBeat ?? 0,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget.focus();
                onSeekStart?.();
                onSeekBeat(pointerBeat(event));
              }}
              onPointerMove={(event) => {
                if (seeking.current?.id === event.pointerId)
                  onSeekBeat?.(pointerBeat(event));
              }}
              onPointerUp={(event) => {
                if (seeking.current?.id !== event.pointerId) return;
                seeking.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
                onSeekEnd?.(pointerBeat(event));
              }}
              onPointerCancel={() => {
                if (!seeking.current) return;
                const beat = seeking.current.beat;
                seeking.current = null;
                onSeekBeat?.(beat);
                onSeekEnd?.(beat);
              }}
              onKeyDown={(event) => {
                if (seeking.current) {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    const active = seeking.current;
                    seeking.current = null;
                    if (event.currentTarget.hasPointerCapture(active.id))
                      event.currentTarget.releasePointerCapture(active.id);
                    onSeekBeat?.(active.beat);
                    onSeekEnd?.(active.beat);
                  }
                  return;
                }
                if (!onSeekBeat || !seekReady) return;
                const step = event.shiftKey ? 0.01 : snap || 0.25;
                const beat =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? sourceBeats
                      : event.key === "ArrowLeft"
                        ? (playheadBeat ?? 0) - step
                        : event.key === "ArrowRight"
                          ? (playheadBeat ?? 0) + step
                          : null;
                if (beat === null) return;
                event.preventDefault();
                event.stopPropagation();
                const value = Math.max(0, Math.min(totalBeats, beat));
                onSeekStart?.();
                onSeekBeat(value);
                onSeekEnd?.(value);
              }}
            >
              {cursor !== null && (
                <i
                  className="roll-playhead-head"
                  aria-hidden="true"
                  style={{ left: `${cursor}%` }}
                />
              )}
              {ticks.map((i) => (
                <span key={i} style={{ left: `${(i / totalBeats) * 100}%` }}>
                  {i}
                </span>
              ))}
            </div>
          )}
          <div className="roll-body">
            {!compact && (
              <div className="roll-keys">
                {rows.map((midi) => (
                  <span
                    key={midi}
                    className={`${[1, 3, 6, 8, 10].includes(midi % 12) ? "black-key" : ""} ${current ? (covered.has(midi) ? "roll-covered-key" : "roll-uncovered-key") : ""}`}
                  >
                    {pitchName(midi)}
                  </span>
                ))}
              </div>
            )}
            <div
              className="roll-grid"
              ref={grid}
              style={compact ? undefined : { height: count * 18 }}
            >
              {!compact && (
                <>
                  {rows.map((midi, i) => (
                    <div
                      key={midi}
                      className={`roll-row ${[1, 3, 6, 8, 10].includes(midi % 12) ? "black-key" : ""} ${current ? (covered.has(midi) ? "roll-covered-row" : "roll-uncovered-row") : ""}`}
                      style={{ top: i * 18 }}
                      title={
                        current && !covered.has(midi)
                          ? t("roll.unavailable")
                          : undefined
                      }
                    />
                  ))}
                  {ticks.map((i) => (
                    <div
                      key={i}
                      className="roll-beat"
                      style={{ left: `${(i / totalBeats) * 100}%` }}
                    />
                  ))}
                  <div
                    className="roll-outside"
                    style={{
                      left: `${Math.min(1, sourceBeats / totalBeats) * 100}%`,
                    }}
                    title={t("roll.outside")}
                  />
                </>
              )}
              {!compact && cursor !== null && (
                <div
                  className="roll-playhead"
                  aria-hidden="true"
                  style={{ left: `${cursor}%` }}
                />
              )}
              {score.notes.map((original, index) => {
                const n = draft?.id === original.id ? draft : original;
                const span = compact
                  ? noteSpan(layer, n)
                  : {
                      start: n.start / totalBeats,
                      width: n.duration / totalBeats,
                    };
                if (
                  compact &&
                  drag.current?.note.id !== original.id &&
                  (span.start >= 1 || span.start + span.width <= 0)
                )
                  return null;
                // The overview is a thumbnail: dragging it moves the whole clip.
                // Keep individual note hit targets in the expanded editor.
                if (compact)
                  return (
                    <span
                      key={n.id}
                      className="roll-note-preview"
                      aria-hidden="true"
                      style={{
                        left: `${span.start * 100}%`,
                        width: `${span.width * 100}%`,
                        top: `${((high - n.midi) / count) * 100}%`,
                        opacity: 0.45 + (n.velocity / 127) * 0.55,
                      }}
                    />
                  );
                const issue = noteCoverageIssue(
                  score.instruments.find((i) => i.id === n.instrumentId),
                  n,
                );
                const label =
                  t(
                    "roll.note",
                    index + 1,
                    pitchName(n.midi),
                    n.start.toFixed(3),
                    n.duration.toFixed(3),
                    n.velocity,
                  ) + (issue ? ` · ${t(`note.coverage.${issue}`)}` : "");
                return (
                  <div
                    key={n.id}
                    className={`roll-note ${selected === n.id ? "selected" : ""} ${issue ? "roll-note-uncovered" : ""}`}
                    style={{
                      left: `${span.start * 100}%`,
                      width: `${span.width * 100}%`,
                      top: `${((high - n.midi) / count) * 100}%`,
                      height: `${100 / count}%`,
                    }}
                  >
                    <button
                      className="roll-note-move"
                      aria-label={label}
                      title={label}
                      {...events(original, "move")}
                    >
                      {issue ? "! " : ""}
                      {pitchName(n.midi)}
                      <span
                        className="roll-velocity"
                        style={{ width: `${(n.velocity / 127) * 100}%` }}
                      />
                    </button>
                    <button
                      className={`roll-note-resize ${compact && layer.reverse ? "reverse" : ""}`}
                      aria-label={t("roll.resize", index + 1)}
                      title={t("roll.resize", index + 1)}
                      {...events(original, "resize")}
                    />
                  </div>
                );
              })}
              {!score.notes.length && (
                <span className="roll-empty">{t("roll.empty")}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
