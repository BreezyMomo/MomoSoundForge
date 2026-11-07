import type { RemoteLoadOptions, RemoteLoadProgress } from './remoteLibrary';
import { packResource, readResourceFile } from './resourcePackage';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, DialogContent, DialogTitle } from '@momo/workbench/react';
import { BASIC_SYNTH } from './synthesizers';
import { t, language } from './i18n';
import { remoteLibraries } from './remoteSubscriptions';
import { RemoteLibrarySettings } from './RemoteLibrarySettings';
import { folderLibrary, libraryReady, onLibraryChange, type ResourceEntry } from './folderLibrary';
import { importResource, resourceFromDefinition, resourceFromProject, resourceFromRecording, resourceProject, RESOURCE_BYTES, type SoundResource, type ResourceKind } from './soundResources';
import { resourceOrigin, type ResourceOrigin } from './resourceOrigin';
import { ResourceEditor, resourceError } from './ResourceEditor';
import { PRESETS, fromPreset } from './presets';
import { makeProject, uid, encodeSamples, type Project, type RenderResult, type SampleAsset } from './model';
import { parseDefinition, type SoundDefinition, type InstrumentDefinition } from './soundDefinitions';
import { download, safeFilename } from './storage';
import { Waveform } from './Waveform';
import { SOUND_CATEGORIES, rememberSound } from './libraryPreferences';
import { useResourcePreferences } from './useResourcePreferences';
import { pitchName } from './noteEditing';
import { type RecordingSummary } from './recordingSources';
import './resources.css';

type Props = {
  project: Project; ready: boolean; playback: string|null; saveHost?:HTMLElement|null;
  currentAssets?: Project['assets'];
  onInsert:(p:Project)=>void;onOpen:(p:Project,origin?:ResourceOrigin)=>void;
  origin?:ResourceOrigin;onProjectSaved?:(p:Project,origin:ResourceOrigin)=>void;onPreview:(p:Project,key:string)=>void;onStop:()=>void;
  onRender:(p:Project)=>Promise<RenderResult>;onImportAudio:(file:File)=>Promise<Project>;
  selectionOnly?: boolean;
  bindingType?: 'synth'|'instrument'; onBind?:(d:SoundDefinition)=>void; stale?:boolean;
  initialDefinition?:SoundDefinition;
  sourceSelection?: { note:string; onSelect:(resource:SoundResource)=>Promise<void>|void };
};
const fresh=(kind:'synth'|'instrument'):SoundResource => kind==='synth'?resourceFromDefinition({...structuredClone(BASIC_SYNTH),id:uid(),name:t('definition.untitledSynth')}):{
  schema:'momo.sound-resource/v1',id:uid(),version:1,name:t('definition.untitledInstrument'),kind:'instrument',category:'uncategorized',description:'',preview:[],
  payload:{schema:'momo.instrument/v1',instrument:{id:uid(),name:t('definition.untitledInstrument'),keyRange:{low:60,high:72},regions:[]},assets:{}}
};
type LibraryKind=ResourceKind|'source';
type Card = {key:string;relatedKeys?:string[];name:string;kind:ResourceKind;source:'builtin'|'local'|'remote';sourceLabel?:string;contentId?:string;category:string;description:string;preview:number[];load:(complete?:boolean,options?:RemoteLoadOptions)=>Promise<SoundResource>;entry?:ResourceEntry;recording?:RecordingSummary};
const filterKeys=(card:Card)=>[card.key,...card.relatedKeys??[]];
export function SoundLibrary(props:Props) {
  const [manage,setManage]=useState(false);
  useEffect(()=>{const open=()=>setManage(true);window.addEventListener('soundforge-open-resources',open);return()=>window.removeEventListener('soundforge-open-resources',open);},[]);
  return <><ResourceBrowser {...props} onManage={()=>setManage(true)}/>{manage&&<ResourceManager {...props} onClose={()=>setManage(false)}/>}</>;
}
export function ResourceManager({onClose,...props}:Props&{onClose:()=>void}) {
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="resource-dialog resource-manager" showCloseButton={false}>
    <header className="resource-header"><DialogTitle>{props.sourceSelection?t('instrument.chooseFor',props.sourceSelection.note):t(props.bindingType==='instrument'?'add.chooseVoice':props.bindingType==='synth'?'inspector.choose.synth':props.selectionOnly?'add.library':'resources.title')}</DialogTitle><Button variant="ghost" onClick={onClose}>{t('resources.close')}</Button></header>
    <ResourceBrowser {...props} sourceSelection={props.sourceSelection?{...props.sourceSelection,onSelect:async r=>{await props.sourceSelection!.onSelect(r);onClose();}}:undefined} saveHost={null} expanded={!props.selectionOnly} onOpen={(p,origin)=>{props.onOpen(p,origin);onClose();}} onInsert={p=>{props.onInsert(p);onClose();}} onBind={props.onBind?d=>{props.onBind!(d);onClose();}:undefined}/>
  </DialogContent></Dialog>;
}
function ResourceBrowser(props:Props&{expanded?:boolean;onManage?:()=>void}) {
  const {project,ready,playback,onInsert,onOpen,onPreview,onStop,onImportAudio,onRender,bindingType,onBind,stale,sourceSelection}=props;
  const [entries,setEntries]=useState<ResourceEntry[]>([]),[query,setQuery]=useState(''),[kind,setKind]=useState<LibraryKind|''>(bindingType??'source'),[source,setSource]=useState('');
  const [error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const [loadProgress,setLoadProgress]=useState<(RemoteLoadProgress&{name:string})|null>(null);
  const loadController=useRef<AbortController|null>(null);
  const [editor,setEditor]=useState<{resource:SoundResource;owned:boolean;base:Project;current?:boolean}|null>(null),[deleting,setDeleting]=useState<(ResourceEntry&{destination:number})|null>(null);
  const [noteSource,setNoteSource]=useState<{midi:number;label?:string;onSelect:(r:SoundResource)=>Promise<void>}|null>(null);
  const [preferences,setPreferences]=useResourcePreferences();
  const [displayLimit,setDisplayLimit]=useState(48);
  const audioMode=useRef<'recording'|'sound'>('recording');
  const file=useRef<HTMLInputElement>(null),audio=useRef<HTMLInputElement>(null),latest=useRef(project),alive=useRef(true);
  latest.current=project;
  const refresh=async()=>{try{await libraryReady;const list=await folderLibrary.list();if(alive.current){setEntries(list);setError('');}}catch(e){if(alive.current)setError(resourceError(e));}};
  useEffect(()=>{alive.current=true;void refresh();
    const off=onLibraryChange(()=>void refresh());return()=>{alive.current=false;loadController.current?.abort();off();};},[]);
  const run=async(fn:()=>Promise<void>|void)=>{if(busy)return;setBusy(true);setError('');setStatus('');try{await fn();}catch(e){if((e as DOMException).name!=='AbortError'&&alive.current)setError(resourceError(e));}finally{if(alive.current){setBusy(false);setLoadProgress(null);}}};
  const remember=(key:string)=>setPreferences(p=>({...p,recent:rememberSound(p.recent,key)}));
  const openEditor=(resource:SoundResource,owned=false,base=latest.current,current=false)=>setEditor({resource,owned,base,current});
  const useResource=async(r:SoundResource,base:Project=latest.current)=>{
    if(stale||base!==latest.current)throw Error('error.scopeChanged');
    onStop();if(sourceSelection){if(r.kind!=='recording'&&r.kind!=='synth')throw Error('instrument.invalidSource');await sourceSelection.onSelect(r);}
    else if(bindingType){if(r.kind!==bindingType||!onBind)throw Error('definition.typeMismatch');onBind(parseDefinition(r.payload));}
    else onInsert(resourceProject(r));setEditor(null);
  };
  const builtins:Card[]=[{
    key:'builtin-synth-oscillator',name:t('resources.oscillator'),kind:'synth',source:'builtin',category:'uncategorized',description:t('resources.synthHelp'),preview:[],
    load:async()=>resourceFromDefinition({...structuredClone(BASIC_SYNTH),name:t('resources.oscillator')},'builtin-synth-oscillator')
  },...PRESETS.map<Card>(p=>({key:'preset-'+p.id,name:t('preset.'+p.id),kind:'sound',source:'builtin',category:p.category,description:t('preset.'+p.id+'.desc'),preview:[],
    load:async()=>resourceFromProject(fromPreset(p.id,t('preset.'+p.id),k=>t('layer.'+k)),[],'builtin-preset-'+p.id)}))];
  const subscriptions=useSyncExternalStore(remoteLibraries.subscribe,remoteLibraries.snapshot);
  useEffect(()=>{remoteLibraries.start();},[]);
  useEffect(()=>{if(source==='local'&&!folderLibrary.connected)setSource('');},[source,entries]);
  useEffect(()=>{if(source.startsWith('remote:')&&!subscriptions.some(s=>'remote:'+s.id===source))setSource('');},[source,subscriptions]);
  const remoteCards=new Map<string,Card>();
  for(const subscription of subscriptions){
    if(!subscription.enabled||!subscription.index||source.startsWith('remote:')&&source!==`remote:${subscription.id}`)continue;
    const loader=remoteLibraries.loader(subscription);
    for(const entry of subscription.index.entries){
      const existing=remoteCards.get(entry.contentId);
      if(existing){existing.sourceLabel+=' · '+subscription.name;continue;}
      const name=entry.names?.[language.interfaceLanguage().startsWith('zh')?'zh':'en']??entry.name;
      remoteCards.set(entry.contentId,{key:'remote-'+entry.contentId,contentId:entry.contentId,name,kind:entry.kind,source:'remote',sourceLabel:subscription.name,category:entry.category,description:entry.description,preview:entry.preview,
        load:async(complete=true,options)=>({...await loader(entry,complete,options),name,id:entry.contentId})});
    }
  }
  const loadCard=async(c:Card,complete=true)=>{
    if(c.source!=='remote')return c.load(complete);
    const controller=new AbortController();loadController.current=controller;
    try{return await c.load(complete,{signal:controller.signal,onProgress:p=>{if(alive.current)setLoadProgress({...p,name:c.name});}});}
    finally{if(loadController.current===controller)loadController.current=null;if(alive.current)setLoadProgress(null);}
  };
  const locals=entries.map<Card>(entry=>({key:'local-'+entry.id,name:entry.name,kind:entry.kind,source:'local',sourceLabel:folderLibrary.name,category:entry.category,description:entry.description,preview:entry.preview,entry,load:()=>folderLibrary.load(entry.id)}));
  const cards=[...builtins,...remoteCards.values(),...locals];
  const [category,setCategory]=useState('');
  useEffect(()=>setDisplayLimit(48),[query,kind,source,category,preferences.filter]);
  const matches=(c:Card)=>(!sourceSelection||c.kind==='recording'||c.kind==='synth')&&(!bindingType||c.kind===bindingType)&&(!source||c.source===source||source.startsWith('remote:')&&c.source==='remote')&&(!category||c.category===category)&&
    `${c.name} ${c.description} ${c.category} ${SOUND_CATEGORIES.includes(c.category as never)?t('library.'+c.category):''}`.toLowerCase().includes(query.trim().toLowerCase())&&
    (preferences.filter==='all'||filterKeys(c).some(key=>(preferences.filter==='favorites'?preferences.favorites:preferences.recent).includes(key)));
  const matchingInstruments=!sourceSelection&&!bindingType&&query.trim()&&kind!==''&&kind!=='instrument'?cards.filter(c=>c.kind==='instrument'&&matches(c)).length:0;
  const visible=cards.filter(c=>matches(c)&&(!kind||c.kind===kind||kind==='source'&&(c.kind==='recording'||c.kind==='synth')))
    .sort((a,b)=>preferences.filter==='recent'?Math.min(...filterKeys(a).map(k=>preferences.recent.indexOf(k)).filter(i=>i>=0))-Math.min(...filterKeys(b).map(k=>preferences.recent.indexOf(k)).filter(i=>i>=0)):0);
  const fileImport=async(f:File)=>{const r=await readResourceFile(f);if(sourceSelection&&r.kind!=='recording'&&r.kind!=='synth')throw Error('instrument.invalidSource');openEditor(r);};
  const current=()=>void run(async()=>{const snapshot=latest.current,audio=await onRender(snapshot);const preview=Array.from({length:160},(_,i)=>{let peak=0;for(let n=Math.floor(i*audio.left.length/160);n<Math.floor((i+1)*audio.left.length/160);n++)if(Math.abs(audio.left[n])>Math.abs(peak))peak=audio.left[n];return Math.max(-1,Math.min(1,peak));});const origin=props.origin?.destination===folderLibrary.destination&&folderLibrary.connected?props.origin:undefined;const resource=resourceFromProject(snapshot,preview);openEditor(origin?{...resource,id:origin.id,version:origin.version,category:origin.category,description:origin.description}:resource,!!origin,snapshot,true);});
  return <div className={'resource-browser '+(props.expanded?'resource-browser-expanded':'')}>
    {props.saveHost&&createPortal(<Button variant="outline" disabled={!ready||busy} onClick={current}>{t('resources.current')}</Button>,props.saveHost)}
    <div className="resource-browser-top"><label className="resource-field"><input aria-label={t('resources.search')} placeholder={t('resources.search')} value={query} onChange={e=>setQuery(e.target.value)}/></label>
      {props.onManage&&<Button variant="outline" aria-haspopup="dialog" disabled={!ready||busy} onClick={()=>{onStop();props.onManage!();}}>{t('resources.manage')}</Button>}</div>
    <div className="resource-filters">
      {!bindingType&&<select aria-label={t('resources.all')} disabled={!!bindingType} value={kind} onChange={e=>setKind(e.target.value as LibraryKind|'')}><option value="">{t('resources.all')}</option>{!bindingType&&<option value="source">{t('resources.soundSources')}</option>}{(['recording','synth','instrument','sound']as const).filter(k=>(!sourceSelection||k==='recording'||k==='synth')&&(!bindingType||k===bindingType)).map(k=><option key={k} value={k}>{t('resources.'+k)}</option>)}</select>}
      <select aria-label={t('resources.sources')} value={source} onChange={e=>setSource(e.target.value)}><option value="">{t('resources.sources')}</option><option value="builtin">{t('resources.builtin')}</option>{folderLibrary.connected&&<option value="local">{folderLibrary.name}</option>}{subscriptions.map(s=><option key={s.id} value={"remote:"+s.id}>{s.name}</option>)}</select>
      <select aria-label={t('resources.category')} value={category} onChange={e=>setCategory(e.target.value)}><option value="">{t('library.all')}</option>{[...new Set(cards.map(c=>c.category))].sort().map(c=><option key={c} value={c}>{SOUND_CATEGORIES.includes(c as never)?t('library.'+c):c}</option>)}</select>
    </div>
    <div className="button-group resource-quick-filters">{(['all','favorites','recent']as const).map(filter=><Button variant="outline" key={filter} aria-pressed={preferences.filter===filter} onClick={()=>setPreferences(p=>({...p,filter}))}>{t('library.'+filter)}</Button>)}</div>
    <details className="resource-display"><summary>{t('library.display')}</summary><div className="button-group">{(['grid','list']as const).map(view=><Button variant="outline" key={view} aria-pressed={preferences.view===view} onClick={()=>setPreferences(p=>({...p,view}))}>{t('library.'+view)}</Button>)}</div></details>
    <p className="resource-count" role="status">{t('resources.visibleCount',visible.length)} · {t('resources.recordingCount',visible.filter(c=>c.kind==='recording').length)}</p>
    {!!matchingInstruments&&<p className="field-help resource-search-hint">{t('resources.matchingInstruments',matchingInstruments)} <Button variant="outline" onClick={()=>setKind('instrument')}>{t('resources.viewInstruments')}</Button></p>}
    {subscriptions.some(s=>s.enabled&&s.loading)&&<p role="status" className="field-help">{t('remote.loading')}</p>}
    {subscriptions.some(s=>s.enabled&&s.error)&&<p role="alert" className="field-help">{t('remote.problem')}</p>}
    {props.expanded&&<RemoteLibrarySettings/>}
    {bindingType&&<p className="field-help">{t(bindingType==='instrument'?'add.voiceHint':'resources.bindingHint')}</p>}
    {stale&&<p className="field-help" role="alert">{t('error.scopeChanged')}</p>}
    {props.initialDefinition&&<Button variant="outline" disabled={busy} onClick={()=>openEditor(resourceFromDefinition(props.initialDefinition!))}>{t('resources.fromCurrent')}</Button>}
    {sourceSelection&&<p className="field-help">{t('instrument.libraryHelp',sourceSelection.note)}</p>}
    {props.expanded&&<details className="resource-management" open={sourceSelection?undefined:true}>
      <summary>{t(sourceSelection?'instrument.addSource':'resources.manage')}{folderLibrary.connected?' · '+folderLibrary.name:''}</summary>
      <p className="field-help">{folderLibrary.connected?t('resources.folder')+' · '+folderLibrary.name:t('resources.noFolder')}</p>
      <div className="button-group"><Button variant="outline" disabled={busy} onClick={()=>void run(()=>folderLibrary.choose())}>{t(folderLibrary.connected?'resources.switch':'resources.choose')}</Button>
        {folderLibrary.connected&&<><Button variant="outline" disabled={busy} onClick={()=>void run(()=>folderLibrary.authorize())}>{t('resources.authorize')}</Button><Button variant="outline" disabled={busy} onClick={()=>void run(()=>folderLibrary.disconnect())}>{t('resources.disconnect')}</Button></>}</div>
      <h3>{t('resources.create')}</h3><div className="button-group">
        {(['synth','instrument']as const).filter(k=>(!bindingType||k===bindingType)&&(!sourceSelection||k!=='instrument')).map(k=><Button variant="outline" key={k} disabled={busy} onClick={()=>openEditor(fresh(k))}>{t('definition.'+(k==='synth'?'newSynth':'newInstrument'))}</Button>)}
        {!bindingType&&<><Button variant="outline" disabled={busy||!ready} onClick={()=>{audioMode.current='recording';audio.current?.click();}}>{t('resources.addRecording')}</Button>{!sourceSelection&&<Button variant="outline" disabled={busy||!ready} onClick={()=>onOpen(makeProject(t('resources.sound')))}>{t('resources.newMusic')}</Button>}{!sourceSelection&&<Button variant="outline" disabled={busy||!ready} onClick={()=>{audioMode.current='sound';audio.current?.click();}}>{t('resources.importAudio')}</Button>}{!sourceSelection&&<Button variant="outline" disabled={busy||!ready} onClick={current}>{t('resources.current')}</Button>}</>}
        <Button variant="outline" disabled={busy} onClick={()=>file.current?.click()}>{t('resources.import')}</Button>
      </div><p className="field-help">{t('resources.importHint')}</p>
    </details>}
    {loadProgress&&<section className="resource-load-progress" aria-label={t('remote.preparing',loadProgress.name)}>
      <strong>{t('remote.preparing',loadProgress.name)}</strong>
      <p role="status">{loadProgress.phase==='definition'?t('remote.readDefinition'):t('remote.audioProgress',loadProgress.completed,loadProgress.total)}</p>
      <progress aria-label={loadProgress.phase==='definition'?t('remote.readDefinition'):t('remote.audioProgress',loadProgress.completed,loadProgress.total)} max={loadProgress.total||1} value={loadProgress.phase==='audio'?loadProgress.completed:undefined}/>
      <small>{t('remote.downloadBytes',(loadProgress.downloadedBytes/1048576).toFixed(1))}</small>
      <Button variant="outline" onClick={()=>{loadController.current?.abort();setLoadProgress(null);setStatus(t('remote.cancelled'));}}>{t('resources.cancel')}</Button>
    </section>}
    {!loadProgress&&(error||status||busy)&&<p role={error?'alert':'status'} className="resource-status">{error||(busy?t('resources.working'):status)}</p>}
    <div className={'resource-cards resource-view-'+preferences.view}>{visible.slice(0,displayLimit).map(c=><article key={c.key} className="resource-card" aria-label={c.name} data-recording-id={c.recording?.id??(c.kind==='recording'?c.key:undefined)}>
      <header><strong>{c.name}</strong><button aria-label={t(preferences.favorites.includes(c.key)?'library.unfavorite':'library.favorite',c.name)} aria-pressed={preferences.favorites.includes(c.key)} onClick={()=>setPreferences(p=>({...p,favorites:p.favorites.includes(c.key)?p.favorites.filter(k=>k!==(c.key)):[...p.favorites,c.key]}))}>{preferences.favorites.includes(c.key)?'★':'☆'}</button></header>
      <div className="resource-badges"><span>{t('resources.'+c.kind)}</span><span>{c.sourceLabel??t('resources.'+c.source)}</span>{c.entry&&<span>{t('resources.version',c.entry.version)}</span>}</div>
      {c.preview.length>0&&<Waveform data={Float32Array.from(c.preview)} label={c.name}/>}
      <p className="field-help">{c.description}</p><div className="button-group">
        <Button variant="outline" disabled={busy||!ready} aria-pressed={playback===c.key} onClick={()=>void run(async()=>{if(playback===c.key){onStop();return;}remember(c.key);const r=await loadCard(c,false);onPreview(resourceProject(r,true),c.key);})}>{t(playback===c.key?'resources.stop':'resources.listen')}</Button>
        <Button disabled={busy||!ready||!!stale} onClick={()=>void run(async()=>{const base=latest.current,r=await loadCard(c);remember(c.key);await useResource(r,base);})}>{sourceSelection?t('instrument.bind',sourceSelection.note):t(bindingType?'resources.bind':'add.title')}</Button>
      </div>{!sourceSelection&&!props.selectionOnly&&<details><summary>{t('resources.actions')}</summary><div className="button-group">
        <Button variant="outline" disabled={busy} onClick={()=>void run(async()=>{const destination=folderLibrary.destination,r=await loadCard(c);if(c.entry&&destination!==folderLibrary.destination)throw Error('resources.conflict');openEditor(r,!!c.entry);})}>{t('resources.edit')}</Button>
        {c.kind==='sound'&&!bindingType&&<Button variant="outline" disabled={busy||!ready} onClick={()=>void run(async()=>{const base=latest.current,destination=folderLibrary.destination,r=await loadCard(c);if(base!==latest.current||destination!==folderLibrary.destination)throw Error('error.scopeChanged');onOpen(resourceProject(r),c.entry?resourceOrigin(r,destination):undefined);})}>{t('resources.open')}</Button>}
        <Button variant="outline" disabled={busy} onClick={()=>void run(async()=>{const r=await loadCard(c);download(new Uint8Array(await packResource(r)).buffer,safeFilename(r.name)+'.sfresource','application/zip');})}>{t('resources.export')}</Button>
        {c.source==='remote'&&<Button variant="outline" disabled={busy||entries.some(e=>e.contentId===c.contentId)} onClick={()=>void run(async()=>{if(!folderLibrary.connected)await folderLibrary.choose();const destination=folderLibrary.destination,r=await loadCard(c);if((await folderLibrary.list()).some(e=>e.contentId===c.contentId)){setStatus(t('remote.downloaded'));return;}await folderLibrary.save(r,undefined,destination);setStatus(t('remote.downloaded'));})}>{t(entries.some(e=>e.contentId===c.contentId)?'remote.downloaded':'remote.download')}</Button>}
        {c.entry&&<Button variant="outline" disabled={busy} onClick={()=>setDeleting({...c.entry!,destination:folderLibrary.destination})}>{t('resources.delete')}</Button>}
      </div></details>}
    </article>)}</div>
    {visible.length>displayLimit&&<Button variant="outline" className="resource-load-more" onClick={()=>setDisplayLimit(n=>n+48)}>{t('resources.showMore',Math.min(48,visible.length-displayLimit),visible.length-displayLimit)}</Button>}
    {!visible.length&&<p>{t('resources.empty')}</p>}
    {editor&&<ResourceEditor initial={editor.resource} owned={editor.owned} binding={!!bindingType} onClose={()=>setEditor(null)} currentAssets={props.currentAssets??project.assets} onUse={r=>useResource(r,editor.base)} onRender={onRender}
      onChooseSource={(midi,onSelect,label)=>setNoteSource({midi,onSelect,label})}
      saveAndBindNote={sourceSelection?.note} onSaved={sourceSelection?r=>useResource(r,editor.base):undefined}
      onPersisted={(r,destination)=>{if(editor.current&&editor.base===latest.current)props.onProjectSaved?.(editor.base,resourceOrigin(r,destination));}}
      onOpen={(r,owned,destination)=>{if(editor.base!==latest.current)throw Error('error.scopeChanged');onOpen(resourceProject(r),owned?resourceOrigin(r,destination):undefined);setEditor(null);}}
      onPreview={onPreview} playback={playback} onStop={onStop} onImportAudio={async f=>Object.values((await onImportAudio(f)).assets)[0]}/>}
    {noteSource&&<ResourceManager {...props} bindingType={undefined} onBind={undefined} initialDefinition={undefined} saveHost={null}
      sourceSelection={{note:noteSource.label??pitchName(noteSource.midi),onSelect:noteSource.onSelect}} onClose={()=>{onStop();setNoteSource(null);}}/>}
    {deleting&&<Dialog open onOpenChange={v=>{if(!v)setDeleting(null);}}><DialogContent><DialogTitle>{t('resources.delete')}</DialogTitle><p>{t('resources.deleteConfirm',deleting.name)}</p><div className="button-group"><Button variant="outline" disabled={busy} onClick={()=>setDeleting(null)}>{t('resources.cancel')}</Button><Button disabled={busy} onClick={()=>void run(async()=>{await folderLibrary.remove(deleting.id,deleting.version,deleting.destination);setDeleting(null);})}>{t('resources.delete')}</Button></div></DialogContent></Dialog>}
    <input hidden ref={file} type="file" accept=".sfresource,.soundforge" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run(()=>fileImport(f));}}/>
    <input hidden ref={audio} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run(async()=>{const p=await onImportAudio(f);openEditor(audioMode.current==='recording'?resourceFromRecording(Object.values(p.assets)[0]):resourceFromProject(p));});}}/>
  </div>;
}
