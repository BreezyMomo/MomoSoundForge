import JSZip from 'jszip';
import { resourceFromProject, resourceProject, type SoundResource } from './soundResources';
import type { Project } from './model';
import { GRAPH_BYTES, PACKAGE_BYTES, PACKAGE_EXPANDED_BYTES, openResourceGraph, sealResource } from './resourceGraph';
import { audioReference, cacheAudio, readAudio, registerAudioProvider, compressAudio, decompressAudio } from './sharedAudio';

export async function packResource(resource:SoundResource,reader=readAudio):Promise<Uint8Array>{
  const zip=new JSZip();
  const graph=await sealResource(resource,async(ref,bytes)=>{zip.file(`audio/${ref.audioId}.pcm.gz`,await compressAudio(bytes));},reader);
  zip.file('manifest.json',JSON.stringify(graph),{compression:'DEFLATE'});
  const bytes=await zip.generateAsync({type:'uint8array',compression:'STORE'});
  if(bytes.length>PACKAGE_BYTES)throw Error('resources.budget');return bytes;
}
export async function unpackResource(bytes:Uint8Array):Promise<SoundResource>{
  if(bytes.length>PACKAGE_BYTES)throw Error('resources.budget');
  inspectZip(bytes);
  const zip=await JSZip.loadAsync(bytes),entries=Object.values(zip.files).filter(f=>!f.dir);
  if(entries.length>2049||!zip.file('manifest.json'))throw Error('resources.invalid');
  let total=0;
  for(const file of entries){
    const size=(file as unknown as {_data:{uncompressedSize:number}})._data.uncompressedSize;
    if(!Number.isSafeInteger(size)||size<1||size>(file.name==='manifest.json'?GRAPH_BYTES:16+5760000*8)||(total+=size)>PACKAGE_EXPANDED_BYTES||file.name!==file.unsafeOriginalName)throw Error('resources.budget');
  }
  const {resource,audio}=await openResourceGraph(JSON.parse(await zip.file('manifest.json')!.async('string')));
  if(entries.length!==audio.size+1)throw Error('resources.invalid');
  if([...audio.values()].reduce((n,r)=>n+16+r.frames*r.channelCount*4,0)>PACKAGE_EXPANDED_BYTES)throw Error('resources.budget');
  // Validate every file (including currently unused notes), then attach providers as a unit.
  for(const [id,ref]of audio){const file=zip.file(`audio/${id}.pcm.gz`);if(!file)throw Error('resources.missing');
    const actual=await audioReference(await decompressAudio(await file.async('uint8array')));
    if(actual.audioId!==id||actual.frames!==ref.frames||actual.sampleRate!==ref.sampleRate||actual.channelCount!==ref.channelCount)throw Error('resources.verify');}
  for(const [id]of audio){const file=zip.file(`audio/${id}.pcm.gz`)!;const packed=await file.async('uint8array');await cacheAudio(id,await decompressAudio(packed),packed);}
  if(typeof indexedDB==='undefined')for(const [id]of audio){const file=zip.file(`audio/${id}.pcm.gz`)!;registerAudioProvider(id,async()=>decompressAudio(await file.async('uint8array')));}
  return resource;
}
export const packProject=(p:Project,reader=readAudio)=>packResource(resourceFromProject(p),reader);
export async function unpackProject(bytes:Uint8Array){const r=await unpackResource(bytes);if(r.kind!=='sound')throw Error('resources.invalid');return resourceProject(r);}
export async function readResourceFile(file:File){if(file.size>PACKAGE_BYTES)throw Error('resources.budget');return unpackResource(new Uint8Array(await file.arrayBuffer()));}
export async function readProjectFile(file:File){const r=await readResourceFile(file);if(r.kind!=='sound')throw Error('resources.invalid');return resourceProject(r);}

// Reject duplicate paths before JSZip can collapse them; bound expansion before allocating PCM.
function inspectZip(bytes:Uint8Array){
  if(bytes.length<22)throw Error('resources.invalid');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break;}
  if(end<0||v.getUint16(end+4,true)!==0||v.getUint16(end+6,true)!==0||v.getUint16(end+8,true)!==v.getUint16(end+10,true))throw Error('resources.invalid');
  const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true);let offset=v.getUint32(end+16,true),expanded=0;
  if(count>2051||offset+size!==end)throw Error('resources.budget');
  const names=new Set<string>(),decode=new TextDecoder('utf-8',{fatal:true});
  for(let i=0;i<count;i++){
    if(offset+46>end||v.getUint32(offset,true)!==0x02014b50)throw Error('resources.invalid');
    const length=v.getUint16(offset+28,true),extra=v.getUint16(offset+30,true),comment=v.getUint16(offset+32,true),n=v.getUint32(offset+24,true),method=v.getUint16(offset+10,true);
    if(offset+46+length+extra+comment>end||! [0,8].includes(method)||(v.getUint16(offset+8,true)&1)!==0)throw Error('resources.invalid');
    const name=decode.decode(bytes.subarray(offset+46,offset+46+length));
    if(names.has(name)||!(/^(manifest\.json|audio\/|audio\/audio-[a-f0-9]{64}\.pcm\.gz)$/.test(name)))throw Error('resources.invalid');
    names.add(name);expanded+=n;
    if(n>(name==='manifest.json'?GRAPH_BYTES:16+5760000*8)||expanded>PACKAGE_EXPANDED_BYTES)throw Error('resources.budget');
    offset+=46+length+extra+comment;
  }
  if(offset!==end||!names.has('manifest.json'))throw Error('resources.invalid');
}
