import { useEffect, useRef, useState } from "react";
import { Button, WorkbenchNumberInput } from "@momo/workbench/react";
import { Play, Square, X } from "lucide-react";
import { t } from "./i18n";
import { uid, type Project, type RenderResult } from "./model";
import { parseDefinition, type InstrumentDefinition } from "./soundDefinitions";
import { resourceProject, type SoundResource } from "./soundResources";
import { selectRegion, type SampleRegion } from "./instruments";
import { pitchName } from "./noteEditing";
import { bindInstrumentNote, instrumentSource, noteMappings } from "./instrumentMapping";
import "./instrument-editor.css";

export type ChooseInstrumentSource = (midi: number, onSelect: (resource: SoundResource) => Promise<void>) => void;

const sourceName = (d: InstrumentDefinition, r: SampleRegion) => r.synth?.name ?? d.assets[r.assetId]?.name ?? "";
const rangeName = (r: SampleRegion) => r.keyLow === r.keyHigh ? pitchName(r.keyLow) : `${pitchName(r.keyLow)}–${pitchName(r.keyHigh)}`;

export function InstrumentEditor({ definition, onChange, onChooseSource, onRender, onPreview, onStop, onError, playback, previewKey }: {
  definition: InstrumentDefinition;
  onChange: (d: InstrumentDefinition) => void;
  onChooseSource: ChooseInstrumentSource;
  onRender: (p: Project) => Promise<RenderResult>;
  onPreview: (p: Project, key: string) => void;
  playback: string | null;
  previewKey: string;
  onStop: () => void;
  onError: (error: unknown) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [selected, setSelected] = useState(definition.instrument.regions[0]?.id ?? "");
  const [status, setStatus] = useState("");
  const latest = useRef(definition), alive = useRef(true);
  latest.current = definition;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const choose = (midi: number) => {
    onStop(); setActive(midi); setStatus("");
    const base = latest.current;
    const region = noteMappings(base, midi)[0];
    onChooseSource(midi, async resource => {
      const prepared = await instrumentSource(resource, onRender);
      if (!alive.current || latest.current !== base) throw Error("error.scopeChanged");
      const next = bindInstrumentNote({ ...base, assets: { ...base.assets, ...prepared.assets } }, midi, prepared.source, region?.id);
      onChange(next);
      setSelected(noteMappings(next, midi)[0].id);
      setStatus(t("instrument.bound", pitchName(midi), resource.name));
    });
  };
  const preview = (midi: number) => {
    try {
      setActive(midi);
      const clean = parseDefinition(structuredClone(latest.current)) as InstrumentDefinition;
      const region = noteMappings(clean, midi)[0];
      if (!region) return;
      const note = { id: `instrument-audition-${midi}`, instrumentId: clean.instrument.id, midi,
        velocity: Math.round((region.velocityLow + region.velocityHigh) / 2), articulation: region.articulation, start: 0, duration: 1 };
      if (!selectRegion(clean.instrument, note, 0, new Map())) throw Error("resources.unmapped");
      const project = resourceProject({ schema: "momo.sound-resource/v1", id: uid(), version: 1,
        name: clean.instrument.name, kind: "instrument", category: "", description: "", payload: clean, preview: [] }, true);
      project.inputs[0].player.score!.notes = [note];
      onPreview(project, `${previewKey}:note:${midi}`);
    } catch (error) { onError(error); }
  };
  const update = (region: SampleRegion, patch: Partial<SampleRegion>) => {
    try {
      onChange(parseDefinition(structuredClone({ ...definition, instrument: { ...definition.instrument,
        regions: definition.instrument.regions.map(r => r.id === region.id ? { ...r, ...patch } : r) } })) as InstrumentDefinition);
    } catch (error) { onError(error); }
  };
  const remove = (id: string) => {
    onChange({ ...definition, instrument: { ...definition.instrument, regions: definition.instrument.regions.filter(r => r.id !== id) } });
    setStatus(t("instrument.removed"));
  };
  const region = definition.instrument.regions.find(r => r.id === selected) ?? definition.instrument.regions[0];
  const pitches = Array.from({ length: 128 }, (_, midi) => midi);
  const pitchField = (key: "keyLow" | "keyHigh" | "rootMidi", label: string) => <label className="resource-field">
    <span>{label}</span><select value={region[key]} onChange={e => update(region, { [key]: Number(e.target.value) })}>
      {pitches.map(midi => <option key={midi} value={midi}>{pitchName(midi)}</option>)}
    </select></label>;
  return <section className="instrument-editor">
    <header className="instrument-list-heading">
      <h3>{t("instrument.noteSources")}</h3>
    </header>
    <p className="field-help">{t("instrument.tableHelp")}</p>
    <div className="instrument-note-scroll" role="region" aria-label={t("instrument.noteSources")} tabIndex={0}>
      <table className="instrument-note-table">
        <thead><tr><th scope="col">{t("instrument.note")}</th><th scope="col">{t("resources.source")}</th></tr></thead>
        <tbody>{pitches.map(midi => {
          const mappings = noteMappings(definition, midi), current = mappings[0];
          const shared = current && current.keyLow !== current.keyHigh;
          const variants = current ? mappings.filter(r => r.keyLow === current.keyLow && r.keyHigh === current.keyHigh) : [];
          const previewing = playback === `${previewKey}:note:${midi}`;
          const auditionLabel = t(previewing ? "instrument.stopAudition" : "instrument.audition", pitchName(midi));
          return <tr key={midi} className={active === midi ? "is-active" : undefined}>
            <th scope="row">{pitchName(midi)}</th>
            <td><div className="instrument-note-source">
              <Button variant="ghost" className={"instrument-source-choice" + (!current ? " is-empty" : "")}
                aria-label={t(current ? "instrument.changeSource" : "instrument.addForNote", pitchName(midi))} onClick={() => choose(midi)}>
                <span>{current ? sourceName(definition, current) : t("instrument.addSource")}</span>
                {current?.rootMidi!==undefined && !current.synth && <small>{t(current.fixedPitch?'resources.unpitched':current.rootMidi===midi?'instrument.originalRecording':'instrument.transposedRecording',pitchName(current.rootMidi))}</small>}
                {shared && <small>{t("instrument.sharedRange", rangeName(current))}</small>}
                {variants.length > 1 && <small>{t("instrument.variantCount", variants.length)}</small>}
              </Button>
              {current && <Button variant="ghost" size="icon" aria-label={auditionLabel} title={auditionLabel} aria-pressed={previewing}
                onClick={() => previewing ? onStop() : preview(midi)}>{previewing ? <Square size={14} /> : <Play size={14} />}</Button>}
              {current && !shared && <Button variant="ghost" size="icon" aria-label={t("instrument.removeSingle", pitchName(midi))} title={t("instrument.removeSingle", pitchName(midi))} onClick={() => remove(current.id)}><X size={13} /></Button>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {status && <p role="status" className="field-help">{status}</p>}
    {region && <details className="instrument-advanced">
      <summary>{t("instrument.moreSettings")}</summary>
      <p className="field-help">{t("instrument.advancedHelp")}</p>
      <label className="resource-field"><span>{t("instrument.setting")}</span><select value={region.id} onChange={e => setSelected(e.target.value)}>
        {definition.instrument.regions.map(r => <option key={r.id} value={r.id}>{rangeName(r)} · {sourceName(definition, r)} · {r.articulation} · {r.velocityLow}–{r.velocityHigh}</option>)}
      </select></label>
      <div className="resource-metadata">
        {pitchField("keyLow", t("resources.low"))}{pitchField("keyHigh", t("resources.high"))}
        {!region.synth && pitchField("rootMidi", t("resources.root"))}
        <NumberSetting label={t("resources.release")} value={region.releaseSeconds} min={0.005} max={3} step={0.01} onChange={value => update(region, { releaseSeconds: value })} />
        <NumberSetting label={t("resources.velocityLow")} value={region.velocityLow} min={1} max={127} onChange={value => update(region, { velocityLow: value })} />
        <NumberSetting label={t("resources.velocityHigh")} value={region.velocityHigh} min={1} max={127} onChange={value => update(region, { velocityHigh: value })} />
        <label className="resource-field"><span>{t("resources.articulation")}</span><input value={region.articulation} maxLength={60} onChange={e => update(region, { articulation: e.target.value })} /></label>
        <NumberSetting label={t("score.roundRobin")} value={region.roundRobin} min={0} max={127} onChange={value => update(region, { roundRobin: value })} />
        <NumberSetting label={t("score.tuneCents")} value={region.tuneCents} min={-1200} max={1200} onChange={value => update(region, { tuneCents: value })} />
        <NumberSetting label={t("score.gainDb")} value={region.gainDb} min={-60} max={24} step={0.1} onChange={value => update(region, { gainDb: value })} />
        {region.synth?.program?.parameters.map(p => <NumberSetting key={p.variable} label={p.name} value={region.synthValues?.[p.variable] ?? p.default} min={p.min} max={p.max} step={p.step} onChange={value => update(region, { synthValues: { ...region.synthValues, [p.variable]: value } })} />)}
      </div>
      <Button variant="outline" onClick={() => remove(region.id)}>{t("instrument.removeSetting")}</Button>
    </details>}
  </section>;
}

function NumberSetting({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void;
}) {
  return <label className="resource-field"><span>{label}</span><WorkbenchNumberInput label={label} value={value} min={min} max={max} step={step} onValueCommit={onChange} /></label>;
}
