import { Range } from "./Inspector";
import { t } from "./i18n";
import type { Project } from "./model";
import { DEFAULT_EFFECTS, type EffectParameter, type EffectGroup } from "./advanced";
import "./sound-polish.css";

export function SoundPolish({ project, onChange, original, onCompare, busy }: {
  project: Project; onChange: (project: Project) => void;
  original: boolean; onCompare: (original: boolean) => void; busy: boolean;
}) {
  const effects = project.effects ?? DEFAULT_EFFECTS;
  const change = (key: EffectParameter, value: number) => onChange({ ...project, effects: { ...effects, [key]: value } });
  const groups: { id: string; flag: EffectGroup; keys: EffectParameter[] }[] = [
    { id: "tone", flag: "toneEnabled", keys: ["low", "mid", "high"] },
    { id: "delay", flag: "delayEnabled", keys: ["delayTime", "delayFeedback", "delayWet"] },
    { id: "space", flag: "spaceEnabled", keys: ["reverb"] },
  ];
  const ranges: Record<EffectParameter, [number, number, number, string]> = {
    low: [-24, 24, 0.1, "dB"], mid: [-24, 24, 0.1, "dB"], high: [-24, 24, 0.1, "dB"],
    delayTime: [0.01, 1, 0.001, "s"], delayFeedback: [0, 0.85, 0.01, ""], delayWet: [0, 1, 0.01, ""],
    reverb: [0, 1, 0.01, ""], ceiling: [-12, 0, 0.1, "dBFS"],
  };
  return <details className="pro-section sound-polish" open>
    <summary>{t("polish.title")}</summary>
    <div className="polish-toolbar">
      <div className="button-group" role="group" aria-label={t("polish.compare")}>
        <button className="secondary" aria-pressed={original} disabled={busy} onClick={() => onCompare(true)}>{t("polish.original")}</button>
        <button className="secondary" aria-pressed={!original} disabled={busy} onClick={() => onCompare(false)}>{t("polish.processed")}</button>
      </div>
      <span className="field-help" role="status">{t(original ? "polish.originalHelp" : "polish.compareHelp")}</span>
    </div>
    <div className="polish-groups">
      {groups.map(group => {
        const enabled = effects[group.flag] !== false;
        return <section className="polish-group" key={group.id} aria-label={t(`polish.${group.id}`)}>
          <div className="polish-group-title">
            <label><input type="checkbox" checked={enabled} onChange={e => onChange({ ...project, effects: { ...effects, [group.flag]: e.target.checked } })} />{t(`polish.${group.id}`)}</label>
            <button className="secondary" aria-label={t("polish.resetGroup", t(`polish.${group.id}`))} onClick={() => {
              const next = { ...effects, [group.flag]: true };
              group.keys.forEach(key => { next[key] = DEFAULT_EFFECTS[key]; });
              onChange({ ...project, effects: next });
            }}>{t("polish.reset")}</button>
          </div>
          <p className="field-help">{t(`polish.${group.id}Help`)}</p>
          {group.keys.map(key => {
            const [min, max, step] = ranges[key];
            const tone = group.id === "tone";
            const amount = Math.round(tone ? effects[key] / max * 100 : (effects[key] - min) / (max - min) * 100);
            const display = key === "delayTime" ? `${Number(effects[key].toFixed(3))} s` : `${amount}${t("polish.amountUnit")}`;
            return <label className="polish-slider" key={key}>
              <span>{t(`polish.${key}`)}<output>{display}</output></span>
              <input type="range" aria-label={t(`polish.${key}`)} aria-valuetext={display} min={min} max={max} step={step} value={effects[key]} disabled={!enabled} onChange={e => change(key, e.target.valueAsNumber)} />
              <span className="polish-endpoints"><span>{t(`polish.${key}Start`)}</span><span>{t(`polish.${key}End`)}</span></span>
            </label>;
          })}
        </section>;
      })}
    </div>
    <p className="field-help">{t("polish.protection")}</p>
    <details className="polish-advanced">
      <summary>{t("polish.advanced")}</summary>
      <p className="field-help">{t("polish.advancedHelp")}</p>
      <div className="pro-grid">{(Object.keys(ranges) as EffectParameter[]).map(key => {
        const [min, max, step, unit] = ranges[key];
        const group = groups.find(g => g.keys.includes(key));
        return <Range key={key} label={t(`pro.fx.${key}`)} value={effects[key]} min={min} max={max} step={step} unit={unit} disabled={!!group && effects[group.flag] === false} onChange={v => change(key, v)} />;
      })}</div>
    </details>
    <button className="secondary" onClick={() => onChange({ ...project, effects: undefined })}>{t("pro.resetEffects")}</button>
  </details>;
}
