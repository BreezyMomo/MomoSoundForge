import { Range, TimeInput } from "./Inspector";
import { t } from "./i18n";
import type { Project } from "./model";
export function ProjectTools({
  project,
  cue,
  onChange,
  onLoop,
  onSeam,
  busy,
}: {
  project: Project;
  cue: number;
  onChange: (p: Project) => void;
  onLoop: () => void;
  onSeam: () => void;
  busy: boolean;
}) {
  const region = project.loopRegion;
  const updateRegion = (
    start: number,
    end: number,
    crossfade = region?.crossfade ?? 0,
  ) =>
    onChange({
      ...project,
      loopRegion: {
        start,
        end,
        crossfade: Math.min(crossfade, (end - start) / 2),
      },
    });
  return (
      <div className="loop-settings">
        <label>
          <input
            type="checkbox"
            checked={!!region}
            onChange={(e) =>
              onChange({
                ...project,
                loopRegion: e.target.checked
                  ? {
                      start: 0,
                      end: project.duration,
                      crossfade: Math.min(0.02, project.duration / 4),
                    }
                  : undefined,
              })
            }
          />
          {t("pro.enableLoop")}
        </label>
        {region && (
          <>
            <div className="pro-grid">
              <label className="range-field"><span>{t("pro.loopStart")} · s</span><TimeInput
                label={t("pro.loopStart")}
                value={region.start}
                min={0}
                max={region.end - 0.01}
                onChange={(v) => updateRegion(v, region.end)}
              /></label>
              <label className="range-field"><span>{t("pro.loopEnd")} · s</span><TimeInput
                label={t("pro.loopEnd")}
                value={region.end}
                min={region.start + 0.01}
                max={project.duration}
                onChange={(v) => updateRegion(region.start, v)}
              /></label>
            </div>
            <div className="button-group">
              <button
                className="secondary"
                disabled={cue >= region.end - 0.01}
                onClick={() => updateRegion(cue, region.end)}
              >
                {t("pro.cueStart")}
              </button>
              <button
                className="secondary"
                disabled={cue <= region.start + 0.01}
                onClick={() => updateRegion(region.start, cue)}
              >
                {t("pro.cueEnd")}
              </button>
            </div>
            <p className="field-help">{t("pro.dragLoopHelp")}</p>
            <details className="loop-seam-settings">
              <summary>{t("pro.seamSettings")}</summary>
              <Range label={t("pro.crossfade")} value={region.crossfade} min={0}
                max={(region.end - region.start) / 2} step={0.001} unit="s"
                onChange={v => updateRegion(region.start, region.end, v)} />
              <div className="button-group">
              <button className="secondary" disabled={busy} onClick={onLoop}>
                {t("pro.previewLoop")}
              </button>
              <button className="secondary" disabled={busy} onClick={onSeam}>
                {t("pro.previewSeam")}
              </button>
            </div>
            <p className="field-help">
              {t(
                "pro.loopHelp",
                (region.end - region.start - region.crossfade).toFixed(3),
              )}
            </p>
            </details>
          </>
        )}
      </div>
  );
}
