import { readAsset } from './sound-asset-store.mjs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { deterministicGzip } from './deterministic-gzip.mjs';
import { recordingId } from './builtin-instruments.mjs';
import { compileVelocityRegions } from './builtin-velocity-regions.mjs';

export function completeOrchestraJobs(manifest, base) {
  return [...Map.groupBy(manifest.samples,s=>s.instrumentId)].map(([id,samples])=>({
    id:'instrument-vsco-'+id,kind:'instrument',completeInstrument:true,orchestraComplete:true,
    nameKey:'builtin.instrument.'+id,category:samples[0].family,articulation:'sustain',
    keyLow:Math.min(...samples.map(s=>s.keyLow)),keyHigh:Math.max(...samples.map(s=>s.keyHigh)),
    keywords:`${id} VSCO complete author mappings 完整乐器 长音 短音`,samples,base,
    recordingIds:[...new Set(samples.map(recordingId))],
    sourceFiles:[base+'/manifest.json',...new Set(samples.flatMap(s=>[base+'/'+s.wavFile,base+'/mappings/'+s.mappingFile]))],
  }));
}

export function completeOrchestraRegions(samples) {
  return compileVelocityRegions(samples.map(s=>{
    const ops=s.sourceEffectiveOpcodes;
    const supported = new Set(['sample','lokey','hikey','pitch_keycenter','lovel','hivel','volume','tune','ampeg_attack','ampeg_release','ampeg_dynamic','seq_position','seq_length','lorand','hirand','group_label']);
    if (Object.keys(ops).some(key=>!supported.has(key)) || (ops.ampeg_dynamic !== undefined && Number(ops.ampeg_dynamic)!==1))
      throw Error('Unsupported author mapping: '+s.id);
    return {id:s.id,assetId:recordingId(s),rootMidi:s.rootMidi,keyLow:s.keyLow,keyHigh:s.keyHigh,
      velocityLow:Math.max(1,s.velocityLow),velocityHigh:s.velocityHigh,articulation:s.articulation,
      roundRobin:ops.seq_position?Number(ops.seq_position)-1:Math.round(Number(ops.lorand??0)*100),
      tuneCents:Number(ops.tune??0),gainDb:s.conversion.recommendedRegionGainDb,
      releaseSeconds:Number(ops.ampeg_release??.15),sampleOffset:0,
      envelope:{attack:Number(ops.ampeg_attack??0),decay:0,sustain:1}};
  }));
}

export async function completeOrchestraProject(job, root, {makeLayer}) {
  const assets={};
  for(const s of job.samples){
    const id=recordingId(s);if(assets[id])continue;
    const wav=await readAsset(root,`${job.base}/${s.wavFile}`);
    if(createHash('sha256').update(wav).digest('hex')!==s.wavSha256||wav.toString('ascii',36,40)!=='data'||wav.readUInt32LE(24)!==48000||wav.readUInt16LE(22)!==2||wav.readUInt16LE(34)!==16)throw Error('Invalid orchestral source '+s.id);
    const bytes=deterministicGzip(wav,{level:6}),sha256=createHash('sha256').update(bytes).digest('hex'),file=sha256+'.recording.bin';
    await writeFile(path.join(root,'public/sound-library',file),bytes);
    assets[id]={id,name:s.name,sampleRate:48000,channels:[],reference:{schema:'momo.builtin-sample/v1',file,sha256,
      frames:wav.readUInt32LE(40)/4,decodedBytes:wav.length,compressedBytes:bytes.length,assetGains:[]},
      source:{provider:'Versilian Studios',url:s.sourceUrl,author:s.author,license:s.license,licenseUrl:s.licenseUrl,quality:'original',retrievedAt:'2026-11-07T00:00:00Z'}};
  }
  const regions=completeOrchestraRegions(job.samples);
  const chosen=regions.filter(r=>r.articulation==='sustain'&&r.velocityLow<=90&&r.velocityHigh>=90).sort((a,b)=>Math.abs(a.rootMidi-60)-Math.abs(b.rootMidi-60))[0];
  if(!chosen||regions.length>512)throw Error('Invalid complete instrument '+job.id);
  const instrument={id:job.id,name:job.samples[0].instrumentName,source:'https://github.com/sgossner/VSCO-2-CE',license:'CC0-1.0',
    keyRange:{low:job.keyLow,high:job.keyHigh},regions};
  const duration=2;
  return {schema:'momo.soundforge/v4',name:job.id,seed:2048,duration,master:1,echo:0,assets,
    inputs:[makeLayer({id:job.id,name:instrument.name,type:'instrument',duration,gain:1,attack:0,release:0,decay:0,cutoff:22000,
      score:{schema:'momo.score/v1',bpm:120,instruments:[instrument],notes:[{id:'audition',instrumentId:instrument.id,midi:chosen.rootMidi,velocity:90,start:0,duration:1,articulation:chosen.articulation}]}})]};
}
