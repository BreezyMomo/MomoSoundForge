import { createPortal } from "react-dom";
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Play,
  Square,
  GripVertical,
  Lock,
  Unlock,
} from "lucide-react";
import type { Layer, Project, RenderResult } from "./model";
import { useNodeReorder } from "./useNodeReorder";
import { nodeKey, type NodeAddress } from "./nodeTree";
import { PlayheadTimeline } from "./PlayheadTimeline";
import { boundedSelection } from "./timeline";
import { TimelineClip } from "./TimelineClip";
import { t } from "./i18n";
import "./node-tree.css";
export function TreeTimeline({
  root,
  selected,
  ids,
  result,
  ready,
  cue,
  duration,
  zoom,
  cropMode,
  playing,
  onSelect,
  onPatch,
  onMove,
  onPreview,
  onBegin,
  onTiming,
  snap,
  onSeekStart,
  onSeek,
  onSeekEnd,
}: {
  root: Project;
  selected: NodeAddress;
  ids: string[];
  result: RenderResult | null;
  ready: boolean;
  cue: number;
  duration: number;
  zoom: number;
  cropMode: boolean;
  playing: string | null;
  onSelect: (
    address: NodeAddress,
    event?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => void;
  onPatch: (address: NodeAddress, patch: Partial<Layer>) => void;
  onMove: (
    path: string[],
    ids: string[],
    target: string[],
    before?: string,
  ) => void;
  snap: boolean;
  onTiming: (address: NodeAddress, patch: Partial<Layer>) => void;
  onSeekStart: () => void;
  onSeek: (time: number) => void;
  onSeekEnd: (time: number) => void;
  onPreview: (address: NodeAddress) => void;
  onBegin: () => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
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
    layers: Layer[];
  } | null>(null);
  const [destination, setDestination] = useState("[]");
  const rows: {
    layer: Layer;
    address: NodeAddress;
    offset: number;
    parent: Project;
  }[] = [];
  const groups: { path: string[]; name: string }[] = [
    { path: [], name: t("tree.root") },
  ];
  const collect = (
    p: Project,
    path: string[] = [],
    offset = 0,
    shown = true,
    prefix = "",
  ) => {
    for (const layer of p.layers) {
      const address = { path, id: layer.id },
        key = nodeKey(address);
      if (shown) rows.push({ layer, address, offset, parent: p });
      if (layer.project) {
        groups.push({
          path: [...path, layer.id],
          name: `${prefix}${layer.name}`,
        });
        collect(
          layer.project,
          [...path, layer.id],
          offset + layer.start,
          shown && !closed.has(key),
          `${prefix}${layer.name} / `,
        );
      }
    }
  };
  collect(root);
  const selectionAt = (path: string[]) =>
    JSON.stringify(path) === JSON.stringify(selected.path);
  return (
    <div className="node-tree">
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
      <div className="tree-move-tools">
        <label>
          {t("tree.destination")}
          <select
            aria-label={t("tree.destination")}
            value={
              groups.some((g) => JSON.stringify(g.path) === destination)
                ? destination
                : "[]"
            }
            onChange={(e) => setDestination(e.target.value)}
          >
            {groups.map((g) => (
              <option
                key={JSON.stringify(g.path)}
                value={JSON.stringify(g.path)}
              >
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={!ids.length}
          onClick={() =>
            onMove(
              selected.path,
              ids,
              JSON.parse(
                groups.some((g) => JSON.stringify(g.path) === destination)
                  ? destination
                  : "[]",
              ),
            )
          }
        >
          {t("tree.move")}
        </button>
        <span className="field-help">{t("tree.dragHelp")}</span>
      </div>
      <div className="timeline-scroll">
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
          {!!root.videoReference?.markers.length && <div className="tree-row"><span/><span/><div className="tree-marker-strip">
            {root.videoReference.markers.filter(m => m.time <= duration).map(m => <button key={m.id}
              style={{left:`${m.time / duration * 100}%`}} title={`${m.name} · ${m.time.toFixed(3)} s`}
              onClick={() => { onSeekStart(); onSeek(m.time); onSeekEnd(m.time); }}>{m.name}</button>)}
          </div><span/></div>}
          {rows.map(({ layer, address, offset, parent }) => {
            const key = nodeKey(address),
              group = layer.type === "composition";
            const chosen = selectionAt(address.path) && ids.includes(layer.id);
            const globalLayer = { ...layer, start: layer.start + offset };
            const tail = result?.tails?.[key] ?? 0;
            return (
              <div
                key={key}
                className={`layer-row tree-row ${chosen ? "selected" : ""} ${layer.muted ? "muted" : ""} ${reorder.hover?.key === key ? `node-drop-${reorder.hover.mode}` : ""} ${reorder.active?.keys.includes(key) ? "node-dragging" : ""}`}
                data-node-address={key}
                data-node-group={group ? "true" : "false"}
                role="treeitem"
                aria-level={address.path.length + 1}
                aria-selected={chosen}
                aria-expanded={group ? !closed.has(key) : undefined}
              >
                <div
                  className="tree-identity"
                  style={{
                    paddingLeft: Math.min(60, address.path.length * 14),
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
                        const index = parent.layers.indexOf(layer);
                        if (
                          (e.key === "ArrowUp" && index > 0) ||
                          (e.key === "ArrowDown" &&
                            index < parent.layers.length - 1)
                        )
                          onMove(
                            address.path,
                            [layer.id],
                            address.path,
                            parent.layers[
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
                      aria-label={t(
                        closed.has(key) ? "tree.expand" : "tree.collapse",
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
                      {closed.has(key) ? (
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
                          ? "tree.group"
                          : layer.type === "instrument"
                            ? "score.title"
                            : layer.type === "sample"
                              ? "editor.sample"
                              : "editor.synth",
                      )}
                    </small>
                  </button>
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
                <TimelineClip
                  layer={globalLayer}
                  projectDuration={duration}
                  position={cue}
                  cropMode={!group && cropMode && chosen}
                  data={
                    cropMode && chosen
                      ? result?.layers[key]
                      : (result?.processedLayers?.[key] ?? result?.layers[key])
                  }
                  tail={tail}
                  moveOnly={group}
                  onSelect={() => onSelect(address)}
                  onBegin={onBegin}
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
                          ...(root.videoReference?.markers.map(m => m.time) ?? []),
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
                          ...(draft.layers.find((l) => l.id === layer.id) ??
                            layer),
                          start:
                            (
                              draft.layers.find((l) => l.id === layer.id) ??
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
                            layers: boundedSelection(
                              parent.layers,
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
                />
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
                </div>
              </div>
            );
          })}
          {!rows.length && <p className="empty-state">{t("editor.empty")}</p>}
        </div>
      </div>
    </div>
  );
}
