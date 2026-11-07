import { useEffect, useRef, useState } from "react";
import { Button, Popover, PopoverContent, PopoverTitle, PopoverTrigger, WorkbenchNumberInput } from "@momo/workbench/react";
import { MoreHorizontal, Play, Square, X } from "lucide-react";
import { t } from "./i18n";
import { uid, type Project, type RenderResult } from "./model";
import { parseDefinition, type InstrumentDefinition } from "./soundDefinitions";
import { resourceProject, type SoundResource } from "./soundResources";
import { selectRegion, type SampleRegion } from "./instruments";
import { articulationName } from "./NoteCoverageNotice";
import { pitchName } from "./noteEditing";
import { bindInstrumentNote, instrumentSource, noteMappings, playableNoteMappings } from "./instrumentMapping";
import { addInstrumentVariant, fillInstrumentRange, instrumentRange, missingVelocities, setInstrumentRange, setNotePlayback, type InstrumentVariant } from './instrumentEditing';
import { noteEndSeconds } from './instruments';
import "./instrument-editor.css";

export type ChooseInstrumentSource = (midi: number, onSelect: (resource: SoundResource) => Promise<void>, label?:string) => void;

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
  const [status, setStatus] = useState<{definition:InstrumentDefinition;text:string}|null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const latest = useRef(definition), alive = useRef(true);
  latest.current = definition;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const choose = (midi: number, settingId?:string, keepRange=false, label=pitchName(midi)) => {
    onStop(); setActive(midi); setStatus(null);
    const base = latest.current;
    onChooseSource(midi, async resource => {
      const prepared = await instrumentSource(resource, onRender, base.assets);
      if (!alive.current || latest.current !== base) throw Error("error.scopeChanged");
      const merged = { ...base, assets: { ...base.assets, ...prepared.assets } };
      const next = bindInstrumentNote(merged, midi, prepared.source, settingId, keepRange);
      onChange(next);
      const previous=base.instrument.regions.find(r=>r.id===settingId);
      const changed=next.instrument.regions.find(r=>(keepRange&&r.id===settingId)||
        r.keyLow===midi&&r.keyHigh===midi&&(!previous||r.articulation===previous.articulation&&
        r.velocityLow===previous.velocityLow&&r.velocityHigh===previous.velocityHigh&&r.roundRobin===previous.roundRobin));
      setSelected(changed?.id??noteMappings(next,midi)[0].id);
      setStatus({definition:next,text:t("instrument.bound", label, resource.name)});
    },label);
  };
  const addVariant = (midi: number, settingId: string, action: InstrumentVariant) => {
    const base = latest.current;
    const label = `${pitchName(midi)} · ${t(action.type === 'take' ? 'instrument.addTake' : action.type === 'strength' ? 'instrument.addStrength' : 'instrument.addStyle')}`;
    onStop(); setActive(midi); setStatus(null);
    onChooseSource(midi, async resource => {
      const prepared = await instrumentSource(resource, onRender, base.assets);
      if (!alive.current || latest.current !== base) throw Error('error.scopeChanged');
      const next = addInstrumentVariant({ ...base, assets: { ...base.assets, ...prepared.assets } }, midi, settingId, action, prepared.source);
      onChange(next);
      setStatus({ definition: next, text: t('instrument.bound', label, resource.name) });
    }, label);
  };
  const apply = (fn: () => InstrumentDefinition, message?: string) => {
    try { const next = fn(); onChange(next); setStatus(message ? { definition: next, text: message } : null); }
    catch (error) { onError(error); }
  };
  const preview = (midi: number, setting:SampleRegion) => {
    try {
      setActive(midi);
      const clean = parseDefinition(structuredClone(latest.current)) as InstrumentDefinition;
      const region = clean.instrument.regions.find(r=>r.id===setting.id);
      if (!region) return;
      const note = { id: `instrument-audition-${midi}`, instrumentId: clean.instrument.id, midi,
        velocity: Math.round((region.velocityLow + region.velocityHigh) / 2), articulation: region.articulation, start: 0, duration: 1 };
      if (!selectRegion(clean.instrument, note, 0, new Map())) throw Error("resources.unmapped");
      const project = resourceProject({ schema: "momo.sound-resource/v1", id: uid(), version: 1,
        name: clean.instrument.name, kind: "instrument", category: "", description: "", payload: clean, preview: [] }, true);
      project.inputs[0].player.score!.instruments[0].regions=[region];
      project.inputs[0].player.score!.notes = [note];
      // A long one-shot must not be cut to the generic two-second definition preview.
      const duration = Math.max(0.1, noteEndSeconds(note, region, clean.assets, 120));
      project.duration = duration;
      project.inputs[0].player.duration = duration;
      project.inputs[0].duration = duration;
      project.inputs[0].sourceEnd = duration;
      onPreview(project, `${previewKey}:note:${midi}:${setting.id}`);
    } catch (error) { onError(error); }
  };
  const update = (region: SampleRegion, patch: Partial<SampleRegion>) => {
    try {
      const range = definition.instrument.keyRange;
      onChange(parseDefinition(structuredClone({ ...definition, instrument: { ...definition.instrument,
        ...(range ? { keyRange: { low: Math.min(range.low, patch.keyLow ?? region.keyLow), high: Math.max(range.high, patch.keyHigh ?? region.keyHigh) } } : {}),
        regions: definition.instrument.regions.map(r => r.id === region.id ? { ...r, ...patch } : r) } })) as InstrumentDefinition);
    } catch (error) { onError(error); }
  };
  const remove = (id: string) => {
    const next={ ...definition, instrument: { ...definition.instrument, regions: definition.instrument.regions.filter(r => r.id !== id) } };
    onChange(next);
    setStatus({definition:next,text:t("instrument.removed")});
  };
  const region = definition.instrument.regions.find(r => r.id === selected) ?? definition.instrument.regions[0];
  const pitches = Array.from({ length: 128 }, (_, midi) => midi);
  const range = instrumentRange(definition);
  const inRange = pitches.filter(midi => midi >= range.low && midi <= range.high);
  const missing = inRange.filter(midi => !playableNoteMappings(definition, midi).length);
  const shown = onlyMissing ? missing : inRange;
  const pitchField = (key: "keyLow" | "keyHigh" | "rootMidi", label: string) => <label className="resource-field">
    <span>{label}</span><select value={region[key]} onChange={e => update(region, { [key]: Number(e.target.value) })}>
      {pitches.map(midi => <option key={midi} value={midi}>{pitchName(midi)}</option>)}
    </select></label>;
  return <section className="instrument-editor">
    <div className="instrument-range-fields">
      <label className="resource-field"><span>{t('instrument.rangeLow')}</span><select value={range.low} onChange={e => apply(() => setInstrumentRange(definition, Number(e.target.value), range.high))}>
        {pitches.map(midi => <option key={midi} value={midi}>{pitchName(midi)}</option>)}
      </select></label>
      <label className="resource-field"><span>{t('instrument.rangeHigh')}</span><select value={range.high} onChange={e => apply(() => setInstrumentRange(definition, range.low, Number(e.target.value)))}>
        {pitches.map(midi => <option key={midi} value={midi}>{pitchName(midi)}</option>)}
      </select></label>
      <p className="field-help">{t('instrument.rangeHelp')}</p>
    </div>
    <header className="instrument-list-heading">
      <h3>{t("instrument.noteSources")}</h3><span className="field-help" role="status">{t('instrument.coverage', inRange.length - missing.length, inRange.length)}</span>
      <label className="instrument-missing-filter"><input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)}/>{t('instrument.onlyMissing', missing.length)}</label>
    </header>
    <p className="field-help">{t("instrument.tableHelp")}</p>
    <div className="instrument-note-scroll" role="region" aria-label={t("instrument.noteSources")} tabIndex={0}>
      <table className="instrument-note-table">
        <thead><tr><th scope="col">{t("instrument.note")}</th><th scope="col">{t("resources.source")}</th></tr></thead>
        <tbody>{shown.flatMap(midi => {
          const mappings=playableNoteMappings(definition,midi);
          const rows: (SampleRegion|undefined)[]=mappings.length?mappings:[undefined];
          return rows.map((current,index)=>{
            const shared=current&&current.keyLow!==current.keyHigh;
            const label=current?variantLabel(current,mappings):'';
            const target=[pitchName(midi),label].filter(Boolean).join(' · ');
            const gaps=current&&mappings.find(r=>r.articulation===current.articulation)===current?missingVelocities(mappings,current.articulation):'';
            const previewing=!!current&&playback===`${previewKey}:note:${midi}:${current.id}`;
            const auditionLabel=t(previewing?'instrument.stopAudition':'instrument.audition',target);
            return <tr key={`${midi}:${current?.id??'empty'}`} className={active===midi?'is-active':undefined}>
              {index===0&&<th scope="rowgroup" rowSpan={rows.length}>{pitchName(midi)}</th>}
              <td><div className="instrument-note-source">
                <Button variant="ghost" className={'instrument-source-choice'+(!current?' is-empty':'')}
                  aria-label={t(current?'instrument.changeSource':'instrument.addForNote',target)} onClick={()=>choose(midi,current?.id,false,target)}>
                  <span className="instrument-variant-title">{label&&<strong>{label}</strong>}<span>{current?sourceName(definition,current):t('instrument.addSource')}</span></span>
                  {current&&!current.synth&&<small>{t(current.fixedPitch?'resources.unpitched':current.rootMidi===midi?'instrument.originalRecording':'instrument.transposedRecording',pitchName(current.rootMidi))}</small>}
                  {current&&<small>{t('instrument.strengthRange',current.velocityLow,current.velocityHigh)}{shared?' · '+t('instrument.sharedRange',rangeName(current)):''}</small>}
                  {current?.playback==='one-shot'&&<small>{t('instrument.oneShot')}</small>}
                  {gaps&&<small className="instrument-coverage-warning">{t('instrument.velocityGaps',gaps)}</small>}
                </Button>
                {current&&<Button variant="ghost" size="icon" aria-label={auditionLabel} title={auditionLabel} aria-pressed={previewing} onClick={()=>previewing?onStop():preview(midi,current)}>{previewing?<Square size={14}/>:<Play size={14}/>}</Button>}
                {current&&<NoteActions key={`${midi}:${current.id}`} midi={midi} region={current} range={range} target={target}
                  mappings={mappings} onAdd={action=>addVariant(midi,current.id,action)}
                  onPlayback={mode=>apply(()=>setNotePlayback(definition,midi,current.id,mode))}
                  onFill={(low,high)=>apply(()=>fillInstrumentRange(definition,midi,low,high),t('instrument.filled'))}
                  onRemove={!shared?()=>remove(current.id):undefined}/>}
              </div></td>
            </tr>;
          });
        })}{!shown.length&&<tr><td colSpan={2} className="instrument-list-empty">{t('instrument.noMissing')}</td></tr>}</tbody>
      </table>
    </div>
    {status?.definition===definition && <p role="status" className="field-help">{status.text}</p>}
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
      <Button variant="outline" onClick={()=>choose(region.keyLow,region.id,true,rangeName(region))}>{t("instrument.replaceSetting")}</Button>
      <Button variant="outline" onClick={() => remove(region.id)}>{t("instrument.removeSetting")}</Button>
    </details>}
  </section>;
}

function NoteActions({ midi, region, range, target, mappings, onAdd, onPlayback, onFill, onRemove }: {
  midi: number; region: SampleRegion; range: { low: number; high: number }; target: string; mappings: SampleRegion[];
  onAdd: (action: InstrumentVariant) => void; onPlayback: (mode: 'gate' | 'one-shot') => void;
  onFill: (low: number, high: number) => void; onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false), [style, setStyle] = useState('');
  const [split, setSplit] = useState(Math.floor((region.velocityLow + region.velocityHigh) / 2));
  const [low, setLow] = useState(range.low), [high, setHigh] = useState(range.high);
  const notes = Array.from({ length: range.high - range.low + 1 }, (_, i) => range.low + i);
  const action = (fn: () => void) => { setOpen(false); fn(); };
  const hasStyle = mappings.some(r => r.articulation === style.trim());
  return <Popover open={open} onOpenChange={value => {
    setOpen(value);
    if (value) { setSplit(Math.floor((region.velocityLow + region.velocityHigh) / 2)); setLow(range.low); setHigh(range.high); }
  }}>
    <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={t('instrument.noteActions', target)} title={t('instrument.noteActions', target)}/>}><MoreHorizontal size={16}/></PopoverTrigger>
    <PopoverContent align="end" className="instrument-note-popover">
      <div className="instrument-list-heading"><PopoverTitle>{target}</PopoverTitle><Button variant="ghost" size="icon" aria-label={t('action.close')} onClick={()=>setOpen(false)}><X size={14}/></Button></div>
      {!region.synth&&<label className="resource-field"><span>{t('instrument.playback')}</span><select aria-label={t('instrument.playback')} value={region.playback??'gate'} onChange={e=>action(()=>onPlayback(e.target.value as 'gate'|'one-shot'))}>
        <option value="gate">{t('instrument.gate')}</option><option value="one-shot">{t('instrument.oneShot')}</option>
      </select><small>{t(region.playback==='one-shot'?'instrument.oneShotHelp':'instrument.gateHelp')}</small></label>}
      <details><summary>{t('instrument.addStrength')}</summary>
        <p className="field-help">{t('instrument.strengthHelp')}</p>
        {region.velocityLow<region.velocityHigh?<>
          <NumberSetting label={t('instrument.splitAt')} value={split} min={region.velocityLow} max={region.velocityHigh-1} onChange={setSplit}/>
          <p className="field-help">{t('instrument.splitPreview',region.velocityLow,split,split+1,region.velocityHigh)}</p>
          <Button variant="outline" onClick={()=>action(()=>onAdd({type:'strength',split}))}>{t('instrument.chooseStronger')}</Button>
        </>:<p className="field-help">{t('instrument.cannotSplit')}</p>}
      </details>
      <details><summary>{t('instrument.addTake')}</summary><p className="field-help">{t('instrument.takeHelp')}</p>
        <Button variant="outline" onClick={()=>action(()=>onAdd({type:'take'}))}>{t('instrument.chooseTake')}</Button>
      </details>
      <details><summary>{t('instrument.addStyle')}</summary><p className="field-help">{t('instrument.styleHelp')}</p>
        <label className="resource-field"><span>{t('instrument.styleName')}</span><input maxLength={60} value={style} onChange={e=>setStyle(e.target.value)}/></label>
        {hasStyle&&<p className="field-help">{t('instrument.styleExists')}</p>}
        <Button variant="outline" disabled={!style.trim()||hasStyle} onClick={()=>action(()=>onAdd({type:'style',name:style.trim()}))}>{t('instrument.chooseStyle')}</Button>
      </details>
      <details><summary>{t('instrument.fillNotes')}</summary><p className="field-help">{t('instrument.fillHelp',pitchName(midi))}</p>
        <div className="instrument-range-fields">{(['low','high'] as const).map(key=><label className="resource-field" key={key}><span>{t(key==='low'?'instrument.fillLow':'instrument.fillHigh')}</span>
          <select value={key==='low'?low:high} onChange={e=>(key==='low'?setLow:setHigh)(Number(e.target.value))}>{notes.map(n=><option key={n} value={n}>{pitchName(n)}</option>)}</select>
        </label>)}</div>
        <p className="field-help">{t(mappings.some(r=>r.fixedPitch)?'instrument.fillUnpitched':'instrument.fillPitched')}</p>
        <Button variant="outline" disabled={high<low} onClick={()=>action(()=>onFill(low,high))}>{t('instrument.fillEmpty')}</Button>
      </details>
      {onRemove&&<Button variant="outline" onClick={()=>action(onRemove)}>{t('instrument.removeSingle',target)}</Button>}
    </PopoverContent>
  </Popover>;
}

function NumberSetting({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void;
}) {
  return <label className="resource-field"><span>{label}</span><WorkbenchNumberInput label={label} value={value} min={min} max={max} step={step} onValueCommit={onChange} /></label>;
}

function variantLabel(region:SampleRegion,mappings:SampleRegion[]){
  const styled=mappings.filter(r=>r.articulation===region.articulation);
  const bands=[...new Set(styled.map(r=>`${r.velocityLow}:${r.velocityHigh}`))];
  const band=bands.indexOf(`${region.velocityLow}:${region.velocityHigh}`);
  const strength=bands.length>1?t(band===0?'instrument.soft':band===bands.length-1?'instrument.hard':'instrument.medium',band+1):'';
  const takes=styled.filter(r=>r.velocityLow===region.velocityLow&&r.velocityHigh===region.velocityHigh);
  const style=region.articulation==='sustain'?'':articulationName(region.articulation);
  return [style,strength,takes.length>1?t('instrument.take',takes.findIndex(r=>r.id===region.id)+1):''].filter(Boolean).join(' · ');
}
