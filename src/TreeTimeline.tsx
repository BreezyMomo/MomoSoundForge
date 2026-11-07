import { useTimelineNavigation } from './useTimelineNavigation';
import { hasTimeTransform } from "./playerPlayback";
import { patchLayer, type LayerPatch } from "./model";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TimelineTools } from "./LayerToolbar";
import {
  ChevronDown,
  ChevronRight,
  Play,
  Square,
  GripVertical,
  Lock,
  Unlock,
  Trash2,
} from "lucide-react";
import type { PlayerInput, Project, RenderResult } from "./model";
import { useNodeReorder } from "./useNodeReorder";
import { nodeKey, nodeParent, type NodeAddress } from "./nodeTree";
import { PlayheadTimeline } from "./PlayheadTimeline";
import { boundedSelection } from "./timeline";
import { TimelineClip } from "./TimelineClip";
import { NoteRoll } from "./NoteRoll";
import { scoreBeatAtTime, scoreTimeAtBeat } from "./noteEditing";
import type { NoteEvent } from "./instruments";
import { t } from "./i18n";
import "./node-tree.css";
export function TreeTimeline({
  root,
  viewPath = [],
  selected,
  ids,
  result,
  ready,
  beforeKey,
  cue,
  duration,
  zoom,
  onZoom,
  playing,
  previewTime,
  onSelect,
  onClearSelection,
  onDeleteSelection,
  onDeleteNode,
  onPatch,
  onMove,
  onPreview,
  onNoteAudition,
  onOpenNotes,
  onBegin,
  onTiming,
  snap,
  onSeekStart,
  onSeek,
  onSeekEnd,
  renderAdd,
  onChooseNoteVoice,
  renderToolbar,
}: {
  root: Project;
  viewPath?: string[];
  selected: NodeAddress;
  ids: string[];
  result: RenderResult | null;
  ready: boolean;
  beforeKey?: string;
  cue: number;
  duration: number;
  zoom: number;
  onZoom: (value: number) => void;
  playing: string | null;
  previewTime: number;
  onSelect: (
    address: NodeAddress,
    event?: {
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    },
  ) => void;
  onPatch: (address: NodeAddress, patch: LayerPatch) => void;
  onClearSelection: () => void;
  onDeleteSelection: () => void;
  onDeleteNode: (address: NodeAddress) => void;
  onMove: (
    path: string[],
    ids: string[],
    target: string[],
    before?: string,
  ) => void;
  snap: boolean;
  onTiming: (address: NodeAddress, patch: LayerPatch) => void;
  onSeekStart: () => void;
  onSeek: (time: number) => void;
  onSeekEnd: (time: number) => void;
  onPreview: (address: NodeAddress) => void;
  onNoteAudition: (address: NodeAddress, note: NoteEvent) => void;
  onOpenNotes: (address: NodeAddress) => void;
  onBegin: () => void;
  renderAdd: (path: string[]) => ReactNode;
  onChooseNoteVoice: (address: NodeAddress) => void;
  renderToolbar: (tools: TimelineTools) => ReactNode;
}) {
  const navigation = useTimelineNavigation(zoom, Math.max(8, Math.ceil(duration / 2)), onZoom);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [openScore, setOpenScore] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const selectedKey = nodeKey(selected);
  useEffect(() => {
    setClosed(previous => {
      const next = new Set(previous);
      for (let i = 1; i <= selected.path.length; i++) next.delete(JSON.stringify(selected.path.slice(0, i)));
      return next.size === previous.size ? previous : next;
    });
    const frame = requestAnimationFrame(() => {
      const row = Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[data-node-address]') ?? [])
        .find(element => element.dataset.nodeAddress === selectedKey);
      row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedKey]);
  const reorder = useNodeReorder(
    root,
    (path, moving, target, before) => {
      setClosed((previous) => {
        const next = new Set(previous);
        for (let i = 1; i <= target.length; i++)
          next.delete(JSON.stringify(target.slice(0, i)));
        return next;
      });
      onMove(path, moving, target, before);
    },
    onBegin,
  );
  const [draft, setDraft] = useState<{
    path: string[];
    inputs: PlayerInput[];
  } | null>(null);
  const rows: {
    layer: PlayerInput;
    address: NodeAddress;
    offset: number;
    parent: Project;
  }[] = [];
  const groups: {
    path: string[];
    name: string;
  }[] = [{ path: [], name: t("tree.root") }];
  const collect = (
    p: Project,
    path: string[] = [],
    offset = 0,
    shown = true,
    prefix = "",
  ) => {
    for (const layer of p.inputs) {
      const address = { path, id: layer.id },
        key = nodeKey(address);
      if (shown) rows.push({ layer, address, offset, parent: p });
      if (layer.player.mix) {
        groups.push({
          path: [...path, layer.id],
          name: `${prefix}${layer.name}`,
        });
        collect(
          layer.player.mix,
          [...path, layer.id],
          offset + layer.start,
          shown && !closed.has(key) && !hasTimeTransform(layer),
          `${prefix}${layer.name} / `,
        );
      }
    }
  };
  collect(nodeParent(root, viewPath), viewPath);
  const previewRow = rows.find(
    ({ address }) => playing === `node-${nodeKey(address)}`,
  );
  const selectionAt = (path: string[]) =>
    JSON.stringify(path) === JSON.stringify(selected.path);
  return (
    <div
      className="node-tree"
      ref={treeRef}
      onKeyDown={(event) => {
        if (
          event.key === "Delete" &&
          !event.defaultPrevented &&
          !event.repeat &&
          !event.nativeEvent.isComposing &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey &&
          !reorder.active &&
          ids.length &&
          !(event.target as HTMLElement).closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], [role="dialog"], .note-roll',
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          onDeleteSelection();
          return;
        }
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !reorder.active &&
          !(event.target as HTMLElement).closest(
            'input, textarea, select, [role="combobox"], [role="dialog"], .tree-note-editor',
          )
        ) {
          event.preventDefault();
          onClearSelection();
        }
      }}
    >
      {reorder.active &&
        createPortal(
          <div
            className="node-drag-ghost"
            style={{ left: reorder.active.x + 12, top: reorder.active.y + 12 }}
            aria-hidden="true"
          >
            <GripVertical size={14} />
            {reorder.active.name}
          </div>,
          document.body,
        )}
      {renderToolbar({
        groups,
        handMode: navigation.hand,
        onHandMode: navigation.setHand,
        onZoomView: navigation.zoomAt,
        canCollapseNotes: openScore !== null,
        onCollapseNotes: () => setOpenScore(null),
      })}
      <div className={`timeline-scroll timeline-navigation ${navigation.hand ? "is-hand-mode" : ""} ${navigation.panning ? "is-panning" : ""}`} ref={navigation.viewport} tabIndex={0} role="region" aria-label={t("timeline.navigation")} {...navigation.events}>
        <div
          className="layer-list"
          style={{ width: `${zoom * 100}%` }}
          role="tree"
          aria-label={t("tree.title")}
        >
          <div className="tree-row tree-ruler">
            <span />
            <span />
            <PlayheadTimeline
              compact
              duration={duration}
              position={cue}
              disabled={!ready}
              version={root}
              onSeekStart={onSeekStart}
              onSeek={onSeek}
              onSeekEnd={onSeekEnd}
            />
            <span />
          </div>
          {!viewPath.length && !!root.videoReference?.markers.length && (
            <div className="tree-row">
              <span />
              <span />
              <div className="tree-marker-strip">
                {root.videoReference.markers
                  .filter((m) => m.time <= duration)
                  .map((m) => (
                    <button
                      key={m.id}
                      style={{ left: `${(m.time / duration) * 100}%` }}
                      title={`${m.name} · ${m.time.toFixed(3)} s`}
                      onClick={() => {
                        onSeekStart();
                        onSeek(m.time);
                        onSeekEnd(m.time);
                      }}
                    >
                      {m.name}
                    </button>
                  ))}
              </div>
              <span />
            </div>
          )}
          {rows.map(({ layer, address, offset, parent }) => {
            const key = nodeKey(address),
              group = layer.player.type === "composition";
            const chosen = selectionAt(address.path) && ids.includes(layer.id);
            const tail = result?.tails?.[key] ?? 0;
            const previewPath = previewRow && [
              ...previewRow.address.path,
              previewRow.address.id,
            ];
            const inPreview =
              previewRow &&
              (nodeKey(previewRow.address) === key ||
                previewPath!.every((id, index) => address.path[index] === id));
            const scoreTime = inPreview
              ? previewTime + previewRow.offset + previewRow.layer.start
              : cue;
            const timeAtBeat = (beat: number) =>
              Math.max(
                0,
                Math.min(duration, scoreTimeAtBeat(layer, beat, offset)),
              );
            const changeNote = (note: NoteEvent) =>
              onPatch(address, {
                player: {
                  score: {
                    ...layer.player.score!,
                    notes: layer.player.score!.notes.map((n) =>
                      n.id === note.id ? note : n,
                    ),
                  },
                },
              });
            return (
              <div
                key={key}
                className={`layer-row tree-row ${chosen ? "selected" : ""} ${layer.muted ? "muted" : ""} ${reorder.hover?.key === key ? `node-drop-${reorder.hover.mode}` : ""} ${reorder.active?.keys.includes(key) ? "node-dragging" : ""}`}
                data-node-address={key}
                data-node-group={group ? "true" : "false"}
                role="treeitem"
                aria-level={address.path.length - viewPath.length + 1}
                aria-selected={chosen}
                aria-expanded={group ? !closed.has(key) && !hasTimeTransform(layer) : undefined}
              >
                <div
                  className={`tree-identity ${group ? "tree-group-identity" : ""}`}
                  style={{
                    paddingLeft: Math.min(60, (address.path.length - viewPath.length) * 14),
                  }}
                >
                  <button
                    className="node-drag-handle"
                    aria-label={t("tree.drag", layer.name)}
                    title={t("tree.dragHint")}
                    onPointerDown={(e) =>
                      reorder.begin(
                        e,
                        address,
                        chosen ? ids : [layer.id],
                        layer.name,
                      )
                    }
                    onPointerMove={reorder.move}
                    onPointerUp={reorder.end}
                    onPointerCancel={reorder.cancel}
                    onLostPointerCapture={reorder.cancel}
                    onKeyDown={(e) => {
                      if (
                        e.altKey &&
                        ["ArrowUp", "ArrowDown"].includes(e.key)
                      ) {
                        e.preventDefault();
                        e.stopPropagation();
                        const index = parent.inputs.indexOf(layer);
                        if (
                          (e.key === "ArrowUp" && index > 0) ||
                          (e.key === "ArrowDown" &&
                            index < parent.inputs.length - 1)
                        )
                          onMove(
                            address.path,
                            [layer.id],
                            address.path,
                            parent.inputs[
                              index + (e.key === "ArrowUp" ? -1 : 2)
                            ]?.id,
                          );
                      }
                    }}
                  >
                    <GripVertical size={14} />
                  </button>
                  {group ? (
                    <button
                      className="icon-button"
                      disabled={hasTimeTransform(layer)}
                      title={hasTimeTransform(layer) ? t("player.editGroup") : undefined}
                      aria-label={t(
                        closed.has(key) || hasTimeTransform(layer) ? "tree.expand" : "tree.collapse",
                        layer.name,
                      )}
                      onClick={() =>
                        setClosed((prev) => {
                          const next = new Set(prev);
                          next.has(key) ? next.delete(key) : next.add(key);
                          return next;
                        })
                      }
                    >
                      {closed.has(key) || hasTimeTransform(layer) ? (
                        <ChevronRight size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      )}
                    </button>
                  ) : (
                    <span className="tree-spacer" />
                  )}
                  <button
                    className="tree-node-name"
                    onClick={(e) => onSelect(address, e)}
                    title={layer.name}
                  >
                    <strong>{layer.name}</strong>
                    <small>
                      {t(
                        group
                          ? beforeKey === key
                            ? "tree.groupBefore"
                            : "tree.groupProcessed"
                          : layer.player.type === "instrument"
                            ? "score.title"
                            : layer.player.type === "sample"
                              ? "editor.sample"
                              : "editor.synth",
                      )}
                    </small>
                  </button>
                  {group && <span className="tree-group-add">{renderAdd([...address.path, layer.id])}</span>}
                  {layer.player.type === "instrument" && (
                    <button
                      className="tree-note-toggle"
                      aria-label={t("roll.toggle", layer.name)}
                      aria-expanded={openScore === key}
                      onClick={() => {
                        onSelect(address);
                        setOpenScore(openScore === key ? null : key);
                      }}
                    >
                      {openScore === key ? (
                        <ChevronDown size={12} />
                      ) : (
                        <ChevronRight size={12} />
                      )}
                      {t("roll.notes")}
                    </button>
                  )}
                </div>
                <button
                  className="icon-button"
                  aria-label={t("tree.preview", layer.name)}
                  title={t("tree.previewHelp")}
                  onClick={() => onPreview(address)}
                >
                  {playing === `node-${key}` ? (
                    <Square size={13} />
                  ) : (
                    <Play size={13} />
                  )}
                </button>
                {layer.player.type === "instrument" && !layer.player.score?.instruments.length ? <button className="empty-note-voice" onClick={() => onChooseNoteVoice(address)}>{t("add.chooseVoice")}</button> : <TimelineClip
                  layer={layer}
                  offset={offset}
                  projectDuration={duration}
                  position={cue}
                  data={result?.processedLayers?.[key] ?? result?.inputs[key]}
                  tail={tail}
                  sampleRate={result?.sampleRate}
                  tailData={result?.processedLayers?.[key]}
                  moveOnly={false}
                  onSelect={(event) => onSelect(address, event)}
                  onClearSelection={onClearSelection}
                  onBegin={onBegin}
                  onNoteChange={changeNote}
                  onNoteAudition={(note) => onNoteAudition(address, note)}
                  onExpandNotes={() => {
                    onSelect(address);
                    setOpenScore(key);
                  }}
                  disabledParameters={(parent.controls ?? []).flatMap((c) =>
                    c.mappings
                      .filter((m) => m.layerId === layer.id)
                      .map((m) => m.parameter),
                  )}
                  constrain={(next) => ({
                    ...next,
                    start: Math.max(
                      offset,
                      Math.min(duration - next.duration, next.start),
                    ),
                  })}
                  snapTargets={
                    snap
                      ? [
                          cue,
                          0,
                          ...(!viewPath.length ? root.videoReference?.markers.map((m) => m.time) ?? [] :
                            []),
                          ...rows
                            .filter(
                              (r) =>
                                !selectionAt(r.address.path) ||
                                !ids.includes(r.layer.id),
                            )
                            .flatMap((r) => [
                              r.offset + r.layer.start,
                              r.offset + r.layer.start + r.layer.duration,
                            ]),
                        ]
                      : []
                  }
                  displayLayer={
                    draft &&
                    JSON.stringify(draft.path) === JSON.stringify(address.path)
                      ? {
                          ...(draft.inputs.find((l) => l.id === layer.id) ??
                            layer),
                          start:
                            (
                              draft.inputs.find((l) => l.id === layer.id) ??
                              layer
                            ).start + offset,
                        }
                      : undefined
                  }
                  onPreview={(next) =>
                    setDraft(
                      next
                        ? {
                            path: address.path,
                            inputs: boundedSelection(
                              parent.inputs,
                              chosen ? ids : [layer.id],
                              layer,
                              { ...next, start: next.start - offset },
                              Math.max(parent.duration, duration - offset),
                            ),
                          }
                        : null,
                    )
                  }
                  onCommit={(next) => {
                    setDraft(null);
                    onTiming(address, {
                      ...next,
                      ...(next.start === undefined
                        ? {}
                        : { start: next.start - offset }),
                    });
                  }}
                />}
                <div className="layer-controls">
                  <button
                    className={layer.muted ? "toggle on" : "toggle"}
                    aria-pressed={layer.muted}
                    aria-label={`${t("editor.muted")} ${layer.name}`}
                    onClick={() => onPatch(address, { muted: !layer.muted })}
                  >
                    M
                  </button>
                  <button
                    className={layer.solo ? "toggle on" : "toggle"}
                    aria-pressed={layer.solo}
                    aria-label={`${t("editor.solo")} ${layer.name}`}
                    onClick={() => onPatch(address, { solo: !layer.solo })}
                  >
                    S
                  </button>
                  <button
                    className={layer.locked ? "toggle on" : "toggle"}
                    aria-pressed={layer.locked}
                    aria-label={`${t("editor.lock")} ${layer.name}`}
                    onClick={() => onPatch(address, { locked: !layer.locked })}
                  >
                    {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
                  </button>
                  <button
                    className="icon-button layer-delete"
                    aria-label={t("tree.deleteNode", layer.name)}
                    title={t("tree.deleteNodeHelp")}
                    onClick={() => onDeleteNode(address)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {layer.player.type === "instrument" &&
                  layer.player.score &&
                  openScore === key && (
                    <div className="tree-note-editor">
                      <NoteRoll
                        layer={layer}
                        onChange={changeNote}
                        onSelect={() => onSelect(address)}
                        playheadBeat={scoreBeatAtTime(layer, scoreTime, offset)}
                        playheadVisible={
                          (!playing || playing === "main" || !!inPreview) &&
                          scoreTime >= offset + layer.start &&
                          scoreTime <= offset + layer.start + layer.duration
                        }
                        followPlayhead={playing === "main" || !!inPreview}
                        seekReady={ready}
                        onSeekStart={onSeekStart}
                        onSeekBeat={(beat) => onSeek(timeAtBeat(beat))}
                        onSeekEnd={(beat) => onSeekEnd(timeAtBeat(beat))}
                        onBegin={onBegin}
                        onAudition={(note) => onNoteAudition(address, note)}
                        onExpand={() => onOpenNotes(address)}
                      />
                    </div>
                  )}
              </div>
            );
          })}
          {!rows.length && <p className="empty-state">{t("editor.empty")}</p>}
        </div>
      </div>
    </div>
  );
}
