import { resourceFromDefinition, parseResource, resourceProject, RESOURCE_BYTES, type SoundResource, type ResourceKind } from './soundResources';
import { sealResource, openResourceGraph, GRAPH_BYTES, type ResourceGraph } from './resourceGraph';
import { AUDIO_BYTES, registerAudioProvider, audioReference, readAudio, canonical, cacheAudio, compressAudio, decompressAudio } from './sharedAudio';
import { uid } from './model';
import { recordingResource, recordingSummaries, parseRecordingSummaries, type RecordingSummary } from './recordingSources';
import type { InstrumentDefinition } from './soundDefinitions';
import type { RecordingDefinition } from './recordingDefinition';

export type ResourceEntry = Omit<SoundResource, 'schema' | 'payload'> & { contentId?:string; file: string; hash: string; updatedAt: number; duration?:number;layerCount?:number;recordings?:RecordingSummary[];sourceFingerprint?:string;sourceResourceIds?:string[] };
type Index = { schema: 'momo.sound-library/v2'; id: string; name: string; entries: ResourceEntry[] };
type Directory = FileSystemDirectoryHandle & { queryPermission?: (p: {mode: 'readwrite'}) => Promise<string>; requestPermission?: (p: {mode: 'readwrite'}) => Promise<string> };
const encode = new TextEncoder();
const hash = async (data: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)), x => x.toString(16).padStart(2, '0')).join('');
const pathOK = /^resources\/[a-zA-Z0-9-]{1,120}-v[1-9][0-9]*-[a-f0-9]{64}\.sfresource$/;
const eventName = 'soundforge-library-updated';
const channel=typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'?new BroadcastChannel('momo-sound-library-changes'):null;
channel?.addEventListener('message',()=>window.dispatchEvent(new Event(eventName)));
export function libraryChanged() { window.dispatchEvent(new Event(eventName));channel?.postMessage('refresh'); }
export function onLibraryChange(fn: () => void) { window.addEventListener(eventName, fn); return () => window.removeEventListener(eventName, fn); }
function preferences(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('momo-sound-library-connection', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('connection');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => { const db = r.result, tx = db.transaction('connection', mode);
      const request=fn(tx.objectStore('connection'));
      tx.oncomplete = () => { db.close(); resolve(request.result); }; tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
export class FolderLibrary {
  constructor(private readonly persistence = {
    read: async () => await preferences('readonly',s=>s.get('folder')) as Directory | undefined,
    write: async (folder: Directory | null) => { await preferences('readwrite',s=>folder?s.put(folder,'folder'):s.delete('folder')); },
  }) {}
  private folder: Directory | null = null;
  private token = 0;
  private tail: Promise<unknown> = Promise.resolve();
  name = '';
  get connected() { return !!this.folder; }
  get destination() { return this.token; }
  async restore() {
    const token=this.token;
    const folder = await this.persistence.read();
    if (folder?.kind==='directory' && typeof folder.getFileHandle==='function' && token===this.token) { this.folder = folder; this.token++; this.name = folder.name; }
  }
  async choose() {
    const pick = (window as unknown as {showDirectoryPicker?: (o: {mode: 'readwrite'}) => Promise<Directory>}).showDirectoryPicker;
    if (!pick) throw Error('resources.browser');
    const folder = await pick.call(window,{mode:'readwrite'});
    await this.connect(folder);
  }
  async connect(folder: Directory) {
    await this.permission(folder, true);
    const old = await this.readIndex(folder);
    if (!old) {
      const state={schema:'momo.sound-library/v2',id:uid(),name:folder.name,entries:[]};
      const create=async()=>{if(await this.readIndex(folder))return;await this.write(folder,'index.json',encode.encode(JSON.stringify(state)));};
      if(navigator.locks)await navigator.locks.request('momo-sound-library-write',create);else await create();
    }
    await this.persistence.write(folder);
    this.folder = folder; this.token++; this.name = folder.name; libraryChanged();
  }
  async authorize() { if (!this.folder) throw Error('resources.noFolder'); await this.permission(this.folder, true); libraryChanged(); }
  async disconnect() { await this.persistence.write(null); this.folder = null; this.token++; this.name = ''; libraryChanged(); }
  private async permission(folder: Directory, request = false) {
    if (!folder.queryPermission) return;
    let state = await folder.queryPermission({mode:'readwrite'});
    if (state !== 'granted' && request) state = await folder.requestPermission?.({mode:'readwrite'}) ?? state;
    if (state !== 'granted') throw Error('resources.permission');
  }
  private async read(folder: Directory, path: string, limit = Math.max(RESOURCE_BYTES,AUDIO_BYTES)): Promise<Uint8Array | null> {
    try {
      const [dir, leaf] = path.includes('/') ? path.split('/') : ['', path];
      const parent = dir ? await folder.getDirectoryHandle(dir) : folder;
      const file = await (await parent.getFileHandle(leaf)).getFile();
      if (file.size > limit) throw Error('resources.budget');
      return new Uint8Array(await file.arrayBuffer());
    } catch (e) { if ((e as DOMException).name === 'NotFoundError') return null; throw e; }
  }
  private async write(folder: Directory, path: string, data: Uint8Array) {
    if(path!=='index.json') {const existing=await this.read(folder,path);if(existing){if(await hash(existing)!==await hash(data))throw Error('resources.conflict');return;}}
    const [dir, leaf] = path.includes('/') ? path.split('/') : ['', path];
    const parent = dir ? await folder.getDirectoryHandle(dir, {create:true}) : folder;
    const stream = await (await parent.getFileHandle(leaf, {create:true})).createWritable();
    try { await stream.write(data as Uint8Array<ArrayBuffer>); await stream.close(); } catch (e) { await stream.abort().catch(() => {}); throw e; }
    const actual = await this.read(folder, path);
    if (!actual || await hash(actual) !== await hash(data)) throw Error('resources.verify');
  }
  private async readIndex(folder: Directory): Promise<{index: Index; revision: string} | null> {
    const bytes = await this.read(folder, 'index.json', 4 * 1024 * 1024); if (!bytes) return null;
    const index = JSON.parse(new TextDecoder().decode(bytes)) as Index;
    if (index.schema !== 'momo.sound-library/v2' || typeof index.id !== 'string' || !index.id || typeof index.name !== 'string' ||
      !Array.isArray(index.entries) || index.entries.length > 2000 || new Set(index.entries.map(e => e.id)).size !== index.entries.length) throw Error('resources.invalid');
    for (const e of index.entries) if (!e || !pathOK.test(e.file) || typeof e.id !== 'string' || !/^[a-zA-Z0-9-]{1,120}$/.test(e.id) ||
      e.file !== `resources/${e.id}-v${e.version}-${e.hash}.sfresource` || !/^[a-f0-9]{64}$/.test(e.hash) || !Number.isSafeInteger(e.version) || e.version < 1 ||
      typeof e.name !== 'string' || !e.name.trim() || e.name.length > 120 || !['recording','synth','instrument','sound'].includes(e.kind) ||
      typeof e.category !== 'string' || e.category.length > 120 || typeof e.description !== 'string' || e.description.length > 2000 || !Number.isFinite(e.updatedAt) ||
      !Array.isArray(e.preview) || e.preview.length > 160 || e.preview.some(x => !Number.isFinite(x) || Math.abs(x) > 1)) throw Error('resources.invalid');
    for(const e of index.entries)if(e.kind==='sound'&&(!Number.isFinite(e.duration)||e.duration!<0.1||!Number.isInteger(e.layerCount)||e.layerCount!<0||e.layerCount!>128))throw Error('resources.invalid');
    for(const e of index.entries)if(e.recordings!==undefined){if(e.kind!=='instrument')throw Error('resources.invalid');e.recordings=parseRecordingSummaries(e.recordings);}
    for(const e of index.entries){
      if(e.sourceFingerprint!==undefined&&(!['recording','synth'].includes(e.kind)||!/^[a-f0-9]{64}$/.test(e.sourceFingerprint)))throw Error('resources.invalid');
      if(e.sourceResourceIds!==undefined&&(e.kind!=='instrument'||!Array.isArray(e.sourceResourceIds)||e.sourceResourceIds.length>192||e.sourceResourceIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{1,120}$/.test(id))))throw Error('resources.invalid');
    }
    return {index, revision: await hash(bytes)};
  }
  async list(kind?: ResourceKind) { const folder=this.folder,token=this.token;if (!folder) return []; await this.permission(folder); const state = await this.readIndex(folder);
    if(token!==this.token)throw Error('resources.conflict');
    if (!state) throw Error('resources.invalid'); return state.index.entries.filter(e => !kind || e.kind === kind).sort((a,b) => b.updatedAt-a.updatedAt); }
  async load(id: string) {
    const folder = this.folder, token = this.token; if (!folder) throw Error('resources.noFolder');
    const entry = (await this.list()).find(e => e.id === id); if (!entry) throw Error('resources.missing');
    const data = await this.read(folder, entry.file); if (!data || await hash(data) !== entry.hash) throw Error('resources.verify');
    const manifest = JSON.parse(new TextDecoder().decode(data));
    if(!Array.isArray(manifest.objectIds)||manifest.objectIds.length>30000||new Set(manifest.objectIds).size!==manifest.objectIds.length)throw Error('resources.invalid');
    const objects:ResourceGraph['objects']=Object.create(null);
    let graphBytes=data.length;
    for(const key of manifest.objectIds){if(typeof key!=='string'||!/^(node|synth|instrument)-[a-f0-9]{64}$/.test(key))throw Error('resources.invalid');
      const bytes=await this.read(folder,`objects/${key}.json`,GRAPH_BYTES);if(!bytes)throw Error('resources.missing');if((graphBytes+=bytes.length)>GRAPH_BYTES)throw Error('resources.budget');objects[key]=JSON.parse(new TextDecoder().decode(bytes));}
    const {resource:r,audio}=await openResourceGraph({...manifest,objects});
    if(manifest.root!==entry.contentId)throw Error('resources.conflict');
    if (r.id !== id || r.version !== entry.version || r.kind !== entry.kind || r.name!==entry.name || r.category!==entry.category || r.description!==entry.description || JSON.stringify(r.preview)!==JSON.stringify(entry.preview) || token !== this.token) throw Error('resources.conflict');
    if(entry.recordings!==undefined&&JSON.stringify(entry.recordings)!==JSON.stringify(recordingSummaries(r.payload as InstrumentDefinition)))throw Error('resources.conflict');
    if(entry.sourceFingerprint!==undefined&&entry.sourceFingerprint!==await this.sourceFingerprint(r))throw Error('resources.conflict');
    // Cache the full closure separately from listings so draft reload and undo survive disconnecting the folder.
    for(const [audioId]of audio){const bytes=await this.read(folder,`audio/${audioId}.pcm.gz`);if(!bytes)throw Error('resources.missing');await cacheAudio(audioId,await decompressAudio(bytes),bytes);}
    if(typeof indexedDB==='undefined')for(const [audioId]of audio)registerAudioProvider(audioId,async()=>{const bytes=await this.read(folder,`audio/${audioId}.pcm.gz`);if(!bytes)throw Error('resources.missing');return decompressAudio(bytes);});
    return r;
  }
  private mutate<T>(action: (folder: Directory, state: {index: Index; revision: string}, check: () => void) => Promise<T>): Promise<T> {
    const folder = this.folder, token = this.token;
    const run = async () => {
      if (!folder) throw Error('resources.noFolder');
      const check = () => { if (token !== this.token || folder !== this.folder) throw Error('resources.conflict'); };
      const work = async () => { check(); await this.permission(folder); const state = await this.readIndex(folder); if (!state) throw Error('resources.invalid'); return action(folder, state, check); };
      return navigator.locks ? navigator.locks.request('momo-sound-library-write', work) : work();
    };
    const result = this.tail.then(run, run); this.tail = result.catch(() => {}); return result;
  }
  private async commit(folder: Directory, state: {index: Index; revision: string}, index: Index, check: () => void) {
    check(); if ((await this.readIndex(folder))?.revision !== state.revision) throw Error('resources.conflict');
    const bytes = encode.encode(JSON.stringify(index, null, 2)); if (bytes.length > 4 * 1024 * 1024) throw Error('resources.budget');
    check(); await this.write(folder, 'index.json', bytes); libraryChanged();
  }
  private async sourceFingerprint(r:SoundResource){
    if(r.kind==='synth'){const {id:_id,name:_name,...synth}=r.payload as import('./synthesizers').SynthDefinition;return hash(encode.encode(canonical(synth)));}
    const d=r.payload as RecordingDefinition;
    const audioId=d.asset.reference?.audioId??(await audioReference(await readAudio(d.asset))).audioId;
    return hash(encode.encode(canonical({audioId,frameLimit:d.asset.reference?.frameLimit,rootMidi:d.rootMidi,
      tuneCents:d.tuneCents,gainDb:d.gainDb,releaseSeconds:d.releaseSeconds,loop:d.loop})));
  }
  private async writeResource(folder:Directory,r:SoundResource):Promise<ResourceEntry>{
    const graph=await sealResource(r,async(ref,bytes)=>{
      const path=`audio/${ref.audioId}.pcm.gz`,existing=await this.read(folder,path);
      if(existing){if((await audioReference(await decompressAudio(existing))).audioId!==ref.audioId)throw Error('resources.conflict');return;}
      await this.write(folder,path,await compressAudio(bytes));
    });
    for(const [id,object]of Object.entries(graph.objects))await this.write(folder,`objects/${id}.json`,encode.encode(canonical(object)));
    const {objects,...manifest}=graph;
    const bytes=encode.encode(JSON.stringify({...manifest,objectIds:Object.keys(objects)}));if(bytes.length>RESOURCE_BYTES)throw Error('resources.budget');
    const digest=await hash(bytes),file=`resources/${r.id}-v${r.version}-${digest}.sfresource`;
    await this.write(folder,file,bytes);
    const {payload:_payload,schema:_schema,...meta}=r;
    const extra:Partial<ResourceEntry>={};
    if(r.kind==='recording'||r.kind==='synth')extra.sourceFingerprint=await this.sourceFingerprint(r);
    if(r.kind==='instrument')extra.recordings=recordingSummaries(r.payload as InstrumentDefinition);
    if(r.kind==='sound'){const p=resourceProject(r);const count=(p:ReturnType<typeof resourceProject>):number=>p.inputs.reduce((n,l)=>n+1+(l.player.mix?count(l.player.mix):0),0);extra.duration=p.duration;extra.layerCount=count(p);}
    return {...meta,...extra,contentId:graph.root,file,hash:digest,updatedAt:Date.now()};
  }
  private async addInstrumentSources(folder:Directory,r:SoundResource,entries:ResourceEntry[],check:()=>void){
    const ids:string[]=[];
    const d=r.payload as InstrumentDefinition;
    const sources=[...recordingSummaries(d).map(summary=>recordingResource(r,summary.id,summary.name)),
      ...d.instrument.regions.filter(region=>region.synth).map(region=>({...resourceFromDefinition(region.synth!),category:r.category}))];
    for(const recording of sources){
      check();const fingerprint=await this.sourceFingerprint(recording);
      const existing=entries.find(e=>e.kind===recording.kind&&e.sourceFingerprint===fingerprint);
      if(existing){ids.push(existing.id);continue;}
      recording.id=recording.kind+'-'+fingerprint;
      // A user may have edited a previous auto-created source in place. Keep both sounds.
      if(entries.some(e=>e.id===recording.id))recording.id=uid();
      if(entries.length>=2000)throw Error('resources.budget');
      entries.push(await this.writeResource(folder,recording));ids.push(recording.id);
    }
    return [...new Set(ids)];
  }
  /** Populate sources for an older library without changing its instrument definition/version. */
  async indexInstrumentSources(id:string,expectedVersion:number,expectedDestination=this.destination){
    return this.mutate(async(folder,state,check)=>{
      if(expectedDestination!==this.destination)throw Error('resources.conflict');
      const old=state.index.entries.find(e=>e.id===id);
      if(!old||old.kind!=='instrument'||old.version!==expectedVersion)throw Error('resources.conflict');
      const r=await this.load(id),entries=structuredClone(state.index.entries),entry=entries.find(e=>e.id===id)!;
      entry.sourceResourceIds=await this.addInstrumentSources(folder,r,entries,check);
      entry.recordings=recordingSummaries(r.payload as InstrumentDefinition);
      await this.commit(folder,state,{...state.index,entries},check);
    });
  }
  async save(raw: SoundResource, expectedVersion?: number, expectedDestination = this.destination, isActive:()=>boolean = ()=>true) {
    const r = parseResource(raw);
    return this.mutate(async (folder, state, check) => {
      const activeCheck=()=>{check();if(!isActive())throw Error('resources.conflict');};activeCheck();
      if(expectedDestination!==this.destination)throw Error('resources.conflict');
      const previous = state.index.entries.find(e => e.id === r.id);
      if(previous&&expectedVersion===undefined){
        const graph=await sealResource(r,async()=>{}),stored=await this.read(folder,previous.file);
        if(stored&&await hash(stored)!==previous.hash)throw Error('resources.verify');
        if(stored){const manifest=JSON.parse(new TextDecoder().decode(stored));
          if(graph.root===previous.contentId&&canonical(graph.annotations)===canonical(manifest.annotations)
            &&canonical({...graph.entry,version:previous.version})===canonical(manifest.entry))return previous;}
      }
      if (previous ? expectedVersion !== previous.version : expectedVersion !== undefined) throw Error('resources.conflict');
      if(previous && previous.kind!==r.kind)throw Error('resources.conflict');
      const next = {...r, version: previous ? previous.version+1 : 1};
      check();const entry=await this.writeResource(folder,next);
      const entries = [...state.index.entries.filter(e => e.id !== r.id), entry]; if (entries.length > 2000) throw Error('resources.budget');
      if(r.kind==='instrument')entry.sourceResourceIds=await this.addInstrumentSources(folder,next,entries,activeCheck);
      await this.commit(folder, state, {...state.index, entries}, activeCheck); return entry;
    });
  }
  async remove(id: string, expectedVersion: number, expectedDestination=this.destination) {
    return this.mutate(async (folder, state, check) => {
      if(expectedDestination!==this.destination)throw Error('resources.conflict');
      const previous = state.index.entries.find(e => e.id === id); if (!previous || previous.version !== expectedVersion) throw Error('resources.conflict');
      await this.commit(folder, state, {...state.index, entries:state.index.entries.filter(e => e.id !== id)}, check);
      // Removing a listing must not invalidate another definition, draft or undo snapshot.
    });
  }
}
export const folderLibrary = new FolderLibrary();
export const libraryReady = typeof indexedDB === 'undefined' ? Promise.resolve() : folderLibrary.restore().catch(() => {});
