import { Range } from "./Inspector";
import { t } from "./i18n";
import type { Project } from "./model";
import { SoundPolish } from "./SoundPolish";
export function ProjectTools({
  project,
  cue,
  onChange,
  onLoop,
  onSeam,
  busy,
  original,
  onCompare,
  compareBusy,
}: {
  project: Project;
  cue: number;
  onChange: (p: Project) => void;
  onLoop: () => void;
  onSeam: () => void;
  busy: boolean;
  original: boolean;
  onCompare: (original: boolean) => void;
  compareBusy: boolean;
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
    <>
      <SoundPolish project={project} onChange={onChange} original={original} onCompare={onCompare} busy={compareBusy} />
      <details className="pro-section">
        <summary>{t("pro.loop")}</summary>
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
              <Range
                label={t("pro.loopStart")}
                value={region.start}
                min={0}
                max={region.end - 0.01}
                step={0.001}
                unit="s"
                onChange={(v) => updateRegion(v, region.end)}
              />
              <Range
                label={t("pro.loopEnd")}
                value={region.end}
                min={region.start + 0.01}
                max={project.duration}
                step={0.001}
                unit="s"
                onChange={(v) => updateRegion(region.start, v)}
              />
              <Range
                label={t("pro.crossfade")}
                value={region.crossfade}
                min={0}
                max={(region.end - region.start) / 2}
                step={0.001}
                unit="s"
                onChange={(v) => updateRegion(region.start, region.end, v)}
              />
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
          </>
        )}
      </details>
    </>
  );
}
