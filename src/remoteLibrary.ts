import { openResourceGraph, GRAPH_BYTES } from './resourceGraph';
import { audioReference, builtinPCM, cacheAudio, digest, registerAudioProvider, resolveAudio } from './sharedAudio';
import type { SoundResource, ResourceKind } from './soundResources';
import type { SharedSampleReference, BuiltinSampleReference } from './sampleReference';

export const REMOTE_SCHEMA = 'momo.remote-sound-library/v1';
export const REMOTE_LIMITS = { sources: 32, index: 8 * 1024 * 1024, entries: 5000, audio: 4096, file: 48 * 1024 * 1024 };
export type RemoteFile = { file: string; sha256: string; bytes: number; decodedBytes: number };
export type RemoteAudio = RemoteFile & SharedSampleReference & { format: 'pcm' | 'wav16'; assetGains?: number[] };
export type RemoteEntry = RemoteFile & { id: string; contentId: string; name: string; names?: Record<string,string>; kind: ResourceKind; category: string; description: string; preview: number[] };
export type RemoteIndex = { schema: typeof REMOTE_SCHEMA; libraryId: string; name: string; entries: RemoteEntry[]; audio: RemoteAudio[] };
const validId = /^[a-zA-Z0-9-]{1,120}$/;
const fail = (key='invalid'): never => { throw Error('remote.'+key); };
const str = (v:unknown,n:number) => typeof v==='string' && v.length<=n;
const integer = (v:unknown,min:number,max:number) => Number.isSafeInteger(v) && Number(v)>=min && Number(v)<=max;
export function remoteIndexUrl(value:string) {
  let u:URL; try { u=new URL(value.trim()); } catch { return fail('url'); }
  if(u.protocol!=='https:' && !(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))fail('url');
  if(u.username||u.password||u.search||u.hash||u.href.length>2048)fail('url');
  if(u.pathname.endsWith('/'))u.pathname+='index.json';
  return u.href;
}
function file(raw:RemoteFile,base:string,max=REMOTE_LIMITS.file):RemoteFile {
  if(!raw||!str(raw.file,240)||! /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(raw.file)||raw.file.split('/').some(x=>x==='.'||x==='..')||
    !/^[a-f0-9]{64}$/.test(raw.sha256)||!integer(raw.bytes,1,max)||!integer(raw.decodedBytes,1,max))fail();
  const url=new URL(raw.file,base); if(url.origin!==new URL(base).origin)fail();
  return {file:raw.file,sha256:raw.sha256,bytes:raw.bytes,decodedBytes:raw.decodedBytes};
}
export function parseRemoteIndex(raw:unknown,url:string):RemoteIndex {
  const r=raw as RemoteIndex; remoteIndexUrl(url);
  if(!r||r.schema!==REMOTE_SCHEMA||typeof r.libraryId!=='string'||!validId.test(r.libraryId)||!str(r.name,120)||!r.name.trim()||!Array.isArray(r.entries)||r.entries.length>REMOTE_LIMITS.entries||!Array.isArray(r.audio)||r.audio.length>REMOTE_LIMITS.audio)fail();
  const ids=new Set<string>(), audioIds=new Set<string>();
  const entries=r.entries.map(e=>{
    const f=file(e,url,GRAPH_BYTES);
    if(typeof e.id!=='string'||!validId.test(e.id)||ids.has(e.id)||!/^(node|instrument|synth)-[a-f0-9]{64}$/.test(e.contentId)||!str(e.name,120)||!e.name.trim()||
      !['sound','recording','instrument','synth'].includes(e.kind)||!str(e.category,120)||!str(e.description,2000)||!Array.isArray(e.preview)||e.preview.length>160||e.preview.some(x=>!Number.isFinite(x)||Math.abs(x)>1))fail();
    if(e.names&&(!str(e.names.zh,120)||!str(e.names.en,120)))fail();ids.add(e.id);
    return {...f,id:e.id,contentId:e.contentId,name:e.name,names:e.names?{zh:e.names.zh,en:e.names.en}:undefined,kind:e.kind,category:e.category,description:e.description,preview:[...e.preview]};
  });
  const audio=r.audio.map(a=>{
    const f=file(a,url);
    if(a.schema!=='momo.audio-reference/v1'||!/^audio-[a-f0-9]{64}$/.test(a.audioId)||audioIds.has(a.audioId)||!integer(a.frames,1,5760000)||!integer(a.sampleRate,8000,192000)||![1,2].includes(a.channelCount)||!['pcm','wav16'].includes(a.format))fail();
    if(a.format==='wav16'&&(a.sampleRate!==48000||a.channelCount!==2||!Array.isArray(a.assetGains)||a.assetGains.length>2||a.assetGains.some(x=>!Number.isFinite(x)||x<=0||x>1000)))fail();
    const expected=a.format==='pcm'?16+a.frames*a.channelCount*4:44+a.frames*4;
    if(a.decodedBytes!==expected)fail();audioIds.add(a.audioId);
    return {...f,schema:a.schema,audioId:a.audioId,frames:a.frames,sampleRate:a.sampleRate,channelCount:a.channelCount,format:a.format,assetGains:a.assetGains};
  });
  return {schema:REMOTE_SCHEMA,libraryId:r.libraryId,name:r.name,entries,audio};
}
async function bounded(stream:ReadableStream<Uint8Array>,limit:number) {
  const reader=stream.getReader(),parts:Uint8Array[]=[];let size=0;
  try { for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>limit)fail('budget');parts.push(value);} }
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;for(const p of parts){result.set(p,offset);offset+=p.length;}return result;
}
export async function fetchRemoteBytes(url:string,limit:number,fetcher:typeof fetch=fetch) {
  const r=await fetcher(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!r.ok||!r.body)fail('network');return bounded(r.body!,limit);
}
export async function fetchRemoteIndex(url:string,fetcher:typeof fetch=fetch) {
  const address=remoteIndexUrl(url),bytes=await fetchRemoteBytes(address,REMOTE_LIMITS.index,fetcher);
  try{return parseRemoteIndex(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),address);}catch(e){if(e instanceof Error&&e.message.startsWith('remote.'))throw e;return fail();}
}
export function createRemoteLoader(index:RemoteIndex,url:string,fetcher:typeof fetch=fetch) {
  const audio=new Map(index.audio.map(a=>[a.audioId,a]));
  const decoded=async(f:RemoteFile)=>{
    const bytes=await fetchRemoteBytes(new URL(f.file,url).href,f.bytes,fetcher);
    if(bytes.length!==f.bytes||await digest(bytes)!==f.sha256)fail('verify');
    const result=await bounded(new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip')),f.decodedBytes);
    if(result.length!==f.decodedBytes)fail('verify');return result;
  };
  return async(entry:RemoteEntry,complete=true):Promise<SoundResource>=>{
    const graph=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await decoded(entry)));
    if(graph.root!==entry.contentId||graph.entry?.id!==entry.id||graph.entry?.kind!==entry.kind)fail('verify');
    const opened=await openResourceGraph(graph),providers=new Map<string,()=>Promise<Uint8Array>>();
    // Validate the whole dependency closure before registering any source.
    for(const [id,ref]of opened.audio){const a=audio.get(id);if(!a||a.frames!==ref.frames||a.sampleRate!==ref.sampleRate||a.channelCount!==ref.channelCount)fail('missing');
      providers.set(id,async()=>{const raw=await decoded(a!),pcm=a!.format==='pcm'?raw:builtinPCM(raw,a as unknown as BuiltinSampleReference);
        if((await audioReference(pcm)).audioId!==id)fail('verify');return pcm;});}
    if(complete)for(const [id,provider]of providers){const ref=opened.audio.get(id)!;await cacheAudio(id,await resolveAudio(ref,provider));}
    // Captured URLs remain valid for this open resource even if its subscription is removed.
    if(!complete)for(const [id,provider]of providers)registerAudioProvider(id,provider);
    return {...opened.resource,name:entry.name,category:entry.category,description:entry.description,preview:entry.preview};
  };
}
