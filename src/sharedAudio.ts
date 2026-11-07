import { createBuiltinFileLoader } from './builtinFiles';
import type { SampleAsset } from './model';
import type { BuiltinSampleReference, SharedSampleReference } from './sampleReference';
import catalog from './data/builtin-catalog.json';

export const AUDIO_BYTES = 16 + 5760000 * 8;
export async function compressAudio(bytes:Uint8Array){return new Uint8Array(await new Response(new Blob([new Uint8Array(bytes).buffer]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());}
export async function decompressAudio(bytes:Uint8Array){
  const reader=new Blob([new Uint8Array(bytes).buffer]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>AUDIO_BYTES)throw Error('resources.budget');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}return output;
}
export const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), n => n.toString(16).padStart(2,'0')).join('');
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw Error('resources.invalid');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).filter(k => (value as Record<string,unknown>)[k] !== undefined).sort()
    .map(k => JSON.stringify(k) + ':' + canonical((value as Record<string,unknown>)[k])).join(',') + '}';
}
export const contentId = async (kind: string, value: unknown) => kind + '-' + await digest(new TextEncoder().encode(canonical(value)));

// Canonical planar, little-endian Float32 PCM. Header includes rate, channels and frames.
export function audioBytes(sampleRate: number, channels: Float32Array[]): Uint8Array {
  const frames = channels[0]?.length ?? 0, bytes = new Uint8Array(16 + frames * channels.length * 4), view = new DataView(bytes.buffer);
  bytes.set([77,83,65,49]); view.setUint32(4,sampleRate,true); view.setUint32(8,channels.length,true); view.setUint32(12,frames,true);
  for (let c=0;c<channels.length;c++) {
    if(channels[c].length!==frames)throw Error('resources.invalid');
    for(let i=0;i<frames;i++)view.setFloat32(16+(c*frames+i)*4,channels[c][i],true);
  }
  inspectAudio(bytes); return bytes;
}
export function inspectAudio(bytes: Uint8Array) {
  if(bytes.length<20 || bytes.length>AUDIO_BYTES)throw Error('resources.budget');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),sampleRate=view.getUint32(4,true),channelCount=view.getUint32(8,true),frames=view.getUint32(12,true);
  if(bytes[0]!==77||bytes[1]!==83||bytes[2]!==65||bytes[3]!==49||sampleRate<8000||sampleRate>192000||![1,2].includes(channelCount)||frames<1||frames>5760000||bytes.length!==16+frames*channelCount*4)throw Error('resources.invalid');
  for(let i=16;i<bytes.length;i+=4)if(!Number.isFinite(view.getFloat32(i,true)))throw Error('resources.invalid');
  return {sampleRate,channelCount,frames};
}
export async function audioReference(bytes: Uint8Array):Promise<SharedSampleReference> {
  return {schema:'momo.audio-reference/v1',audioId:'audio-'+await digest(bytes),...inspectAudio(bytes)};
}
type Provider=()=>Promise<Uint8Array>;
const providers=new Map<string,Provider>();
// The cache is independent of resource-library listings and survives draft reloads.
async function pool(mode: IDBTransactionMode,id:string,bytes?:Uint8Array):Promise<Uint8Array|undefined>{
  if(typeof indexedDB==='undefined')return undefined;
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('momo-shared-audio',1);r.onupgradeneeded=()=>r.result.createObjectStore('objects');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('objects',mode),store=tx.objectStore('objects'),r=bytes?store.put(new Uint8Array(bytes),id):store.get(id);tx.oncomplete=()=>resolve(bytes?undefined:r.result);tx.onerror=tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export function registerAudioProvider(id:string,provider:Provider){if(!/^audio-[a-f0-9]{64}$/.test(id))throw Error('resources.invalid');providers.set(id,provider);}
export async function cacheAudio(id:string,bytes:Uint8Array,compressed?:Uint8Array){
  if((await audioReference(bytes)).audioId!==id)throw Error('resources.verify');
  const existing=await pool('readonly',id);
  if(existing){if(await digest(await decompressAudio(existing))!==await digest(bytes))throw Error('resources.conflict');return;}
  const packed=compressed??await compressAudio(bytes);
  if(typeof indexedDB!=='undefined')await pool('readwrite',id,packed);
  else registerAudioProvider(id,()=>decompressAudio(packed));
}
export async function resolveAudio(ref:SharedSampleReference,fallback?:Provider):Promise<Uint8Array>{
  const cached=await pool('readonly',ref.audioId);
  const provider=providers.get(ref.audioId);
  let bytes:Uint8Array|undefined;
  if(cached)bytes=await decompressAudio(cached);
  else try{bytes=await (provider??fallback)?.();}
  catch(error){if(!provider||!fallback||provider===fallback)throw error;bytes=await fallback();}
  if(!bytes)throw Error('error.sampleUnavailable');
  const actual=await audioReference(bytes);
  if(actual.audioId!==ref.audioId||actual.frames!==ref.frames||actual.channelCount!==ref.channelCount||actual.sampleRate!==ref.sampleRate)throw Error('resources.verify');
  return bytes;
}
export function audioChannels(bytes:Uint8Array,frames?:number):Float32Array[]{
  const h=inspectAudio(bytes),n=frames??h.frames,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(n<1||n>h.frames)throw Error('resources.invalid');
  return Array.from({length:h.channelCount},(_,c)=>Float32Array.from({length:n},(_,i)=>view.getFloat32(16+(c*h.frames+i)*4,true)));
}
export function builtinPCM(wav:Uint8Array,r:BuiltinSampleReference):Uint8Array{
  const v=new DataView(wav.buffer,wav.byteOffset,wav.byteLength),tag=(n:number)=>String.fromCharCode(...wav.subarray(n,n+4));
  if(wav.length!==44+r.frames*4||tag(0)!=='RIFF'||tag(8)!=='WAVE'||tag(12)!=='fmt '||tag(36)!=='data'||v.getUint32(4,true)!==wav.length-8||v.getUint32(16,true)!==16||v.getUint16(20,true)!==1||v.getUint16(22,true)!==2||v.getUint32(24,true)!==48000||v.getUint32(28,true)!==192000||v.getUint16(32,true)!==4||v.getUint16(34,true)!==16||v.getUint32(40,true)!==r.frames*4)throw Error('error.sampleReference');
  return audioBytes(48000,[0,1].map(c=>Float32Array.from({length:r.frames},(_,i)=>{let value=v.getInt16(44+i*4+c*2,true)/32768;for(const gain of r.assetGains)value=Math.fround(value*gain);return value;})));
}
export function createAudioReader(fetcher:(url:string)=>Promise<Response>=url=>fetch(url),base=import.meta.env?.BASE_URL??'/'){
  const files=createBuiltinFileLoader([],fetcher,base);
  const builtins=new Map(((catalog as unknown as {audio?: (BuiltinSampleReference & {id:string;format:'pcm'|'wav16'})[]}).audio??[]).map(r=>[r.id,r]));
  return async(asset:SampleAsset):Promise<Uint8Array>=>{
    if(asset.reference?.schema==='momo.audio-reference/v1'){
      const ref=asset.reference,r=builtins.get(ref.audioId);
      return resolveAudio(ref,r?async()=>{const bytes=await files.loadFile(r);return r.format==='pcm'?bytes:builtinPCM(bytes,r);}:undefined);
    }
    if(asset.reference){const r=asset.reference,bytes=builtinPCM(await files.loadFile({...r,id:r.sha256}),r);if(r.audioId&&(await audioReference(bytes)).audioId!==r.audioId)throw Error('resources.verify');return bytes;}
    return audioBytes(asset.sampleRate,asset.channels.map(c=>{const binary=atob(c),view=new DataView(Uint8Array.from(binary,x=>x.charCodeAt(0)).buffer);return Float32Array.from({length:binary.length/4},(_,i)=>view.getFloat32(i*4,true));}));
  };
}
export const readAudio=createAudioReader();
