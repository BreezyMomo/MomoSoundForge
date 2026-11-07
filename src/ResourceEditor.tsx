import { packResource } from './resourcePackage';
import { useEffect, useId, useRef, useState } from 'react';
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogFooter, WorkbenchNumberInput } from '@momo/workbench/react';
import { t } from './i18n';
import { BASIC_SYNTH, SYNTH_RANGES, type SynthDefinition, type SynthParameter } from './synthesizers';
import { folderLibrary } from './folderLibrary';
import { createResourceDraft, changeResourceDraft, travelResourceDraft } from './resourceDraft';
import { parseResource, resourceProject, type SoundResource } from './soundResources';
import type { InstrumentDefinition } from './soundDefinitions';
import { uid, type Project, type SampleAsset, type RenderResult } from './model';
import { InstrumentEditor, type ChooseInstrumentSource } from './InstrumentEditor';
import { download, safeFilename } from './storage';
import { SOUND_CATEGORIES } from './libraryPreferences';
import type { RecordingDefinition } from './recordingDefinition';
import { pitchName } from './noteEditing';
import './resources.css';

export const resourceError = (e:unknown) => t(e instanceof Error && /^(instrument\.|resources\.|library\.|error\.|score\.|definition\.)/.test(e.message) ? e.message : 'resources.error');
export function NumberSetting({label,value,min=-1e6,max=1e6,step=1,onChange}: {label:string;value:number;min?:number;max?:number;step?:number;onChange:(n:number)=>void}) {
  return <label className="resource-field"><span>{label}</span><WorkbenchNumberInput label={label} value={value} min={min} max={max} step={step} onValueCommit={onChange}/></label>;
}
export function ResourceEditor({initial,owned=false,onClose,onUse,onOpen,onPreview,onStop,playback,binding=false,onChooseSource,onRender,onSaved,onPersisted,saveAndBindNote}: {
  initial:SoundResource;owned?:boolean;onClose:()=>void;onUse:(r:SoundResource)=>Promise<void>|void;onPreview:(p:Project,key:string)=>void;onStop:()=>void;playback:string|null;
  onImportAudio:(file:File)=>Promise<SampleAsset>;currentAssets?:Project['assets'];binding?:boolean;
  onOpen?:(r:SoundResource,owned:boolean,destination:number)=>void;
  onPersisted?:(r:SoundResource,destination:number)=>void;
  onChooseSource:ChooseInstrumentSource;onRender:(p:Project)=>Promise<RenderResult>;
  onSaved?:(r:SoundResource)=>Promise<void>|void;saveAndBindNote?:string;
}) {
  const [history,setHistory]=useState(()=>createResourceDraft(structuredClone(initial))), [closing,setClosing]=useState(false);
  const draft=history.present, dirty=draft!==history.baseline;
  const emptyInstrument=draft.kind==='instrument'&&!(draft.payload as InstrumentDefinition).instrument.regions.length;
  const editGroup=useRef<{element:Element|null;time:number}>({element:null,time:0});
  const [error,setError]=useState(''), [status,setStatus]=useState(''), [busy,setBusy]=useState(false), [target,setTarget]=useState(owned?{id:initial.id,version:initial.version}:undefined);
  const isOwn=!!target;
  const savedTarget=useRef(target);
  const alive=useRef(true);
  const previewKey='resource-editor-'+useId();
  const closeButton=useRef<HTMLButtonElement>(null), keepEditingButton=useRef<HTMLButtonElement>(null);
  const destination=useRef(folderLibrary.destination), newId=useRef(uid());
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;onStop();};},[]);
  const change=(r:SoundResource)=>{
    onStop();const element=document.activeElement;
    const text=element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement && element.type==='text';
    const coalesce=text&&element===editGroup.current.element&&Date.now()-editGroup.current.time<700;
    editGroup.current={element,time:Date.now()};
    setHistory(h=>changeResourceDraft(h,r,coalesce));setStatus('');setError('');
  };
  const travel=(redo=false)=>{if(busy||closing)return;onStop();editGroup.current={element:null,time:0};setHistory(h=>travelResourceDraft(h,redo));setStatus('');setError('');};
  const clean=()=>{
    const payload=structuredClone(draft.payload) as SynthDefinition | InstrumentDefinition | Record<string,unknown>;
    if(draft.kind==='synth') (payload as SynthDefinition).name=draft.name;
    if(draft.kind==='instrument') (payload as InstrumentDefinition).instrument.name=draft.name;
    if(draft.kind==='sound') (payload as Record<string,unknown>).name=draft.name;
    return parseResource({...draft,...(target??{id:newId.current,version:1}),payload});
  };
  const act=async(fn:()=>Promise<void>|void)=>{
    if(busy)return;setBusy(true);setError('');
    try{await fn();}catch(e){if(alive.current)setError(resourceError(e));}finally{if(alive.current)setBusy(false);}
  };
  const save=(copy=false)=>void act(async()=>{
    const r=clean();if(copy) {r.id=uid();r.version=1;}
    const saveDestination=copy||!target?folderLibrary.destination:destination.current;
    const entry=await folderLibrary.save(r,isOwn&&!copy?target.version:undefined,saveDestination);
    destination.current=saveDestination;newId.current=uid();
    if(alive.current){const identity={id:r.id,version:entry.version};setTarget(identity);savedTarget.current=identity;setHistory(h=>({...h,baseline:h.present}));editGroup.current={element:null,time:0};setStatus(t('resources.saved'));onPersisted?.({...r,version:entry.version},destination.current);}
    if(alive.current&&onSaved){try{await onSaved({...r,version:entry.version});}catch{throw Error('instrument.savedBindFailed');}}
  });
  const close=()=>{if(busy||closing)return;if(dirty){onStop();setClosing(true);}else onClose();};
  return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className={'resource-dialog'+(draft.kind==='instrument'?' instrument-resource-dialog':'')} showCloseButton={false} onKeyDown={e=>{
      // Portal events bubble through parents: only the nearest resource dialog owns this shortcut.
      const owner=(e.target as HTMLElement).closest('.resource-dialog');
      if(owner!==e.currentTarget&&!(owner===null&&(e.target as HTMLElement).closest('.instrument-note-popover')))return;
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&(e.key.toLowerCase()==='z'||e.key.toLowerCase()==='y')){
        if((e.target as HTMLElement).matches('input,textarea,[contenteditable="true"]'))return;
        e.preventDefault();e.stopPropagation();travel(e.shiftKey||e.key.toLowerCase()==='y');
      }
    }}>
    <header className="resource-header"><DialogTitle>{t('resources.edit')} · {t('resources.'+draft.kind)}</DialogTitle><Button ref={closeButton} variant="ghost" onClick={close} disabled={busy}>{t('resources.close')}</Button></header>
    <div className="button-group resource-history"><Button variant="outline" disabled={busy||!history.past.length} onClick={()=>travel()}>{t("resources.undo")}</Button><Button variant="outline" disabled={busy||!history.future.length} onClick={()=>travel(true)}>{t("resources.redo")}</Button></div>
    <div className="resource-editor-scroll"><fieldset disabled={busy} className="resource-editor-fields">
      <p>{t('resources.'+draft.kind+'Help')}</p>
      {draft.kind==='instrument'&&Object.values((draft.payload as InstrumentDefinition).assets).some(a=>a.reference)&&<p className="field-help">{t('resources.referencedInstrument')}</p>}
      <div className={draft.kind==='instrument'?'instrument-name-field':'resource-metadata'}>
        <label className="resource-field"><span>{t('resources.name')}</span><input maxLength={120} value={draft.name} onChange={e=>change({...draft,name:e.target.value})}/></label>
        {draft.kind!=='instrument'&&<label className="resource-field"><span>{t('resources.category')}</span><input maxLength={120} value={SOUND_CATEGORIES.includes(draft.category as never)?t('library.'+draft.category):draft.category} onChange={e=>change({...draft,category:e.target.value})}/></label>}
      </div>
      {draft.kind==='instrument'?<details className="instrument-metadata"><summary>{t('instrument.optionalMetadata')}</summary><div className="resource-metadata">
        <label className="resource-field"><span>{t('resources.category')}</span><input maxLength={120} value={SOUND_CATEGORIES.includes(draft.category as never)?t('library.'+draft.category):draft.category} onChange={e=>change({...draft,category:e.target.value})}/></label>
        <label className="resource-field"><span>{t('resources.description')}</span><textarea rows={2} maxLength={2000} value={draft.description} onChange={e=>change({...draft,description:e.target.value})}/></label>
      </div></details>:<label className="resource-field"><span>{t('resources.description')}</span><textarea rows={2} maxLength={2000} value={draft.description} onChange={e=>change({...draft,description:e.target.value})}/></label>}
      {draft.kind==='sound'&&savedTarget.current&&<label className="resource-field"><span>{t('resources.saveTarget')}</span><select value={isOwn?'original':'new'} onChange={e=>setTarget(e.target.value==='original'?savedTarget.current:undefined)}>
        <option value="original">{initial.name} · {t('resources.update')}</option><option value="new">{t('resources.newResource')}</option>
      </select></label>}
      {draft.kind==='synth'&&<SynthEditor synth={draft.payload as SynthDefinition} onChange={s=>change({...draft,payload:s})}/>}
      {draft.kind==='recording'&&<RecordingEditor recording={draft.payload as RecordingDefinition} onChange={r=>change({...draft,payload:r})}/>}
      {draft.kind==='instrument'&&<InstrumentEditor definition={draft.payload as InstrumentDefinition} onChange={d=>change({...draft,payload:d})}
        onChooseSource={onChooseSource} onRender={onRender} onStop={onStop} onError={error=>setError(resourceError(error))} onPreview={onPreview} playback={playback} previewKey={previewKey}/>}
      {draft.kind==='sound'&&onOpen&&!onSaved&&<p className="field-help">{t('resources.soundHelp')} <Button variant="outline" onClick={()=>void act(()=>onOpen(clean(),isOwn,destination.current))}>{t('resources.open')}</Button></p>}
    </fieldset></div>
    <footer className="resource-footer"><p className="field-help">{t('resources.snapshot')}</p>
      {emptyInstrument&&<p className="field-help" role="status">{t('instrument.emptyHelp')}</p>}
      {!folderLibrary.connected&&<p className="field-help">{t('resources.noFolder')} <Button variant="outline" onClick={()=>void act(async()=>{await folderLibrary.choose();destination.current=folderLibrary.destination;setTarget(undefined);savedTarget.current=undefined;})}>{t('resources.choose')}</Button></p>}
      <div className="button-group">
        {draft.kind!=='instrument'&&<><Button variant="outline" disabled={busy} onClick={()=>void act(()=>onPreview(resourceProject(clean(),true),previewKey))}>{t('resources.listen')}</Button>
        <Button variant="outline" onClick={onStop}>{t('resources.stop')}</Button></>}
        <Button variant={onSaved?'default':'outline'} disabled={busy||emptyInstrument||!folderLibrary.connected} onClick={()=>save()}>{onSaved?t('instrument.saveAndBind',saveAndBindNote):t(isOwn?'resources.update':'resources.save')}</Button>
        {!onSaved&&<Button variant="outline" disabled={busy||emptyInstrument||!folderLibrary.connected} onClick={()=>save(true)}>{t('resources.copy')}</Button>}
        <Button variant="outline" disabled={busy||emptyInstrument} onClick={()=>void act(async()=>{const r=clean();download(new Uint8Array(await packResource(r)).buffer,safeFilename(r.name)+'.sfresource','application/zip');})}>{t('resources.export')}</Button>
        <Button disabled={busy||emptyInstrument} onClick={()=>void act(()=>onUse(clean()))}>{onSaved?t('instrument.useDraft',saveAndBindNote):t(binding?'resources.bind':draft.kind==='synth'?'resources.useSynth':draft.kind==='instrument'?'resources.useInstrument':draft.kind==='recording'?'resources.useRecording':'resources.use')}</Button>
      </div>
      {(error||status||busy)&&<p role={error?'alert':'status'}>{error|| (busy?t('resources.working'):status)}</p>}
    </footer>
    <Dialog open={closing} onOpenChange={setClosing} disablePointerDismissal>
      <DialogContent className="resource-close-confirmation" role="alertdialog" showCloseButton={false} initialFocus={keepEditingButton} finalFocus={closeButton}>
        <DialogHeader>
          <DialogTitle>{t('resources.confirmDiscardTitle')}</DialogTitle>
          <DialogDescription>{t('resources.confirmDiscardDescription',draft.name)}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="resource-close-actions">
          <Button ref={keepEditingButton} variant="outline" onClick={()=>setClosing(false)}>{t('resources.keep')}</Button>
          <Button variant="destructive" onClick={onClose}>{t('resources.discard')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </DialogContent></Dialog>;
}
function RecordingEditor({recording:r,onChange}:{recording:RecordingDefinition;onChange:(r:RecordingDefinition)=>void}){
  return <>
    <label className="resource-field"><span>{t('resources.root')}</span><select value={r.rootMidi??''} onChange={e=>onChange({...r,rootMidi:e.target.value===''?null:Number(e.target.value)})}>
      <option value="">{t('resources.unpitched')}</option>{Array.from({length:128},(_,midi)=><option key={midi} value={midi}>{pitchName(midi)}</option>)}
    </select></label>
    <p className="field-help">{t('resources.rootHelp')}</p>
    <details><summary>{t('resources.recordingSettings')}</summary><div className="resource-metadata">
      <NumberSetting label={t('score.tuneCents')} value={r.tuneCents} min={-1200} max={1200} onChange={tuneCents=>onChange({...r,tuneCents})}/>
      <NumberSetting label={t('score.gainDb')} value={r.gainDb} min={-60} max={24} step={.1} onChange={gainDb=>onChange({...r,gainDb})}/>
    </div></details>
  </>;
}
function SynthEditor({synth:s,onChange}:{synth:SynthDefinition;onChange:(s:SynthDefinition)=>void}) {
  const parameter=(index:number,patch:Partial<SynthParameter>)=>onChange({...s,program:{...s.program!,parameters:s.program!.parameters.map((p,i)=>i===index?{...p,...patch}:p)}});
  return <>
    <label className="resource-field"><span>{t('resources.algorithm')}</span><select value={s.algorithm} onChange={e=>onChange({...s,algorithm:e.target.value as SynthDefinition['algorithm'],
      program:e.target.value==='expression-v1'?(s.program??{expression:'sin(2*pi*phase) * (1 + brightness * sin(4*pi*phase)) / (1 + brightness)',parameters:[{variable:'brightness',name:t('resources.brightness'),min:0,max:1,step:0.01,default:0.3}]}):undefined})}>
      <option value="oscillator-v1">{t('resources.oscillator')}</option><option value="expression-v1">{t('resources.expressionAlgorithm')}</option></select></label>
    {s.algorithm==='expression-v1'&&s.program&&<>
      <label className="resource-field"><span>{t('resources.expressionLabel')}</span><textarea className="resource-code" rows={4} maxLength={2048} value={s.program.expression} onChange={e=>onChange({...s,program:{...s.program!,expression:e.target.value}})}/></label>
      <p className="field-help">{t('resources.expressionHelp')}</p><h3>{t('resources.parameters')}</h3>
      {s.program.parameters.map((p,i)=><section className="resource-parameter" key={i}>
        <label className="resource-field"><span>{t('resources.variable')}</span><input maxLength={32} value={p.variable} onChange={e=>parameter(i,{variable:e.target.value})}/></label>
        <label className="resource-field"><span>{t('resources.label')}</span><input maxLength={120} value={p.name} onChange={e=>parameter(i,{name:e.target.value})}/></label>
        {(['min','max','step','default'] as const).map(k=><NumberSetting key={k} label={t('resources.'+k)} value={p[k]} step={0.01} onChange={v=>parameter(i,{[k]:v})}/>)}
        <Button variant="outline" onClick={()=>onChange({...s,program:{...s.program!,parameters:s.program!.parameters.filter((_,n)=>n!==i)}})}>{t('resources.remove')}</Button>
      </section>)}
      <Button variant="outline" disabled={s.program.parameters.length>=16} onClick={()=>onChange({...s,program:{...s.program!,parameters:[...s.program!.parameters,{variable:'p'+(s.program!.parameters.length+1),name:t('resources.label'),min:0,max:1,step:0.01,default:0.5}]}})}>{t('resources.addParameter')}</Button>
    </>}
    <details open={s.algorithm==='oscillator-v1'}><summary>{t('resources.defaults')}</summary><div className="resource-metadata">
      {s.algorithm==='oscillator-v1'&&<label className="resource-field"><span>{t('prop.wave')}</span><select value={s.defaults.wave} onChange={e=>onChange({...s,defaults:{...s.defaults,wave:e.target.value as SynthDefinition['defaults']['wave']}})}>{['sine','triangle','saw','square','noise'].map(w=><option key={w} value={w}>{t('wave.'+w)}</option>)}</select></label>}
      {Object.entries(SYNTH_RANGES).map(([key,[min,max]])=><NumberSetting key={key} label={t('prop.'+key)} value={s.defaults[key as keyof typeof SYNTH_RANGES]} min={min} max={max} step={key==='attack'||key==='release'?0.001:1} onChange={v=>onChange({...s,defaults:{...s.defaults,[key]:v}})}/>)}
    </div></details>
  </>;
}
