import { Range } from "./Inspector";
import { t } from "./i18n";
import type { PlayerInput } from "./model";
import {
  DEFAULT_EFFECTS,
  type EffectParameter,
  type Effects,
} from "./advanced";
import "./sound-polish.css";
import { POLISH_GROUPS, POLISH_RANGES, polishAmount, resetPolish, type PolishKey } from './polishControls';

export function SoundPolish({
  node,
  onChange,
  original,
  onCompare,
  busy,
  embedded = false,
}: {
  node: PlayerInput;
  onChange: (effects: Effects | undefined) => void;
  original: boolean;
  onCompare: (original: boolean) => void;
  busy: boolean;
  embedded?: boolean;
}) {
  const effects = node.player.effects ?? DEFAULT_EFFECTS;
  const change = (key: EffectParameter, value: number) =>
    onChange({ ...effects, [key]: value });
  const groups = POLISH_GROUPS, ranges = POLISH_RANGES;
  const Container = embedded ? "div" : "details";
  return (
    <Container className={`pro-section sound-polish${embedded ? " inspector-polish" : ""}`} open={embedded ? undefined : true}>
      {!embedded && <><summary>{t("tree.post")}</summary>
        <p className="node-post-target">{t("tree.target", node.name)}</p></>}
      <div className="polish-toolbar">
        <div
          className="button-group"
          role="group"
          aria-label={t("polish.compare")}
        >
          <button
            className="secondary"
            aria-pressed={original}
            disabled={busy}
            onClick={() => onCompare(true)}
          >
            {t("polish.original")}
          </button>
          <button
            className="secondary"
            aria-pressed={!original}
            disabled={busy}
            onClick={() => onCompare(false)}
          >
            {t("polish.processed")}
          </button>
        </div>
        <span className="field-help" role="status">
          {t(original ? "polish.originalHelp" : "polish.compareHelp")}
        </span>
      </div>
      <div className="polish-groups">
        {groups.map((group) => {
          const enabled = effects[group.flag] !== false;
          return (
            <section
              className="polish-group"
              key={group.id}
              aria-label={t(`polish.${group.id}`)}
            >
              <div className="polish-group-title">
                <label>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) =>
                      onChange({ ...effects, [group.flag]: e.target.checked })
                    }
                  />
                  {t(`polish.${group.id}`)}
                </label>
                <button
                  className="secondary"
                  aria-label={t("polish.resetGroup", t(`polish.${group.id}`))}
                  onClick={() => {
                    onChange(resetPolish(effects, group.id));
                  }}
                >
                  {t("polish.reset")}
                </button>
              </div>
              <p className="field-help">{t(`polish.${group.id}Help`)}</p>
              {group.keys.map((key) => {
                const [min, max, step] = ranges[key];
                const amount = Math.round(polishAmount(key as PolishKey, effects[key]));
                const display =
                  key === "delayTime"
                    ? `${Number(effects[key].toFixed(3))} s`
                    : `${amount}${t("polish.amountUnit")}`;
                return (
                  <label className="polish-slider" key={key}>
                    <span>
                      {t(`polish.${key}`)}
                      <output>{display}</output>
                    </span>
                    <input
                      type="range"
                      aria-label={t(`polish.${key}`)}
                      aria-valuetext={display}
                      min={min}
                      max={max}
                      step={step}
                      value={effects[key]}
                      disabled={!enabled}
                      onChange={(e) => change(key, e.target.valueAsNumber)}
                    />
                    <span className="polish-endpoints">
                      <span>{t(`polish.${key}Start`)}</span>
                      <span>{t(`polish.${key}End`)}</span>
                    </span>
                  </label>
                );
              })}
            </section>
          );
        })}
      </div>
      <p className="field-help">{t("polish.protection")}</p>
      <details className="polish-advanced">
        <summary>{t("polish.advanced")}</summary>
        <p className="field-help">{t("polish.advancedHelp")}</p>
        <div className="pro-grid">
          {(Object.keys(ranges) as EffectParameter[])
            .filter((key) => key !== "ceiling")
            .map((key) => {
              const [min, max, step, unit] = ranges[key];
              const group = groups.find((g) => g.keys.includes(key));
              return (
                <Range
                  key={key}
                  label={t(`pro.fx.${key}`)}
                  value={effects[key]}
                  min={min}
                  max={max}
                  step={step}
                  unit={unit}
                  disabled={!!group && effects[group.flag] === false}
                  onChange={(v) => change(key, v)}
                />
              );
            })}
        </div>
      </details>
      <button className="secondary" onClick={() => onChange(undefined)}>
        {t("pro.resetEffects")}
      </button>
    </Container>
  );
}
