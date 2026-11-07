import { hasReadOverflow, playerDuration } from "./playerPlayback";
import {
  layerValue,
  withLayerValue,
  type LayerField,
  type LayerValue,
} from "./model";
import {
  Button, Popover, PopoverTrigger, PopoverContent, PopoverTitle,
  WorkbenchNumberInput,
  WorkbenchSlider,
  Field,
  FieldLabel,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@momo/workbench/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, useId } from "react";
import { Copy, Trash2, SlidersHorizontal, Ellipsis, X } from "lucide-react";
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
import { InspectorSection, useInspectorTab, type InspectorTab } from "./InspectorSection";
import "./inspector.css";
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
  layer, project, onChange, onDuplicate, onDelete, onEnter, onExpose,
  postProcessing, sourceEditor, onReplaceContent, onFitRange, definitionControl,
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [tab, setTab] = useInspectorTab();
  if (!layer) return (
    <div className="empty-state"><SlidersHorizontal size={26} /><p>{t("prop.empty")}</p></div>
  );
  const effective = resolveControls(project).inputs.find(l => l.id === layer.id) ?? layer;
  const type = layer.player.type;
  const sourceKind = type === "synth" ? `synth:${layer.player.synth?.algorithm ?? "oscillator-v1"}` : type;
  const range = (key: LayerField, label: string, min: number, max: number, step: number, unit = "") => {
    const driver = boundControl(project, layer.id, key);
    const curve = layer.automation?.[key as AutomationKey]?.length;
    return (
      <div key={key} className="exposable-field">
        <Range label={t(label)} value={layerValue(effective, key) as number}
          min={min} max={max} step={step} unit={unit}
          unbounded={key === "start" || key === "duration" || key === "sourceEnd"}
          disabled={!!driver || !!curve} onChange={v => onChange(key, v)} />
        {driver ? <small>{t("pro.controlled", driver.name)}</small>
          : curve ? <small>{t("pro.curveControlled")}</small>
          : key in PARAMS ? <button className="expose-button" title={t("pro.exposeHint")}
            onClick={() => onExpose(key as Parameter)}>{t("pro.expose")}</button> : null}
      </div>
    );
  };
  const sample = type === "sample" ? project.assets[layer.player.assetId!] : undefined;
  return (
    <div className="inspector-content sound-properties">
      <Tabs value={tab} onValueChange={value => setTab(value as InspectorTab)} className="inspector-tabs">
      <div className="inspector-heading">
      <header className="inspector-context">
        <div className="inspector-title">
          <div className="inspector-identity">
            <span className="eyebrow">{t(`inspector.source.${type}`)}</span>
            <CommitText className="inspector-name" label={t("prop.name")} value={layer.name}
              onCommit={v => onChange("name", v)} />
          </div>
          <div className="button-group">
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("inspector.moreActions")} title={t("inspector.moreActions")} />}><Ellipsis size={15} /></PopoverTrigger>
              <PopoverContent align="end" className="layer-tool-popover">
                <div className="layer-tool-heading"><PopoverTitle>{t("inspector.moreActions")}</PopoverTitle><Button variant="ghost" size="icon-sm" aria-label={t("action.close")} onClick={() => setMoreOpen(false)}><X size={14} /></Button></div>
                <Button variant="outline" disabled={!onReplaceContent} onClick={() => { setMoreOpen(false); onReplaceContent?.(); }}>{t("inspector.replaceLayer")}</Button>
              </PopoverContent>
            </Popover>
            <button className="icon-button" title={t("action.duplicate")} aria-label={t("action.duplicate")}
              disabled={project.inputs.length >= 16} onClick={onDuplicate}><Copy size={15} /></button>
            <button className="icon-button" title={t("action.delete")} aria-label={t("action.delete")}
              onClick={onDelete}><Trash2 size={15} /></button>
          </div>
        </div>
        <p className="inspector-path" title={project.name}>{t("inspector.scope", project.name)}</p>
      </header>
        <TabsList variant="line" aria-label={t("inspector.tabs")} className="inspector-tab-list">
          {(["sound", "playback", "mix", "automation"] as const).map(value => (
            <TabsTrigger key={value} value={value}>{t(`inspector.tab.${value}`)}</TabsTrigger>
          ))}
        </TabsList>
      </div>
        <TabsContent value="sound" keepMounted className="inspector-tab-content">
          <p className="inspector-tab-hint">{t("inspector.soundHint")}</p>
          <InspectorSection key={`source:${sourceKind}`} id={`source:${sourceKind}`}
            title={t(`inspector.source.${type}`)} scope={t("inspector.contentScope")}>
            {definitionControl}
            {type === "sample" && <>
              <p className="inspector-resource-name">{sample?.name}</p>
              {sample?.source && <p className="field-help">
                {t(sample.source.quality === "preview" ? "ai.samplePreview" : "ai.sampleOriginal")}
                {" · "}{sample.source.license}{" · "}
                <a href={sample.source.url} target="_blank" rel="noopener noreferrer">
                  {t("ai.sampleSource")}: {sample.source.provider} / {sample.source.author}
                </a>
              </p>}
            </>}
            {type === "composition" && <>
              <p className="inspector-resource-name">{layer.player.mix?.name}</p>
              <p className="field-help">{t("composition.sourceInfo", layer.player.mix?.inputs.length ?? 0,
                layer.player.mix?.duration.toFixed(2) ?? "0")}</p>
            </>}
            <div className="inspector-source-actions">
              {type === "composition" && <button className="secondary" onClick={onEnter}>{t("content.edit")}</button>}
            </div>
          </InspectorSection>
          {type === "synth" && <InspectorSection key={`synthesis:${sourceKind}`} id={`synthesis:${sourceKind}`}
            title={t("inspector.synthesis")}>
            {layer.player.synth?.algorithm !== "expression-v1" && <label className="text-field">
              <span>{t("prop.wave")}</span>
              <select value={layer.player.wave} onChange={e => onChange("wave", e.target.value)}>
                {["sine", "triangle", "saw", "square", "noise"].map(w => <option value={w} key={w}>{t(`wave.${w}`)}</option>)}
              </select>
            </label>}
            {layer.player.synth?.program?.parameters.map(p => <label className="text-field" key={p.variable}>
              <span>{p.name}</span>
              <WorkbenchNumberInput label={p.name} value={layer.player.synthValues?.[p.variable] ?? p.default}
                min={p.min} max={p.max} step={p.step}
                onValueCommit={value => onChange("synthValues", { ...layer.player.synthValues, [p.variable]: value })} />
            </label>)}
            {range("generatorDuration", "inspector.generatorDuration", 0.01, Math.max(10, layer.player.duration), 0.01, "s")}
            {(layer.player.synth?.algorithm === "expression-v1" || layer.player.wave !== "noise") && <>
              {range("frequency", "prop.frequency", 20, 20000, 1, "Hz")}
              {range("endFrequency", "prop.endFrequency", 20, 20000, 1, "Hz")}
            </>}
          </InspectorSection>}
          {type === "instrument" && sourceEditor && <InspectorSection id="notes" title={t("inspector.notes")}>
            {sourceEditor}
          </InspectorSection>}
          {type === "composition" && !!layer.player.mix?.controls?.some(c => !c.hidden && c.mappings.length) &&
            <InspectorSection id="composition-controls" title={t("inspector.compositionControls")}>
              {layer.player.mix.controls.filter(c => !c.hidden && c.mappings.length).map(c => {
                const driver = project.controls?.find(x => x.mappings.some(m =>
                  m.layerId === layer.id && m.parameter === "control" && m.controlId === c.id));
                return <div key={c.id}>
                  <Range label={c.name} value={effective.player.controlValues?.[c.id] ?? layer.player.mix?.controlValues?.[c.id] ?? c.defaultValue}
                    min={c.min} max={c.max} step={(c.max - c.min) / 1000} disabled={!!driver}
                    onChange={v => onChange("controlValues", { ...layer.player.controlValues, [c.id]: v })} />
                  {driver && <small>{t("pro.controlled", driver.name)}</small>}
                </div>;
              })}
            </InspectorSection>}
          <>
            <InspectorSection id="envelope" title={t("inspector.envelope")} defaultOpen={false}>
              {range("attack", "prop.attack", 0, Math.min(3, layer.player.duration), 0.001, "s")}
              {range("release", "prop.release", 0, Math.min(5, layer.player.duration), 0.001, "s")}
              {type !== "composition" && range("decay", "prop.decay", 0, 10, 0.1)}
            </InspectorSection>
            {type !== "composition" && <InspectorSection id="timbre" title={t("prop.timbre")} defaultOpen={false}>
              {range("cutoff", "prop.cutoff", 30, 22000, 10, "Hz")}
              {range("drive", "prop.drive", 0, 10, 0.1)}
            </InspectorSection>}
          </>
        </TabsContent>
        <TabsContent value="playback" keepMounted className="inspector-tab-content">
          <p className="inspector-tab-hint">{t("inspector.playbackHint")}</p>
          <InspectorSection id="placement" title={t("inspector.placement")} scope={t("inspector.placementScope")}>
            {range("start", "prop.start", 0, Math.max(project.duration, layer.start), 0.01, "s")}
            {range("duration", "player.playLength", 0.01, Math.max(project.duration, layer.duration), 0.01, "s")}
          </InspectorSection>
          <InspectorSection id="read-range" title={t("inspector.readRange")} scope={t("inspector.contentScope")}>
            <p className="field-help">{t("player.outputDuration", playerDuration(layer.player).toFixed(3))}</p>
            {range("sourceStart", "player.readStart", 0, Math.max(0, layer.sourceEnd - 0.001), 0.001, "s")}
            {range("sourceEnd", "player.readEnd", layer.sourceStart + 0.001, Math.max(layer.sourceEnd, playerDuration(layer.player)), 0.001, "s")}
            {hasReadOverflow(layer) && <div role="status"><p className="field-help">{t("player.overflow")}</p>
              <button onClick={onFitRange}>{t("player.fit")}</button></div>}
          </InspectorSection>
          <InspectorSection id="playback-mode" title={t("inspector.readMode")}>
            {range("speed", "prop.rate", 0.1, 4, 0.01, "×")}
            <p className="field-help">{t("prop.speedHint")}</p>
            <label className="check-field"><input type="checkbox" checked={layer.loop} onChange={e => onChange("loop", e.target.checked)} />{t("player.loop")}</label>
            <label className="check-field"><input type="checkbox" checked={layer.reverse} onChange={e => onChange("reverse", e.target.checked)} />{t("prop.reverse")}</label>
          </InspectorSection>
        </TabsContent>
        <TabsContent value="mix" keepMounted className="inspector-tab-content">
          <p className="inspector-tab-hint">{t("inspector.mixHint")}</p>
          <InspectorSection id="balance" title={t("inspector.balance")} scope={t("inspector.placementScope")}>
            {range("gain", "prop.volume", 0, 1.5, 0.01)}
            {range("pan", "prop.pan", -1, 1, 0.01)}
          </InspectorSection>
          <InspectorSection id="effects" title={t("inspector.effects")} scope={t("inspector.contentScope")}>
            <p className="field-help">{t("inspector.effectsHint")}</p>
            {postProcessing}
          </InspectorSection>
        </TabsContent>
        <TabsContent value="automation" keepMounted className="inspector-tab-content">
          <p className="inspector-tab-hint">{t("inspector.automationHint")}</p>
          <AutomationEditor key={`automation-${layer.id}-${type}`} embedded layer={layer} project={project}
            onChange={v => onChange("automation", v)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
