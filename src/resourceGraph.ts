import { parseResource, type SoundResource } from './soundResources';
import type { SampleAsset } from './model';
import { audioReference, canonical, contentId, readAudio } from './sharedAudio';
import { parseSampleReference, type SharedSampleReference } from './sampleReference';
import { validateArticulationNames } from './articulationNames';

export type ContentObject={kind:'node'|'synth'|'instrument';value:Record<string,unknown>};
export type ResourceGraph={schema:'momo.resource-graph/v1';renderContract:'momo.engine/1';
  entry:Omit<SoundResource,'payload'|'schema'>;root:string;objects:Record<string,ContentObject>;
  annotations:Record<string,Record<string,unknown>>};
export const GRAPH_BYTES=16*1024*1024;
export const PACKAGE_BYTES=768*1024*1024;
export const PACKAGE_EXPANDED_BYTES=1536*1024*1024;
const objectId=/^(node|synth|instrument)-[a-f0-9]{64}$/;
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const annotationKeys=new Set(['name','source','license','id','articulationNames']);
export async function sealResource(raw:SoundResource,writeAudio:(ref:SharedSampleReference,bytes:Uint8Array)=>Promise<void>,reader=readAudio):Promise<ResourceGraph>{
  const resource=parseResource(raw),objects:ResourceGraph['objects']=Object.create(null),annotations:ResourceGraph['annotations']=Object.create(null);
  let audioTotal=0;const audioSeen=new Set<string>(),sourceSeen=new Map<string,SharedSampleReference>();
  const normalize=async(value:unknown,depth=0):Promise<unknown>=>{
    if(depth>96)throw Error('resources.budget');
    if(Array.isArray(value)){const out=[];for(let i=0;i<value.length;i++)out.push(await normalize(value[i],depth+1));return out;}
    if(!record(value))return value;
    let v=value;
    if(typeof v.sampleRate==='number'&&Array.isArray(v.channels)&&typeof v.id==='string'){
      const asset=v as unknown as SampleAsset;
      // Repeated bindings share one full recording, even when their playback prefixes differ.
      const key=asset.reference?canonical({...asset.reference,frameLimit:undefined}):canonical({sampleRate:asset.sampleRate,channels:asset.channels});
      let ref=sourceSeen.get(key);
      if(!ref){const bytes=await reader(asset);ref=await audioReference(bytes);sourceSeen.set(key,ref);
        if(!audioSeen.has(ref.audioId)){audioSeen.add(ref.audioId);audioTotal+=bytes.length;if(audioSeen.size>2048||audioTotal>PACKAGE_EXPANDED_BYTES)throw Error('resources.budget');await writeAudio(ref,bytes);}}
      v={...asset,channels:[],reference:{...ref,...(asset.reference?.frameLimit!==undefined?{frameLimit:asset.reference.frameLimit}:{})}};
    }
    const out:Record<string,unknown>=Object.create(null);
    for(const [key,item]of Object.entries(v))if(item!==undefined)out[key]=await normalize(item,depth+1);
    return out;
  };
  const visit=async(value:unknown,path:string,depth=0,assets:Record<string,SampleAsset>={}):Promise<unknown>=>{
    if(depth>96)throw Error('resources.budget');
    if(Array.isArray(value)){const out=[];for(let i=0;i<value.length;i++)out.push(await visit(value[i],path+'/'+i,depth+1,assets));return out;}
    if(!record(value))return value;
    let v=value;
    if(record(v.assets))assets=v.assets as Record<string,SampleAsset>;
    const kind:ContentObject['kind']=v.schema==='momo.synth/v1'?'synth':Array.isArray(v.regions)&&typeof v.id==='string'?'instrument':'node';
    if(kind==='instrument')v={...v,_audioBindings:instrumentBindings(v,assets)};
    const meta:Record<string,unknown>={},body:Record<string,unknown>=Object.create(null);
    for(const [key,item] of Object.entries(v)){
      if(item===undefined)continue;
      if(['__proto__','prototype','constructor'].includes(key))throw Error('resources.invalid');
      if((key==='name'&&typeof item==='string')||((key==='source'||key==='license')&&typeof v.id==='string'&&typeof v.name==='string')||(key==='id'&&kind!=='node')||(key==='articulationNames'&&kind==='instrument'))meta[key]=item;
      else body[key]=await visit(item,path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),depth+1,assets);
    }
    if(Object.keys(meta).length)annotations[path]=meta;
    const object={kind,value:body},id=await contentId(kind,object);objects[id]=object;
    if(Object.keys(objects).length>30000)throw Error('resources.budget');
    return {$ref:id};
  };
  const root=await visit(await normalize(resource.payload),'') as {$ref:string};
  const {payload:_payload,schema:_schema,...entry}=resource;
  const graph:ResourceGraph={schema:'momo.resource-graph/v1',renderContract:'momo.engine/1',entry,root:root.$ref,objects,annotations};
  if(new TextEncoder().encode(JSON.stringify(graph)).length>GRAPH_BYTES)throw Error('resources.budget');
  return graph;
}

/** Validate the complete graph before publishing any imported dependency providers. */
export async function openResourceGraph(raw:unknown):Promise<{resource:SoundResource;audio:Map<string,SharedSampleReference>}> {
  const g=raw as ResourceGraph;
  if(new TextEncoder().encode(JSON.stringify(raw)).length>GRAPH_BYTES)throw Error('resources.budget');
  if(!g||g.schema!=='momo.resource-graph/v1'||g.renderContract!=='momo.engine/1'||!record(g.objects)||!record(g.annotations)||!record(g.entry)||!objectId.test(g.root)||Object.keys(g.objects).length>30000||Object.keys(g.annotations).length>30000)throw Error('resources.invalid');
  for(const [id,obj]of Object.entries(g.objects)){
    if(!objectId.test(id)||!record(obj)||!['node','synth','instrument'].includes(obj.kind)||!record(obj.value)||await contentId(obj.kind,obj)!==id)throw Error('resources.verify');
  }
  const visited=new Set<string>(),annotationPaths=new Set<string>(),audio=new Map<string,SharedSampleReference>();let steps=0;
  const inflate=(value:unknown,path:string,stack:Set<string>,depth=0):unknown=>{
    if(depth>96||++steps>250000)throw Error('resources.budget');
    if(Array.isArray(value))return value.map((v,i)=>inflate(v,path+'/'+i,stack,depth+1));
    if(!record(value))return value;
    if(Object.keys(value).length!==1||typeof value.$ref!=='string')throw Error('resources.invalid');
    const id=value.$ref,obj=g.objects[id];if(!obj||stack.has(id))throw Error('resources.invalid');
    visited.add(id);stack.add(id);
    const out:Record<string,unknown>=Object.create(null);
    for(const [k,v] of Object.entries(obj.value)){if(['__proto__','prototype','constructor'].includes(k))throw Error('resources.invalid');out[k]=inflate(v,path+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1'),stack,depth+1);}
    stack.delete(id);
    // Localized labels belong only to an instrument annotation. Reject hashed
    // copies so a display-only edit can never change sound identity.
    if(Object.hasOwn(out,'articulationNames'))throw Error('resources.invalid');
    const meta=g.annotations[path];
    if(meta){if(!record(meta)||Object.keys(meta).some(k=>!annotationKeys.has(k)||Object.hasOwn(out,k))||('id'in meta&&obj.kind==='node'))throw Error('resources.invalid');Object.assign(out,meta);annotationPaths.add(path);}
    if(meta&&Object.hasOwn(meta,'articulationNames')){
      if(obj.kind!=='instrument'||!Array.isArray(out.regions))throw Error('resources.invalid');
      validateArticulationNames(meta.articulationNames,'resources.invalid');
    }
    if(out.schema==='momo.audio-reference/v1'){
      const ref=parseSampleReference(out) as SharedSampleReference,prior=audio.get(ref.audioId);
      if(prior&&(prior.frames!==ref.frames||prior.sampleRate!==ref.sampleRate||prior.channelCount!==ref.channelCount))throw Error('resources.conflict');audio.set(ref.audioId,ref);
    }
    if(out.schema==='momo.builtin-sample/v1')throw Error('resources.missing');
    return out;
  };
  const payload=inflate({$ref:g.root},'',new Set());
  const verifyBindings=(value:unknown,assets:Record<string,SampleAsset>={})=>{
    if(Array.isArray(value)){value.forEach(v=>verifyBindings(v,assets));return;}
    if(!record(value))return;
    if(record(value.assets))assets=value.assets as Record<string,SampleAsset>;
    if(Array.isArray(value.regions)){
      if(canonical(value._audioBindings)!==canonical(instrumentBindings(value,assets)))throw Error('resources.conflict');
      delete value._audioBindings;
    } else if('_audioBindings'in value)throw Error('resources.invalid');
    Object.values(value).forEach(v=>verifyBindings(v,assets));
  };
  verifyBindings(payload);
  if(visited.size!==Object.keys(g.objects).length||annotationPaths.size!==Object.keys(g.annotations).length)throw Error('resources.invalid');
  const resource=parseResource({...g.entry,schema:'momo.sound-resource/v1',payload});
  if(audio.size>2048||[...audio.values()].reduce((n,r)=>n+16+r.frames*r.channelCount*4,0)>PACKAGE_EXPANDED_BYTES)throw Error('resources.budget');
  return {resource,audio};
}

function instrumentBindings(instrument:Record<string,unknown>,assets:Record<string,SampleAsset>){
  const bindings:Record<string,unknown>=Object.create(null);
  for(const r of instrument.regions as Record<string,unknown>[])for(const key of ['assetId','releaseAssetId']){
    const id=r[key];if(typeof id==='string'&&id){const asset=assets[id];if(!asset?.reference||asset.reference.schema!=='momo.audio-reference/v1')throw Error('resources.missing');bindings[id]=asset.reference;}
  }
  return bindings;
}
