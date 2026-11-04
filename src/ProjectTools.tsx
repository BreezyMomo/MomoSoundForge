import { Range } from "./Inspector";
import { t } from "./i18n";
import type { Project } from "./model";
import { DEFAULT_EFFECTS, type Effects } from "./advanced";
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
  const effects = project.effects ?? DEFAULT_EFFECTS,
    region = project.loopRegion;
  const effect = (
    key: keyof Effects,
    min: number,
    max: number,
    step = 0.01,
    unit = "",
  ) => (
    <Range
      key={key}
      label={t(`pro.fx.${key}`)}
      value={effects[key]}
      min={min}
      max={max}
      step={step}
      unit={unit}
      onChange={(v) =>
        onChange({ ...project, effects: { ...effects, [key]: v } })
      }
    />
  );
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
      <details className="pro-section">
        <summary>{t("pro.effects")}</summary>
        <div className="pro-grid">
          {effect("low", -24, 24, 0.1, "dB")}
          {effect("mid", -24, 24, 0.1, "dB")}
          {effect("high", -24, 24, 0.1, "dB")}
          {effect("delayTime", 0.01, 1, 0.001, "s")}
          {effect("delayFeedback", 0, 0.85)}
          {effect("delayWet", 0, 1)}
          {effect("reverb", 0, 1)}
          {effect("ceiling", -12, 0, 0.1, "dBFS")}
        </div>
        <button
          className="secondary"
          onClick={() => onChange({ ...project, effects: undefined })}
        >
          {t("pro.resetEffects")}
        </button>
      </details>
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
