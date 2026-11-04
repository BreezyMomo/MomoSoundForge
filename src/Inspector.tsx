import { useEffect, useRef, useState } from "react";
import { Copy, Trash2, SlidersHorizontal } from "lucide-react";
import type { Layer, Project } from "./model";
import { t } from "./i18n";
export function CommitText({
  value,
  onCommit,
  label,
  className = "",
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value),
    cancel = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={className}
      aria-label={label}
      value={draft}
      maxLength={120}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = cancel.current ? value : draft.trim() || value;
        cancel.current = false;
        setDraft(next);
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancel.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
export function Range({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const precision = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return (
    <label className="range-field">
      <span className="field-line">
        <span>{label}</span>
        <span className="number-wrap">
          <input
            aria-label={label}
            type="number"
            value={Number(value.toFixed(precision))}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              if (
                e.target.value !== "" &&
                Number.isFinite(e.target.valueAsNumber)
              )
                onChange(Math.max(min, Math.min(max, e.target.valueAsNumber)));
            }}
          />
          <span>{unit}</span>
        </span>
      </span>
      <input
        aria-label={`${label} slider`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </label>
  );
}
export function Inspector({
  layer,
  project,
  onChange,
  onDuplicate,
  onDelete,
}: {
  layer?: Layer;
  project: Project;
  onChange: (key: keyof Layer, value: Layer[keyof Layer]) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  if (!layer)
    return (
      <div className="empty-state">
        <SlidersHorizontal size={26} />
        <p>{t("prop.empty")}</p>
      </div>
    );
  const range = (
    key: keyof Layer,
    label: string,
    min: number,
    max: number,
    step: number,
    unit = "",
  ) => (
    <Range
      key={key}
      label={t(label)}
      value={layer[key] as number}
      min={min}
      max={max}
      step={step}
      unit={unit}
      onChange={(v) => onChange(key, v)}
    />
  );
  return (
    <div className="inspector-content">
      <div className="inspector-title">
        <div>
          <span className="eyebrow">
            {t(layer.type === "sample" ? "editor.sample" : "editor.synth")}
          </span>
          <h2>{layer.name}</h2>
        </div>
        <div className="button-group">
          <button
            className="icon-button"
            title={t("action.duplicate")}
            aria-label={t("action.duplicate")}
            disabled={project.layers.length >= 16}
            onClick={onDuplicate}
          >
            <Copy size={15} />
          </button>
          <button
            className="icon-button"
            title={t("action.delete")}
            aria-label={t("action.delete")}
            onClick={onDelete}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <label className="text-field">
        <span>{t("prop.name")}</span>
        <CommitText
          label={t("prop.name")}
          value={layer.name}
          onCommit={(v) => onChange("name", v)}
        />
      </label>
      <section className="property-section">
        <h3>{t("prop.source")}</h3>
        {layer.type === "synth" ? (
          <label className="text-field">
            <span>{t("prop.wave")}</span>
            <select
              value={layer.wave}
              onChange={(e) => onChange("wave", e.target.value)}
            >
              {["sine", "triangle", "saw", "square", "noise"].map((w) => (
                <option value={w} key={w}>
                  {t(`wave.${w}`)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <div className="asset-name">
              {project.assets[layer.assetId!]?.name}
            </div>
            <Range
              label={t("prop.rate")}
              min={0.1}
              max={4}
              step={0.01}
              value={layer.frequency / 440}
              unit="×"
              onChange={(v) => onChange("frequency", v * 440)}
            />
            <p className="field-help">{t("prop.speedHint")}</p>
            {range("trim", "prop.trim", 0, 30, 0.01, "s")}
            <label className="check-field">
              <input
                type="checkbox"
                checked={layer.reverse}
                onChange={(e) => onChange("reverse", e.target.checked)}
              />
              {t("prop.reverse")}
            </label>
          </>
        )}
        {layer.type === "synth" && layer.wave !== "noise" && (
          <>
            {range("frequency", "prop.frequency", 20, 12000, 1, "Hz")}
            {range("endFrequency", "prop.endFrequency", 20, 12000, 1, "Hz")}
          </>
        )}
      </section>
      <section className="property-section">
        <h3>{t("prop.timing")}</h3>
        {range("start", "prop.start", 0, project.duration, 0.01, "s")}
        {range("duration", "prop.duration", 0.01, 10, 0.01, "s")}
        {range(
          "attack",
          "prop.attack",
          0,
          Math.min(3, layer.duration),
          0.001,
          "s",
        )}
        {range(
          "release",
          "prop.release",
          0,
          Math.min(5, layer.duration),
          0.001,
          "s",
        )}
        {range("decay", "prop.decay", 0, 10, 0.1)}
      </section>
      <section className="property-section">
        <h3>{t("prop.timbre")}</h3>
        {range("gain", "prop.volume", 0, 1.5, 0.01)}
        {range("pan", "prop.pan", -1, 1, 0.01)}
        {range("cutoff", "prop.cutoff", 30, 22000, 10, "Hz")}
        {range("drive", "prop.drive", 0, 10, 0.1)}
      </section>
    </div>
  );
}
