import { useState, type ReactNode } from "react";
import { Button, Popover, PopoverContent, PopoverTitle, PopoverTrigger, WorkbenchChoice } from "@momo/workbench/react";
import { ChevronDown, Scissors, RotateCcw, Trash2, X } from "lucide-react";
import { Range } from "./Inspector";
import { t } from "./i18n";

export type TimelineTools = {
  groups: { path: string[]; name: string }[];
  canCollapseNotes: boolean;
  onCollapseNotes: () => void;
};

export function LayerToolbar({ groups, canCollapseNotes, onCollapseNotes, path, ids, cropMode,
  onCrop, canResetCrop, onResetCrop, snap, onSnap, zoom, onZoom, duration,
  canDuplicate, onDuplicate, onDelete, canGroup, onGroup, onMove, children, waveformHelp, tailLimited }: TimelineTools & {
  path: string[]; ids: string[]; cropMode: boolean; onCrop: () => void;
  canResetCrop: boolean; onResetCrop: () => void;
  snap: boolean; onSnap: (value: boolean) => void; zoom: number; onZoom: (value: number) => void; duration: number;
  canDuplicate: boolean; onDuplicate: () => void; canGroup: boolean; onGroup: () => void;
  onDelete: () => void;
  onMove: (target: string[]) => void; children: ReactNode; waveformHelp: string; tailLimited: boolean;
}) {
  const [open, setOpen] = useState<"selection" | "view" | "help" | null>(null);
  const [destination, setDestination] = useState("[]");
  // A group cannot be moved into itself or one of its descendants.
  const targets = groups.filter(group => !ids.some(id => [...path, id].every((part, i) => group.path[i] === part)));
  const target = targets.some(group => JSON.stringify(group.path) === destination) ? destination : "[]";
  const close = () => setOpen(null);
  const popover = (kind: "selection" | "view" | "help", label: string, player: ReactNode) => (
    <Popover open={open === kind} onOpenChange={value => setOpen(value ? kind : null)}>
      <PopoverTrigger render={<Button variant="outline" />}>
        {label}<ChevronDown size={12} />
      </PopoverTrigger>
      <PopoverContent align="start" className="layer-tool-popover">
        <div className="layer-tool-heading"><PopoverTitle>{label}</PopoverTitle>
          <Button variant="ghost" size="icon-sm" aria-label={t("action.close")} onClick={close}><X size={14} /></Button>
        </div>
        {player}
      </PopoverContent>
    </Popover>
  );
  return <>
    <div className="layer-toolbar">
      <Button variant={cropMode ? "secondary" : "outline"} aria-pressed={cropMode} onClick={onCrop}>
        <Scissors size={14} />{t(cropMode ? "editor.cropEnabled" : "editor.cropMode")}
      </Button>
      {canResetCrop && <Button variant="outline" onClick={onResetCrop}><RotateCcw size={14} />{t("editor.resetCrop")}</Button>}
      <label className="layer-snap"><input type="checkbox" checked={snap} onChange={e => onSnap(e.target.checked)}
        aria-label={t("pro.snap")} />{t("tree.snapShort")}</label>
      <Button variant="outline" disabled={!canDuplicate} onClick={onDuplicate}>{t("pro.copySelection")}</Button>
      <Button variant="outline" disabled={!ids.length} onClick={onDelete} title={t("tree.deleteHelp")}>
        <Trash2 size={14} />{t("tree.deleteSelection")}
      </Button>
      {popover("selection", t("tree.selectionMenu", ids.length), <div className="layer-selection-settings">
        <Button variant="outline" disabled={!canGroup} onClick={() => { onGroup(); close(); }}>{t("tree.groupSelected")}</Button>
        <div className="layer-move-settings">
          <WorkbenchChoice label={t("tree.destination")} value={target} onValueChange={setDestination}
            items={targets.map(group => ({ value: JSON.stringify(group.path), label: group.name }))} />
          <Button variant="outline" disabled={!ids.length || target === JSON.stringify(path)}
            onClick={() => { onMove(JSON.parse(target)); close(); }}>{t("tree.moveInto")}</Button>
        </div>
        <div className="layer-selection-actions">{children}</div>
      </div>)}
      {popover("view", t("tree.view"), <>
        <Range label={t("pro.zoom")} value={zoom} min={1} max={Math.max(8, Math.ceil(duration / 2))} step={0.25} unit="×" onChange={onZoom} />
        <Button variant="outline" onClick={() => onZoom(1)}>{t("pro.fit")}</Button>
        <Button variant="outline" disabled={!canCollapseNotes} onClick={onCollapseNotes}>{t("roll.collapseAll")}</Button>
      </>)}
      {popover("help", t("tree.operationHelp"), <div className="layer-help-player">
        <p>{t("pro.selectHelp")}</p><p>{t("tree.deleteHelp")}</p><p>{t("editor.stretchHelp")}</p><p>{t("editor.cropHelp")}</p>
        <p>{t("tree.dragHelp")}</p><p>{t("roll.overviewHint")}</p><p>{waveformHelp}</p>
        <p>{t("tree.tailHelp")}{tailLimited && ` ${t("tree.tailLimited")}`}</p>
      </div>)}
    </div>
    {cropMode && <p className="layer-mode-hint">{t("editor.cropHelp")}</p>}
  </>;
}
