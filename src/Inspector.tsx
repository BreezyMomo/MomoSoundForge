import {
  WorkbenchNumberInput,
  WorkbenchSlider,
  Field,
  FieldLabel,
} from "@momo/workbench/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, useId } from "react";
import { Copy, Trash2, SlidersHorizontal } from "lucide-react";
import type { Layer, Project } from "./model";
import { t } from "./i18n";
import { AutomationEditor } from "./AuthoringTools";
import {
  PARAMS,
  boundControl,
  resolveControls,
  type Parameter,
  type AutomationKey,
} from "./advanced";
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
export function TimeInput({
  label,
  value,
  min = 0,
  max,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <WorkbenchNumberInput
      label={label}
      value={Number(value.toFixed(3))}
      min={min}
      max={max}
      step={0.001}
      disabled={disabled}
      onValueCommit={onChange}
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
  disabled = false,
  unbounded = false,
}: {
  unbounded?: boolean;
  disabled?: boolean;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const precision = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return (
    <Field className="wb:gap-1">
      <div className="wb:flex wb:items-center wb:justify-between wb:gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <div className="wb:flex wb:items-center wb:gap-1">
          <WorkbenchNumberInput
            id={id}
            label={label}
            value={Number(value.toFixed(precision))}
            min={min}
            max={unbounded ? undefined : max}
            step={step}
            disabled={disabled}
            onValueCommit={onChange}
            className="sound-range-number"
          />
          {unit && <span>{unit}</span>}
        </div>
      </div>
      <WorkbenchSlider
        label={t("control.slider", label)}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={onChange}
      />
    </Field>
  );
}
export function Inspector({
  layer,
  project,
  onChange,
  onDuplicate,
  onDelete,
  onEnter,
  onExpose,
  postProcessing,
  sourceEditor,
}: {
  postProcessing?: ReactNode;
  sourceEditor?: ReactNode;
  layer?: Layer;
  project: Project;
  onChange: (key: keyof Layer, value: Layer[keyof Layer]) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEnter: () => void;
  onExpose: (key: Parameter) => void;
}) {
  if (!layer)
    return (
      <div className="empty-state">
        <SlidersHorizontal size={26} />
        <p>{t("prop.empty")}</p>
      </div>
    );
  const effective =
    resolveControls(project).layers.find((l) => l.id === layer.id) ?? layer;
  const range = (
    key: keyof Layer,
    label: string,
    min: number,
    max: number,
    step: number,
    unit = "",
  ) => {
    const driver = boundControl(project, layer.id, key),
      curve = layer.automation?.[key as AutomationKey]?.length;
    return (
      <div key={key} className="exposable-field">
        <Range
          label={t(label)}
          value={effective[key] as number}
          min={min}
          max={max}
          step={step}
          unit={unit}
          unbounded={key === "start" || key === "duration" || key === "trim"}
          disabled={!!driver || !!curve}
          onChange={(v) => onChange(key, v)}
        />
        {driver ? (
          <small>{t("pro.controlled", driver.name)}</small>
        ) : curve ? (
          <small>{t("pro.curveControlled")}</small>
        ) : key in PARAMS ? (
          <button
            className="expose-button"
            title={t("pro.exposeHint")}
            onClick={() => onExpose(key as Parameter)}
          >
            {t("pro.expose")}
          </button>
        ) : null}
      </div>
    );
  };
  return (
    <div className="inspector-content">
      <div className="inspector-title">
        <div>
          <span className="eyebrow">
            {t(
              layer.type === "sample"
                ? "editor.sample"
                : layer.type === "instrument"
                  ? "score.title"
                  : layer.type === "composition"
                    ? "editor.composition"
                    : "editor.synth",
            )}
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
      {sourceEditor}
      {postProcessing}
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
              {layer.type === "instrument"
                ? t("score.editHint")
                : layer.type === "composition"
                  ? layer.project?.name
                  : project.assets[layer.assetId!]?.name}
            </div>
            {layer.type === "sample" && project.assets[layer.assetId!]?.source && (() => {
              const source = project.assets[layer.assetId!]!.source!;
              return <p className="field-help">
                {t(source.quality === 'preview' ? 'ai.samplePreview' : 'ai.sampleOriginal')} · {source.license}
                {' · '}<a href={source.url} target="_blank" rel="noopener noreferrer">{t('ai.sampleSource')}: {source.provider} / {source.author}</a>
              </p>;
            })()}
            {layer.type === "composition" && (
              <>
                <p className="field-help">
                  {t(
                    "composition.sourceInfo",
                    layer.project?.layers.length ?? 0,
                    layer.project?.duration.toFixed(2) ?? "0",
                  )}
                </p>
                {layer.project?.controls
                  ?.filter((c) => !c.hidden)
                  .map((c) => {
                    const driver = project.controls?.find((x) =>
                      x.mappings.some(
                        (m) =>
                          m.layerId === layer.id &&
                          m.parameter === "control" &&
                          m.controlId === c.id,
                      ),
                    );
                    return (
                      <div key={c.id}>
                        <Range
                          label={c.name}
                          value={
                            effective.controlValues?.[c.id] ??
                            layer.project?.controlValues?.[c.id] ??
                            c.defaultValue
                          }
                          min={c.min}
                          max={c.max}
                          step={(c.max - c.min) / 1000}
                          disabled={!!driver}
                          onChange={(v) =>
                            onChange("controlValues", {
                              ...layer.controlValues,
                              [c.id]: v,
                            })
                          }
                        />
                        {driver && (
                          <small>{t("pro.controlled", driver.name)}</small>
                        )}
                      </div>
                    );
                  })}
                <button className="secondary wide" onClick={onEnter}>
                  {t("composition.enter")}
                </button>
              </>
            )}
            {layer.type !== "composition" && (
              <>
                <Range
                  label={t("prop.rate")}
                  min={0.1}
                  max={4}
                  step={0.01}
                  value={effective.frequency / 440}
                  disabled={!!boundControl(project, layer.id, "frequency")}
                  unit="×"
                  onChange={(v) => onChange("frequency", v * 440)}
                />
                {!boundControl(project, layer.id, "frequency") && (
                  <button
                    className="expose-button"
                    onClick={() => onExpose("frequency")}
                  >
                    {t("pro.expose")}
                  </button>
                )}
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
          </>
        )}
        {layer.type === "synth" && layer.wave !== "noise" && (
          <>
            {range("frequency", "prop.frequency", 20, 20000, 1, "Hz")}
            {range("endFrequency", "prop.endFrequency", 20, 20000, 1, "Hz")}
          </>
        )}
      </section>
      <section className="property-section">
        <h3>{t("prop.timing")}</h3>
        {range(
          "start",
          "prop.start",
          0,
          Math.max(project.duration, layer.start),
          0.01,
          "s",
        )}
        {layer.type !== "composition" && (
          <>
            {range(
              "duration",
              "prop.duration",
              0.01,
              Math.max(project.duration, layer.duration),
              0.01,
              "s",
            )}
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
            <Range
              label={t("pro.cropStart")}
              min={0}
              max={Math.max(0, (layer.cropEnd ?? 1) * layer.duration - 0.001)}
              step={0.001}
              unit="s"
              value={(layer.cropStart ?? 0) * layer.duration}
              onChange={(v) => onChange("cropStart", v / layer.duration)}
            />
            <Range
              label={t("pro.cropEnd")}
              min={(layer.cropStart ?? 0) * layer.duration + 0.001}
              max={layer.duration}
              step={0.001}
              unit="s"
              value={(layer.cropEnd ?? 1) * layer.duration}
              onChange={(v) => onChange("cropEnd", v / layer.duration)}
            />
            <p className="field-help">
              {t(
                "pro.speed",
                (
                  (layer.sourceDuration ?? layer.duration) / layer.duration
                ).toFixed(3),
              )}
            </p>
          </>
        )}
      </section>
      <section className="property-section">
        <h3>{t("prop.timbre")}</h3>
        {range("gain", "prop.volume", 0, 1.5, 0.01)}
        {range("pan", "prop.pan", -1, 1, 0.01)}
        {layer.type !== "composition" &&
          range("cutoff", "prop.cutoff", 30, 22000, 10, "Hz")}
        {layer.type !== "composition" &&
          range("drive", "prop.drive", 0, 10, 0.1)}
      </section>
      <AutomationEditor
        key={`automation-${layer.id}`}
        layer={layer}
        project={project}
        onChange={(v) => onChange("automation", v)}
      />
    </div>
  );
}
