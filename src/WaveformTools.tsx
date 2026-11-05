import { useEffect, useRef, useState } from "react";
import { Button, Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@momo/workbench/react";
import { ChevronDown, X } from "lucide-react";
import type { Project } from "./model";
import { TimeInput } from "./Inspector";
import { ProjectTools } from "./ProjectTools";
import { t } from "./i18n";

export function WaveformTools({ project, cue, ready, busy, truncated, extendedDuration, tailLimited,
  onChange, onLoop, onSeam }: {
  project: Project; cue: number; ready: boolean; busy: boolean; truncated: boolean;
  extendedDuration: number; tailLimited: boolean;
  onChange: (project: Project) => void; onLoop: () => void; onSeam: () => void;
}) {
  const [open, setOpen] = useState<"duration" | "loop" | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(280);
  const measure = () => {
    if (host.current) setHeight(Math.max(48, Math.min(320, window.innerHeight - host.current.getBoundingClientRect().bottom - 16)));
  };
  const toggle = (target: "duration" | "loop", value: boolean) => { measure(); setOpen(value ? target : null); };
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open]);
  const region = project.loopRegion;
  const missing = (extendedDuration - project.duration).toFixed(3);
  const close = <Button variant="ghost" size="icon" aria-label={t("action.close")} onClick={() => setOpen(null)}><X size={14} /></Button>;
  return <div className="waveform-tools" ref={host}>
    <Popover open={open === "duration"} onOpenChange={value => toggle("duration", value)}>
      <PopoverTrigger render={<Button variant="outline" />}>
        {t("editor.durationSummary", project.duration.toFixed(3))}<ChevronDown size={12} />
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="waveform-tool-popover" style={{ maxHeight: height }}>
        <div className="waveform-tool-heading"><PopoverTitle>{t("editor.duration")}</PopoverTitle>{close}</div>
        <label className="range-field"><span>{t("editor.duration")} · s</span>
          <TimeInput label={t("editor.duration")} value={project.duration} min={0.1}
            onChange={duration => onChange({ ...project, duration })} />
        </label>
        <Button variant="outline" disabled={!ready || !truncated}
          onClick={() => onChange({ ...project, duration: Math.max(project.duration, extendedDuration) })}>
          {truncated ? t("editor.extendToSeconds", extendedDuration.toFixed(3)) : t("editor.extendToContent")}
        </Button>
        <p className="field-help" role="status">{!ready ? t("tree.waveUpdating") : truncated
          ? t("editor.outsideRange", project.duration.toFixed(3), missing) : t("editor.rangeComplete")}</p>
        <p className="field-help">{t("editor.extendHelp")}{tailLimited && ` ${t("tree.tailLimited")}`}</p>
      </PopoverContent>
    </Popover>
    <Popover open={open === "loop"} onOpenChange={value => toggle("loop", value)}>
      <PopoverTrigger render={<Button variant="outline" />}>
        {region ? t("pro.loopSummary", region.start.toFixed(3), region.end.toFixed(3)) : t("pro.loopWhole")}<ChevronDown size={12} />
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="waveform-tool-popover" style={{ maxHeight: height }}>
        <div className="waveform-tool-heading"><PopoverTitle>{t("pro.loopRange")}</PopoverTitle>{close}</div>
        <ProjectTools project={project} cue={cue} onChange={onChange} onLoop={onLoop} onSeam={onSeam} busy={busy} />
      </PopoverContent>
    </Popover>
    {truncated && <span className="range-truncation" role="status">{t("editor.missingDuration", missing)}</span>}
  </div>;
}
