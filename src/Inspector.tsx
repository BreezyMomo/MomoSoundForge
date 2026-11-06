import { hasReadOverflow, playerDuration } from "./playerPlayback";
import {
  layerValue,
  withLayerValue,
  type LayerField,
  type LayerValue,
} from "./model";
import {
  WorkbenchNumberInput,
  WorkbenchSlider,
  Field,
  FieldLabel,
} from "@momo/workbench/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, useId } from "react";
import { Copy, Trash2, SlidersHorizontal } from "lucide-react";
import type { PlayerInput, Project } from "./model";
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
  onReplaceContent,
  onFitRange,
  definitionControl,
}: {
  postProcessing?: ReactNode;
  sourceEditor?: ReactNode;
  definitionControl?: ReactNode;
  onReplaceContent?: () => void;
  onFitRange?: () => void;
  layer?: PlayerInput;
  project: Project;
  onChange: (key: LayerField, value: LayerValue) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEnter: () => void;
  onExpose: (key: Parameter) => void;
}) {
  const contentEditor = useRef<HTMLDivElement>(null);
  if (!layer)
    return (
      <div className="empty-state">
        <SlidersHorizontal size={26} />
        <p>{t("prop.empty")}</p>
      </div>
    );
  const effective =
    resolveControls(project).inputs.find((l) => l.id === layer.id) ?? layer;
  const range = (
    key: LayerField,
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
          value={layerValue(effective, key) as number}
          min={min}
          max={max}
          step={step}
          unit={unit}
          unbounded={key === "start" || key === "duration" || key === "sourceEnd"}
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
              layer.player.type === "sample"
                ? "editor.sample"
                : layer.player.type === "instrument"
                  ? "score.title"
                  : layer.player.type === "composition"
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
            disabled={project.inputs.length >= 16}
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
      <div className="replacement-entry">
        <span>{t(`content.${layer.player.type}`)}</span>
        <button
          className="secondary"
          onClick={() =>
            layer.player.type === "composition"
              ? onEnter()
              : contentEditor.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
          }
        >
          {t("content.edit")}
        </button>
        <button
          className="secondary"
          disabled={!onReplaceContent}
          onClick={onReplaceContent}
        >
          {t("replace.title")}
        </button>
      </div>
      {layer.player.type === "composition" && (
        <section className="property-section">
          <h3>{t("pro.controls")}</h3>
          <p className="field-help">
            {t(
              "composition.sourceInfo",
              layer.player.mix?.inputs.length ?? 0,
              layer.player.mix?.duration.toFixed(2) ?? "0",
            )}
          </p>
          {layer.player.mix?.controls
            ?.filter((c) => !c.hidden && c.mappings.length > 0)
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
                      effective.player.controlValues?.[c.id] ??
                      layer.player.mix?.controlValues?.[c.id] ??
                      c.defaultValue
                    }
                    min={c.min}
                    max={c.max}
                    step={(c.max - c.min) / 1000}
                    disabled={!!driver}
                    onChange={(v) =>
                      onChange("controlValues", {
                        ...layer.player.controlValues,
                        [c.id]: v,
                      })
                    }
                  />
                  {driver && <small>{t("pro.controlled", driver.name)}</small>}
                </div>
              );
            })}
        </section>
      )}
      <section className="property-section">
        <h3>{t("content.outer")}</h3>
        {range(
          "start",
          "prop.start",
          0,
          Math.max(project.duration, layer.start),
          0.01,
          "s",
        )}
        {range("gain", "prop.volume", 0, 1.5, 0.01)}
        {range("pan", "prop.pan", -1, 1, 0.01)}
      </section>
      <h3>{t("player.ownEffects")}</h3>
      {postProcessing}
      <div ref={contentEditor}>
        {definitionControl}
        {sourceEditor}
        <section className="property-section">
          <h3>{t("prop.source")}</h3>
          {layer.player.type === "synth" ? (
            <label className="text-field">
              <span>{t("prop.wave")}</span>
              <select
                value={layer.player.wave}
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
                {layer.player.type === "instrument"
                  ? t("score.editHint")
                  : layer.player.type === "composition"
                    ? layer.player.mix?.name
                    : project.assets[layer.player.assetId!]?.name}
              </div>
              {layer.player.type === "sample" &&
                project.assets[layer.player.assetId!]?.source &&
                (() => {
                  const source =
                    project.assets[layer.player.assetId!]!.source!;
                  return (
                    <p className="field-help">
                      {t(
                        source.quality === "preview"
                          ? "ai.samplePreview"
                          : "ai.sampleOriginal",
                      )}{" "}
                      · {source.license}
                      {" · "}
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("ai.sampleSource")}: {source.provider} /{" "}
                        {source.author}
                      </a>
                    </p>
                  );
                })()}
            </>
          )}
          {layer.player.type === "synth" && range("generatorDuration", "prop.duration", 0.01, Math.max(10, layer.player.duration), 0.01, "s")}
          {layer.player.type === "synth" && layer.player.wave !== "noise" && (
            <>
              {range("frequency", "prop.frequency", 20, 20000, 1, "Hz")}
              {range("endFrequency", "prop.endFrequency", 20, 20000, 1, "Hz")}
            </>
          )}
        </section>
        <section className="property-section">
          <h3>{t("prop.timing")}</h3>
          <p className="field-help">{t("player.outputDuration", playerDuration(layer.player).toFixed(3))}</p>
          {range("sourceStart", "player.readStart", 0, Math.max(0, layer.sourceEnd - 0.001), 0.001, "s")}
          {range("sourceEnd", "player.readEnd", layer.sourceStart + 0.001, Math.max(layer.sourceEnd, playerDuration(layer.player)), 0.001, "s")}
          {range("speed", "prop.rate", 0.1, 4, 0.01, "×")}
          <p className="field-help">{t("prop.speedHint")}</p>
          <label className="check-field"><input type="checkbox" checked={layer.loop} onChange={e => onChange("loop", e.target.checked)} />{t("player.loop")}</label>
          {range("duration", "player.playLength", 0.01, Math.max(project.duration, layer.duration), 0.01, "s")}
          <label className="check-field"><input type="checkbox" checked={layer.reverse} onChange={e => onChange("reverse", e.target.checked)} />{t("prop.reverse")}</label>
          {hasReadOverflow(layer) && <div role="status"><p className="field-help">{t("player.overflow")}</p><button onClick={onFitRange}>{t("player.fit")}</button></div>}
          {layer.player.type !== "composition" && <>
            {range("attack", "prop.attack", 0, Math.min(3, layer.player.duration), 0.001, "s")}
            {range("release", "prop.release", 0, Math.min(5, layer.player.duration), 0.001, "s")}
            {range("decay", "prop.decay", 0, 10, 0.1)}
          </>}
        </section>
        <section className="property-section">
          <h3>{t("prop.timbre")}</h3>
          {layer.player.type !== "composition" &&
            range("cutoff", "prop.cutoff", 30, 22000, 10, "Hz")}
          {layer.player.type !== "composition" &&
            range("drive", "prop.drive", 0, 10, 0.1)}
        </section>
      </div>
      <AutomationEditor
        key={`automation-${layer.id}`}
        layer={layer}
        project={project}
        onChange={(v) => onChange("automation", v)}
      />
    </div>
  );
}
