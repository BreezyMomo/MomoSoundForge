import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { sealResource } from '../src/resourceGraph';
import { resourceFromDefinition, resourceFromProject, resourceProject } from '../src/soundResources';
import { BASIC_SYNTH } from '../src/synthesizers';
import { digest, readAudio, registerAudioProvider } from '../src/sharedAudio';
import { createRemoteLoader, fetchRemoteIndex, parseRemoteIndex, REMOTE_SCHEMA, remoteIndexUrl, type RemoteIndex } from '../src/remoteLibrary';
import { parseRemoteLibraryUrls, RemoteLibraries } from '../src/remoteSubscriptions';
import { makeProject, makeLayer, encodeSamples } from '../src/model';
import { packResource, unpackResource } from '../src/resourcePackage';
import { createSamplePreparer } from '../src/prepareSamples';
import { renderProject } from '../src/engine';

async function fixture(recording=false){
  const files=new Map<string,Uint8Array>(),audio:RemoteIndex['audio']=[];
  async function store(bytes:Uint8Array){const compressed=gzipSync(bytes),sha256=await digest(compressed),file=sha256+'.bin';files.set(file,compressed);return{file,sha256,bytes:compressed.length,decodedBytes:bytes.length};}
  const p=makeProject('Test');p.duration=.2;p.assets.a={id:'a',name:'recording',sampleRate:8000,channels:[encodeSamples(Float32Array.from({length:1600},(_,i)=>Math.sin(i*.1)*.3))]};p.inputs=[makeLayer({type:'sample',assetId:'a'})];
  const r=recording?resourceFromProject(p,[],'test-sound'):resourceFromDefinition(BASIC_SYNTH,'test-synth');
  const graph=await sealResource(r,async(ref,bytes)=>{audio.push({...ref,format:'pcm',...await store(bytes)});});
  const entry={...graph.entry,contentId:graph.root,...await store(new TextEncoder().encode(JSON.stringify(graph)))};
  const index:RemoteIndex={schema:REMOTE_SCHEMA,libraryId:'test-library',name:'Tests',entries:[entry],audio};
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>{const name=String(input).split('/').pop()!;return name==='index.json'?Response.json(index):files.has(name)?new Response(new Uint8Array(files.get(name)!).buffer):new Response('',{status:404});});
  return {index,fetcher,files,p};
}
it('loads a generic library from any HTTPS origin and checks immutable graph identity',async()=>{
  const f=await fixture(),url='https://cdn.example/sounds/index.json',index=await fetchRemoteIndex(url,f.fetcher);
  expect((await createRemoteLoader(index,url,f.fetcher)(index.entries[0])).kind).toBe('synth');
  expect(f.fetcher.mock.calls[0][0]).toBe(url);
  const bad=structuredClone(index.entries[0]);bad.contentId='node-'+'a'.repeat(64);
  await expect(createRemoteLoader(index,url,f.fetcher)(bad)).rejects.toThrow('remote.verify');
});
it('normalizes deployment library URLs without storing package metadata in the app',()=>{
  expect(parseRemoteLibraryUrls(' https://one.example/library/\nhttps://two.example/library/index.json,https://one.example/library/','https://official.example/index.json')).toEqual([
    'https://one.example/library/index.json','https://two.example/library/index.json',
  ]);
  expect(parseRemoteLibraryUrls('https://official.example/','https://official.example/index.json')).toEqual([]);
});
it('collects a complete resource for offline rendering and portable sharing',async()=>{
  const f=await fixture(true),index=parseRemoteIndex(f.index,'https://audio.example/index.json');
  const r=await createRemoteLoader(index,'https://audio.example/index.json',f.fetcher)(index.entries[0]);
  const online=f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation(async()=>{throw Error('Offline after download');});
  const packed=await packResource(r),reopened=await unpackResource(packed);
  const prepare=createSamplePreparer(async()=>{throw Error('Offline');});
  expect(renderProject(await prepare(resourceProject(reopened)),8000).left).toEqual(renderProject(f.p,8000).left);
  f.fetcher.mockImplementation(online);
  const absent={...index,audio:[]};await expect(createRemoteLoader(absent,'https://audio.example/index.json',f.fetcher)(index.entries[0])).rejects.toThrow('remote.missing');
});
it('rejects corrupt transport, over-budget catalogs and unsafe addresses',async()=>{
  const f=await fixture(),entry=f.index.entries[0];f.files.set(entry.file,new Uint8Array(entry.bytes));
  await expect(createRemoteLoader(f.index,'https://cdn.example/index.json',f.fetcher)(entry)).rejects.toThrow('remote.verify');
  for(const address of ['file:///tmp/index.json','http://example.com/','https://user:pass@example.com/','https://example.com/?token=secret'])expect(()=>remoteIndexUrl(address)).toThrow('remote.url');
  expect(remoteIndexUrl('https://cdn.example/sounds/')).toBe('https://cdn.example/sounds/index.json');
  const bad=structuredClone(f.index);bad.entries[0].file='../secret';expect(()=>parseRemoteIndex(bad,'https://cdn.example/index.json')).toThrow();
  bad.entries=[...Array(5001)].map(()=>entry);expect(()=>parseRemoteIndex(bad,'https://cdn.example/index.json')).toThrow();
});
it('keeps sources independent, retains valid data on refresh failure, and enforces library identity when moving',async()=>{
  const f=await fixture();let fail=false,changed=false;
  const fetcher=vi.fn(async()=>{if(fail)throw Error('Offline');return Response.json({...f.index,libraryId:changed?'different':'test-library'});});
  const registry=new RemoteLibraries([],undefined,fetcher);await registry.add('A','https://a.example/');
  const first=registry.snapshot()[0];expect(first.index?.entries).toHaveLength(1);
  await expect(registry.add('Mirror','https://b.example/')).rejects.toThrow('remote.duplicate');
  await registry.edit(first.id,'Moved','https://new.example/');expect(registry.snapshot()[0].url).toContain('new.example');
  changed=true;await expect(registry.edit(first.id,'Other','https://other.example/')).rejects.toThrow('remote.identity');
  await registry.add('B','https://b.example/');fail=true;await registry.refresh(first.id);
  expect(registry.snapshot()[0].index?.entries).toHaveLength(1);expect(registry.snapshot()[0].error).toBe('remote.network');expect(registry.snapshot()[1].error).toBeUndefined();
  registry.enable(first.id,false);expect(registry.snapshot()[1].enabled).toBe(true);
});
it('does not resurrect removed or disabled subscriptions after an in-flight refresh',async()=>{
  const f=await fixture();let resolve!:(r:Response)=>void;
  const registry=new RemoteLibraries([{id:'a',name:'A',url:'https://a.example/index.json',enabled:true}],undefined,()=>new Promise(r=>{resolve=r;}));
  const pending=registry.refresh('a');registry.remove('a');resolve(Response.json(f.index));await pending;expect(registry.snapshot()).toEqual([]);
  const disabled=new RemoteLibraries([{id:'a',name:'A',url:'https://a.example/index.json',enabled:true}],undefined,()=>new Promise(r=>{resolve=r;}));
  const pending2=disabled.refresh('a');disabled.enable('a',false);resolve(Response.json(f.index));await pending2;expect(disabled.snapshot()[0]).toMatchObject({enabled:false,loading:false});expect(disabled.snapshot()[0].index).toBeUndefined();
});
it('persists subscriptions separately from project state and restores deliberate empty configuration',async()=>{
  const f=await fixture(),memory=new Map<string,string>();const storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);}};
  const r=new RemoteLibraries([],storage,f.fetcher);await r.add('Mine','https://a.example/');
  expect(new RemoteLibraries([],storage).snapshot()[0].libraryId).toBe('test-library');
  r.remove(r.snapshot()[0].id);expect(new RemoteLibraries([{id:'official',name:'Default',url:'https://a.example/index.json',enabled:true}],storage).snapshot()).toEqual([]);
});

it('can use a healthy mirror when an earlier provider for the same audio is unavailable',async()=>{
  const f=await fixture(true),a=f.index.audio[0];registerAudioProvider(a.audioId,async()=>{throw Error('Old source offline');});
  const r=await createRemoteLoader(f.index,'https://new.example/index.json',f.fetcher)(f.index.entries[0]);
  expect(await readAudio(Object.values(resourceProject(r).assets)[0])).toBeInstanceOf(Uint8Array);
});

it('reports complete audio preparation and reuses cached audio on retry',async()=>{
  vi.stubGlobal('indexedDB',new IDBFactory());
  try {
  const f=await fixture(true),progress:import('../src/remoteLibrary').RemoteLoadProgress[]=[];
  const loader=createRemoteLoader(f.index,'https://progress.example/index.json',f.fetcher);
  await loader(f.index.entries[0],true,{onProgress:p=>progress.push(p)});
  expect(progress[0]).toMatchObject({phase:'definition',completed:0});
  expect(progress.at(-1)).toMatchObject({phase:'audio',completed:1,total:1});
  expect(progress.at(-1)!.downloadedBytes).toBeGreaterThan(0);
  expect(progress.every((p,i)=>i===0||p.downloadedBytes>=progress[i-1].downloadedBytes)).toBe(true);
  f.fetcher.mockClear();progress.length=0;
  await loader(f.index.entries[0],true,{onProgress:p=>progress.push(p)});
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(progress.at(-1)).toMatchObject({completed:1,total:1,downloadedBytes:f.index.entries[0].bytes});
  } finally {vi.unstubAllGlobals();}
});
it('cancels a pending stream and never returns a partially loaded resource',async()=>{
  const f=await fixture(),controller=new AbortController();let cancelled=false;
  const fetcher=vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}})));
  const pending=createRemoteLoader(f.index,'https://cancel.example/index.json',fetcher)(f.index.entries[0],true,{signal:controller.signal,onProgress:p=>{if(p.downloadedBytes)controller.abort();}});
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(cancelled).toBe(true);
  await expect(createRemoteLoader(f.index,'https://cancel.example/index.json',fetcher)(f.index.entries[0],true,{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('cancels before audio dependencies without returning a resource',async()=>{
  const f=await fixture(true),controller=new AbortController();
  await expect(createRemoteLoader(f.index,'https://cancel-audio.example/index.json',f.fetcher)(f.index.entries[0],true,{signal:controller.signal,onProgress:p=>{if(p.phase==='audio')controller.abort();}})).rejects.toMatchObject({name:'AbortError'});
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});
