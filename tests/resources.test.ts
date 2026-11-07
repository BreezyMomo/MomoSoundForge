import { prepareProjectSamples } from '../src/prepareSamples';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FolderLibrary, folderLibrary } from '../src/folderLibrary';
import { parseResource, resourceFromDefinition, resourceFromProject, resourceFromRecording, resourceProject, importResource } from '../src/soundResources';
import { BASIC_SYNTH, parseSynth, expressionVoice, type SynthDefinition } from '../src/synthesizers';
import { compileExpression } from '../src/synthExpression';
import { definitionProject, bindDefinition, type InstrumentDefinition } from '../src/soundDefinitions';
import { renderProject } from '../src/engine';
import { projectDocument, parseProject, rng, encodeSamples, uid } from '../src/model';
import { appendInstrumentNode } from '../src/instrumentNode';
import { emptyScore, scoreIssues } from '../src/instruments';
import { DEFAULT_EFFECTS } from '../src/advanced';
import { saveSoundToLibrary as saveLegacySound, listSavedSounds as listLegacySounds } from '../src/storage';
import { saveDefinition } from '../src/definitionStorage';
import { migrateBrowserLibrary } from '../src/libraryMigration';
import {ProjectResourceOrigins,resourceOrigin} from '../src/resourceOrigin';

class MemoryFolder {
  files=new Map<string,Uint8Array>();
  permission='granted';
  failWrite='';
  pause: ((path:string)=>Promise<void>) | undefined;
  constructor(public name='Test library') {}
  handle(prefix=''): FileSystemDirectoryHandle {
    const owner=this;
    return {
      kind:'directory',name:owner.name,
      queryPermission:async()=>owner.permission,requestPermission:async()=>owner.permission,
      async getDirectoryHandle(name:string,o?:{create?:boolean}) {
        if(!o?.create&&![...owner.files.keys()].some(k=>k.startsWith(prefix+name+'/')))throw new DOMException('Missing','NotFoundError');
        return owner.handle(prefix+name+'/');
      },
      async getFileHandle(name:string,o?:{create?:boolean}) {
        const path=prefix+name;if(!owner.files.has(path)){if(!o?.create)throw new DOMException('Missing','NotFoundError');owner.files.set(path,new Uint8Array());}
        return {kind:'file',name,
          async getFile(){const bytes=owner.files.get(path)!;return {size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer};},
          async createWritable(){let staged=new Uint8Array();return {
            async write(data:Uint8Array){await owner.pause?.(path);staged=data.slice();},
            async close(){if(path===owner.failWrite)throw Error('Disk full');owner.files.set(path,staged);},
            async abort(){},
          };},
        };
      },
      async removeEntry(name:string){owner.files.delete(prefix+name);},
      async *entries(){for(const key of owner.files.keys())if(key.startsWith(prefix)&&!key.slice(prefix.length).includes('/'))yield [key.slice(prefix.length),{kind:'file'}];},
    } as unknown as FileSystemDirectoryHandle;
  }
}
function library() {
  let saved:FileSystemDirectoryHandle|null=null;
  return new FolderLibrary({read:async()=>saved??undefined,write:async h=>{saved=h;}});
}
const expression=():SynthDefinition=>parseSynth({...structuredClone(BASIC_SYNTH),id:'fm-bell',name:'FM Bell',algorithm:'expression-v1',
  program:{expression:'sin(2*pi*phase + color*sin(6*pi*phase))*0.8 + noise()*0.02',parameters:[{variable:'color',name:'Color',min:0,max:3,step:0.01,default:0.7}]}});
const instrument=():InstrumentDefinition=>({schema:'momo.instrument/v1',instrument:{id:'keys',name:'Keys',regions:[{
  id:'range',assetId:'',synth:expression(),rootMidi:60,keyLow:48,keyHigh:84,velocityLow:1,velocityHigh:127,articulation:'sustain',roundRobin:0,tuneCents:0,gainDb:0,releaseSeconds:0.15,
}]},assets:{}});
beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('window',new EventTarget());vi.stubGlobal('navigator',{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('stores one audio object across recordings and instruments, reuses identical imports, and preserves old content after edits',async()=>{
  const lib=library(),disk=new MemoryFolder();await lib.connect(disk.handle());
  const asset={id:'shared',name:'Shared',sampleRate:8000,channels:[encodeSamples(new Float32Array(800).fill(.1))]};
  const r=resourceFromRecording(asset,60),first=await lib.save(r),files=disk.files.size;
  expect(await lib.save(r)).toEqual(first);expect(disk.files.size).toBe(files);
  const d=instrument();d.assets={shared:asset};d.instrument.regions=[{...d.instrument.regions[0],synth:undefined,assetId:'shared'}];
  await lib.save(resourceFromDefinition(d));
  expect([...disk.files.keys()].filter(k=>k.startsWith('audio/'))).toHaveLength(1);
  const old=await lib.load(r.id),before=renderProject(await prepareProjectSamples(resourceProject(old)),8000).left;
  const changed=structuredClone(r);(changed.payload as {asset:typeof asset}).asset.channels=[encodeSamples(new Float32Array(800).fill(.2))];
  const next=await lib.save(changed,1);expect(next.contentId).not.toBe(first.contentId);
  expect([...disk.files.keys()].filter(k=>k.startsWith('audio/'))).toHaveLength(2);
  await lib.remove(r.id,2);
  expect(renderProject(await prepareProjectSamples(resourceProject(old)),8000).left).toEqual(before);
});

it('saves an opened work back to its original resource, advances undo snapshots, and refuses stale or switched destinations',async()=>{
  const lib=library(),disk=new MemoryFolder();await lib.connect(disk.handle());
  const r=resourceFromProject(definitionProject(expression()));await lib.save(r);
  const opened=resourceProject(await lib.load(r.id)),edited={...opened,name:'Edited'},origins=new ProjectResourceOrigins();
  origins.inherit(opened,opened,resourceOrigin(r,lib.destination));origins.inherit(opened,edited);
  const origin=origins.get(edited)!;
  const updated={...resourceFromProject(edited),id:origin.id,version:origin.version};
  const entry=await lib.save(updated,origin.version,origin.destination);
  origins.saved(edited,resourceOrigin({...updated,version:entry.version},origin.destination));
  expect(await lib.list('sound')).toHaveLength(1);
  expect((await lib.load(r.id)).name).toBe('Edited');
  expect(origins.get(opened)?.version).toBe(2);
  await expect(lib.save(updated,1,origin.destination)).rejects.toThrow('resources.conflict');
  await lib.connect(new MemoryFolder('Another library').handle());
  await expect(lib.save(updated,origin.version,origin.destination)).rejects.toThrow('resources.conflict');
  expect(await lib.list()).toHaveLength(0);
});

it('indexes individual recordings and detects inconsistent metadata while reading older indexes',async()=>{
  const lib=library(),disk=new MemoryFolder();await lib.connect(disk.handle());
  const d=instrument();
  d.assets={sample:{id:'sample',name:'sample.wav',sampleRate:8000,channels:[encodeSamples(new Float32Array(160).fill(.2))]}};
  d.instrument.regions=[{...d.instrument.regions[0],synth:undefined,assetId:'sample'}];
  const r=resourceFromDefinition(d),entry=await lib.save(r);
  expect(entry.recordings).toEqual([expect.objectContaining({id:'sample',rootMidi:60,variant:1})]);
  expect((await lib.load(r.id)).kind).toBe('instrument');
  const index=JSON.parse(new TextDecoder().decode(disk.files.get('index.json')!));
  const write=()=>disk.files.set('index.json',new TextEncoder().encode(JSON.stringify(index)));
  index.entries[0].recordings[0].rootMidi=61;write();
  await expect(lib.load(r.id)).rejects.toThrow('resources.conflict');
  index.entries[0].recordings[0].variant=0;write();
  await expect(lib.list()).rejects.toThrow('resources.invalid');
  delete index.entries[0].recordings;write();
  expect((await lib.load(r.id)).id).toBe(r.id);
});

it('keeps recordings as independent library entries when an instrument is saved, updated or deleted',async()=>{
  const lib=library(),disk=new MemoryFolder();await lib.connect(disk.handle());
  const d=instrument(),asset={id:'c3',name:'C3.wav',sampleRate:8000,channels:[encodeSamples(new Float32Array(160).fill(.2))]};
  d.assets={[asset.id]:asset};d.instrument.regions=[{...d.instrument.regions[0],synth:undefined,assetId:asset.id,rootMidi:48}];
  const r=resourceFromDefinition(d),first=await lib.save(r),sources=await lib.list('recording');
  expect(sources).toHaveLength(1);expect(first.sourceResourceIds).toEqual([sources[0].id]);
  const recording=await lib.load(sources[0].id);expect(recording.payload).toMatchObject({schema:'momo.recording/v1',rootMidi:48,asset:{...asset,channels:[],reference:expect.objectContaining({schema:'momo.audio-reference/v1'})}});
  const audio=renderProject(await prepareProjectSamples(resourceProject(recording)),8000).left;
  await lib.save(r,1);expect(await lib.list('recording')).toHaveLength(1);
  await lib.remove(r.id,2);expect((await lib.load(sources[0].id)).payload).toEqual(recording.payload);
  expect(renderProject(await prepareProjectSamples(resourceProject(await lib.load(sources[0].id))),8000).left).toEqual(audio);
});

it('reuses an existing recording despite asset ID remapping and backfills older instruments without changing their version',async()=>{
  const lib=library(),disk=new MemoryFolder();await lib.connect(disk.handle());
  const asset={id:'source',name:'C3.wav',sampleRate:8000,channels:[encodeSamples(new Float32Array(160).fill(.2))]};
  const source=resourceFromRecording(asset,48);await lib.save(source);
  const d=instrument();d.assets={remapped:{...asset,id:'remapped'}};
  d.instrument.regions=[{...d.instrument.regions[0],synth:undefined,assetId:'remapped',rootMidi:48}];
  const r=resourceFromDefinition(d);await lib.save(r);expect(await lib.list('recording')).toHaveLength(1);
  const index=JSON.parse(new TextDecoder().decode(disk.files.get('index.json')!));
  const before=index.entries.find((e:{id:string})=>e.id===r.id);const file=before.file;delete before.sourceResourceIds;
  index.entries=index.entries.filter((e:{id:string})=>e.id===r.id);
  disk.files.set('index.json',new TextEncoder().encode(JSON.stringify(index)));
  await lib.indexInstrumentSources(r.id,1);
  const after=(await lib.list('instrument'))[0];expect(after.version).toBe(1);expect(after.file).toBe(file);
  expect(await lib.list('recording')).toHaveLength(1);expect((await lib.load(r.id)).payload).toMatchObject({instrument:JSON.parse(JSON.stringify(d.instrument))});
});

it('validates standalone recording metadata and renders even very short recordings as portable work',()=>{
  const r=resourceFromRecording({id:'short',name:'Short hit',sampleRate:8000,channels:[encodeSamples(new Float32Array(160).fill(.2))]},null);
  const p=resourceProject(importResource(JSON.parse(JSON.stringify(r))));
  expect(p.duration).toBe(.1);expect(p.inputs[0].player.type).toBe('sample');expect(renderProject(p,8000).peak).toBeGreaterThan(0);
  expect(renderProject(parseProject(projectDocument(p)),8000).left).toEqual(renderProject(p,8000).left);
  const boosted=resourceProject(parseResource({...r,payload:{...r.payload as object,gainDb:24}}));
  expect(renderProject(boosted,8000).peak).toBeGreaterThan(renderProject(p,8000).peak);
  for(const patch of [{rootMidi:128},{rootMidi:'C3'},{tuneCents:Infinity},{gainDb:25}])expect(()=>parseResource({...r,payload:{...r.payload as object,...patch}})).toThrow();
});

it('adds synthesizers referenced by imported instruments as reusable generators',async()=>{
  const lib=library(),disk=new MemoryFolder();await lib.connect(disk.handle());
  const r=resourceFromDefinition(instrument()),entry=await lib.save(r),sources=await lib.list('synth');
  expect(sources).toHaveLength(1);expect(entry.sourceResourceIds).toEqual([sources[0].id]);
  expect((await lib.load(sources[0].id)).payload).toMatchObject({algorithm:'expression-v1',program:expression().program});
  await lib.save(r,1);expect(await lib.list('synth')).toHaveLength(1);
  await lib.remove(r.id,2);expect(renderProject(await prepareProjectSamples(resourceProject(await lib.load(sources[0].id))),8000).peak).toBeGreaterThan(0);
});

it('persists portable definitions, versions and independent work instances in a folder, then reconnects',async()=>{
  const lib=library(),disk=new MemoryFolder();await lib.connect(disk.handle());
  const r=resourceFromDefinition(expression()),first=await lib.save(r);
  expect(first.version).toBe(1);expect(first).not.toHaveProperty('payload');
  const original=await lib.load(r.id),p=resourceProject(original),expected=renderProject(p,8000);
  r.name='Updated';await lib.save(r,1);
  expect((await lib.list())[0].version).toBe(2);expect((await lib.load(r.id)).name).toBe('Updated');
  await expect(lib.save(r,1)).rejects.toThrow('resources.conflict');
  expect(renderProject(p,8000).left).toEqual(expected.left);
  await lib.restore();expect((await lib.list())[0].id).toBe(r.id);
  const second=new MemoryFolder('Other');await lib.connect(second.handle());expect(await lib.list()).toEqual([]);
  await lib.connect(disk.handle());expect((await lib.load(r.id)).version).toBe(2);
  await lib.disconnect();expect(await lib.list()).toEqual([]);
  expect(renderProject(p,8000).left).toEqual(expected.left);
});
it('keeps the old index on disk failure and rejects missing, tampered and traversing packages',async()=>{
  const lib=library(),disk=new MemoryFolder();await lib.connect(disk.handle());const r=resourceFromDefinition(expression());const entry=await lib.save(r);
  disk.failWrite='index.json';await expect(lib.save({...r,name:'Failed'},1)).rejects.toThrow('Disk full');
  disk.failWrite='';expect((await lib.load(r.id)).name).toBe(r.name);
  disk.files.set(entry.file,new TextEncoder().encode('{}'));await expect(lib.load(r.id)).rejects.toThrow('resources.verify');
  const index=JSON.parse(new TextDecoder().decode(disk.files.get('index.json')));index.entries[0].file='../private.json';
  disk.files.set('index.json',new TextEncoder().encode(JSON.stringify(index)));await expect(lib.list()).rejects.toThrow('resources.invalid');
});
it('rejects writes without permission or a folder, and prevents cross-folder delayed writes',async()=>{
  const lib=library(),a=new MemoryFolder(),b=new MemoryFolder('B'),r=resourceFromDefinition(expression());
  await expect(lib.save(r)).rejects.toThrow('resources.noFolder');await lib.connect(a.handle());
  a.permission='denied';await expect(lib.save(r)).rejects.toThrow('resources.permission');a.permission='granted';
  let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(resolve=>{started=resolve;});
  a.pause=async path=>{if(path.startsWith('resources/')){started();await new Promise<void>(resolve=>{release=resolve;});}};
  const pending=lib.save(r);const rejection=expect(pending).rejects.toThrow('resources.conflict');await waiting;
  await lib.connect(b.handle());release();await rejection;expect(await lib.list()).toEqual([]);
  a.pause=undefined;await lib.connect(a.handle());expect(await lib.list()).toEqual([]);
});
it('rejects stale destination tokens and inactive imports before publishing the resource',async()=>{
  const lib=library(),a=new MemoryFolder(),b=new MemoryFolder();await lib.connect(a.handle());const token=lib.destination;
  await lib.connect(b.handle());await expect(lib.save(resourceFromDefinition(expression()),undefined,token)).rejects.toThrow('resources.conflict');
  await expect(lib.save(resourceFromDefinition(expression()),undefined,lib.destination,()=>false)).rejects.toThrow('resources.conflict');expect(await lib.list()).toEqual([]);
});
it('serializes competing saves and removes listings while retaining immutable content and snapshots',async()=>{
  const lib=library(),disk=new MemoryFolder();await lib.connect(disk.handle());const r=resourceFromDefinition(expression());await lib.save(r);
  const p=resourceProject(await lib.load(r.id)),audio=renderProject(p,8000).left;
  const result=await Promise.allSettled([lib.save({...r,name:'A'},1),lib.save({...r,name:'B'},1)]);
  expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  disk.files.set('resources/keep.txt',new Uint8Array([1]));
  const neighbor={...r,id:r.id+'-v1',name:'Neighbor'};const other=await lib.save(neighbor);
  const filesBefore=[...disk.files.keys()].sort();await lib.remove(r.id,2);expect((await lib.list()).map(e=>e.id)).toEqual([neighbor.id]);
  expect((await lib.load(neighbor.id)).name).toBe('Neighbor');expect([...disk.files.keys()].sort()).toEqual(filesBefore);
  expect(renderProject(p,8000).left).toEqual(audio);
});
it('migrates both legacy stores, verifies round trips, retries idempotently and preserves originals',async()=>{
  const lib=library(),disk=new MemoryFolder();await lib.connect(disk.handle());
  vi.spyOn(folderLibrary,'list').mockImplementation(lib.list.bind(lib));vi.spyOn(folderLibrary,'load').mockImplementation(lib.load.bind(lib));vi.spyOn(folderLibrary,'save').mockImplementation(lib.save.bind(lib));
  const p=definitionProject(expression());await saveLegacySound(p,renderProject(p,8000));await saveDefinition(expression());
  await migrateBrowserLibrary();await migrateBrowserLibrary();const entries=await lib.list();expect(entries).toHaveLength(2);
  expect(entries.map(e=>e.kind).sort()).toEqual(['sound','synth']);expect(await listLegacySounds()).toHaveLength(1);
  const imported=resourceProject(await lib.load(entries.find(e=>e.kind==='sound')!.id));expect(renderProject(imported,8000).left).toEqual(renderProject(p,8000).left);
});
it('carries a custom algorithm and instance values through a native save and changes the sound when adjusted',()=>{
  const p=definitionProject(expression());p.inputs[0].player.synthValues={color:1.1};
  const audio=renderProject(p,8000);expect(audio.peak).toBeGreaterThan(0.01);
  expect(renderProject(parseProject(projectDocument(p)),8000).left).toEqual(audio.left);
  const other=structuredClone(p);other.inputs[0].player.synthValues={color:0};expect(renderProject(other,8000).left).not.toEqual(audio.left);
  p.inputs[0].player.noiseSeed++;expect(renderProject(p,8000).left).not.toEqual(audio.left);
});
it('validates the numeric language, detects invalid output, and bounds computation without executing code',()=>{
  const c={t:0,phase:0.2,frequency:440,duration:1,velocity:1,values:{},noise:rng(1)};
  expect(compileExpression('-1 + 2*3/4',[]).evaluate(c)).toBe(0.5);
  for(const code of ['window.alert(1)','globalThis','noise.constructor()','while(1){}','sin()','pow(2)','[1]','x=1','constructor(1)','1 2'])
    expect(()=>compileExpression(code,[])).toThrow();
  expect(()=>compileExpression('('.repeat(25)+'1'+')'.repeat(25),[])).toThrow();
  expect(()=>compileExpression('sqrt(-1)',[]).evaluate(c)).toThrow('resources.expressionOutput');
  expect(()=>expressionVoice(expression(),{},rng(1),1e9)).toThrow('error.renderBudget');
  const p=definitionProject(expression());p.inputs[0].player.synthValues={color:Infinity};expect(()=>parseProject(projectDocument(p))).toThrow();
  expect(()=>parseSynth({...expression(),program:{expression:'1',parameters:[{variable:'constructor',name:'bad',min:0,max:1,step:1,default:0}]}})).toThrow();
});
it('uses a synthesizer instrument across pitches, keeps audition notes out of definitions and inlines dependencies',()=>{
  const r=resourceFromDefinition(instrument()),blank=resourceProject(r),p=resourceProject(r,true);
  expect(blank.inputs[0].player.score!.notes).toEqual([]);
  const score=p.inputs[0].player.score!;score.notes[0].midi=60;const a=renderProject(p,8000);
  score.notes[0].midi=72;const b=renderProject(p,8000);expect(a.left).not.toEqual(b.left);expect(b.peak).toBeGreaterThan(0.01);
  expect(scoreIssues(score,p.assets,2)).toEqual([]);
  const parent=appendInstrumentNode(blank,p);expect(renderProject(parseProject(projectDocument(parent)),8000).peak).toBeGreaterThan(0.01);
  const portable=resourceFromProject(p);expect(resourceProject(importResource(JSON.parse(JSON.stringify(portable))))).toEqual(p);
  expect(renderProject(parseProject(projectDocument(p)),8000).left).toEqual(b.left);
  const high=instrument();high.instrument.regions[0].keyLow=84;high.instrument.regions[0].keyHigh=96;
  expect(()=>resourceFromDefinition(high)).not.toThrow();
  const first=resourceProject(importResource(instrument()),true),second=resourceProject(importResource(instrument()),true);
  expect(renderProject(first,8000).left).toEqual(renderProject(second,8000).left);
});
it('binds a new algorithm once, retaining timing/effects and clearing obsolete source parameter mappings',()=>{
  const p=definitionProject(BASIC_SYNTH),l=p.inputs[0];l.player.effects={...DEFAULT_EFFECTS,delayWet:0.2};l.start=0.2;
  p.controls=[{id:'tone',name:'Tone',min:0,max:1,defaultValue:0.5,mappings:[{layerId:l.id,parameter:'frequency',low:200,high:500},{layerId:l.id,parameter:'gain',low:0.1,high:1}]}];
  l.automation={cutoff:[{time:0,value:100},{time:1,value:3000}]};
  const bound=bindDefinition(p,l.id,expression());expect(bound.inputs[0].start).toBe(l.start);expect(bound.inputs[0].player.effects).toEqual(l.player.effects);
  expect(bound.controls![0].mappings.map(m=>m.parameter)).toEqual(['gain']);expect(bound.inputs[0].automation?.cutoff).toBeUndefined();
  expect(renderProject(bound,8000).peak).toBeGreaterThan(0);
});
it('validates resource metadata, versions, sample dependencies and mixed sample/synth instrument portability',()=>{
  const r=resourceFromDefinition(expression());expect(()=>parseResource({...r,version:0})).toThrow();expect(()=>parseResource({...r,id:'../x'})).toThrow();
  expect(()=>parseResource({...r,kind:'instrument'})).toThrow();expect(()=>parseResource({...r,preview:[Infinity]})).toThrow();
  const d=instrument();d.assets.wave={id:'wave',name:'Wave',sampleRate:8000,channels:[encodeSamples(Float32Array.from({length:1000},(_,i)=>Math.sin(i/8)*0.1))]};
  d.instrument.regions.push({...d.instrument.regions[0],id:'sample',assetId:'wave',synth:undefined,synthValues:undefined,keyLow:85,keyHigh:96,rootMidi:85});
  const clean=resourceFromDefinition(d),p=resourceProject(clean,true);expect(p.assets.wave).toBeDefined();
  expect(parseProject(projectDocument(p)).inputs[0].player.score!.instruments[0].regions).toHaveLength(2);
  delete d.assets.wave;expect(()=>resourceFromDefinition(d)).toThrow();
});
