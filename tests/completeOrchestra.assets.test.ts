import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {BUILTIN_SOUNDS} from '../src/builtinLibrary';
import {projectFromGraph} from './helpers/resourceGraph';
import {selectRegion} from '../src/instruments';
import {createSamplePreparer} from '../src/prepareSamples';
import {createAudioReader,registerAudioProvider} from '../src/sharedAudio';
import {renderProject} from '../src/engine';
import {packProject,unpackProject} from '../src/resourcePackage';
const sourceRegionId=(id:string)=>id.replace(/-velocity-\d+-\d+$/,'');

const manifest=JSON.parse(readFileSync('samples/orchestra-complete-20261107/manifest.json','utf8'));
const local=async(url:string)=>new Response(readFileSync('public/sound-library/'+url.split('/').at(-1)));
const load=async(id:string)=>{
  const bank=BUILTIN_SOUNDS.find(s=>s.id==='instrument-vsco-'+id)!;
  return projectFromGraph(JSON.parse(gunzipSync(readFileSync('public/sound-library/'+bank.file)).toString()));
};

for(const id of ['solo-violin','clarinet','trombone']){
  it(`${id}: reaches every authored take and exactly the authored key/velocity/articulation coverage`,async()=>{
    const p=await load(id),score=p.inputs[0].player.score!,instrument=score.instruments[0];
    const sources=manifest.samples.filter((s:any)=>s.instrumentId===id),reached=new Set();
    expect(Object.keys(p.assets)).toHaveLength(sources.length);
    for(const asset of Object.values(p.assets))expect(asset.reference).toBeDefined();
    for(const articulation of new Set<string>(sources.map((s:any)=>s.articulation))){
      for(let midi=0;midi<128;midi++)for(let velocity=1;velocity<=127;velocity++){
        const matches=sources.filter((s:any)=>s.articulation===articulation&&midi>=s.keyLow&&midi<=s.keyHigh&&velocity>=s.velocityLow&&velocity<=s.velocityHigh);
        const note={...score.notes[0],midi,velocity,articulation},counts=new Map<string,number>(),actual=new Set();
        if(!matches.length){expect(selectRegion(instrument,note,2048,counts)).toBeUndefined();continue;}
        for(let n=0;n<matches.length;n++){
          const region=selectRegion(instrument,note,2048,counts)!;
          actual.add(sourceRegionId(region.id));reached.add(sourceRegionId(region.id));
        }
        expect(actual).toEqual(new Set(matches.map((s:any)=>s.id)));
      }
    }
    expect(reached).toEqual(new Set(sources.map((s:any)=>s.id)));
    for(const r of instrument.regions){
      const s=sources.find((s:any)=>s.id===sourceRegionId(r.id));
      expect(r.rootMidi).toBe(s.rootMidi);
      expect([r.keyLow,r.keyHigh]).toEqual([s.keyLow,s.keyHigh]);
      expect(r.sampleOffset).toBe(0);
      expect(r.tuneCents).toBe(Number(s.sourceEffectiveOpcodes.tune??0));
      expect(r.gainDb).toBe(s.conversion.recommendedRegionGainDb);
      expect(r.envelope?.attack).toBe(Number(s.sourceEffectiveOpcodes.ampeg_attack??0));
      expect(r.releaseSeconds).toBe(Number(s.sourceEffectiveOpcodes.ampeg_release??.15));
      expect(r.loop).toBeUndefined();
      expect(p.assets[r.assetId].reference!.frames).toBe(Math.round(s.durationSeconds*48000));
    }
  },30000);

  it(`${id}: renders boundary notes and every articulation without clipping and shares unused notes offline`,async()=>{
    const p=await load(id),input=p.inputs[0],score=input.player.score!,inst=score.instruments[0];
    const prepare=createSamplePreparer(local,'/'),reader=createAudioReader(local,'/');
    // Package the original one-note preview. Unused keys must remain available.
    const bytes=await packProject(p,reader);
    for(const a of Object.values(p.assets))registerAudioProvider((a.reference as {audioId:string}).audioId,async()=>{throw Error('offline');});
    const reopened=await unpackProject(bytes),offline=createSamplePreparer(async()=>{throw Error('offline');},'/');
    for(const articulation of new Set(inst.regions.map(r=>r.articulation)))for(const [midi,velocity,held] of [[inst.keyRange!.low,30,.15],[60,90,5],[inst.keyRange!.high,120,.3]]){
      score.notes=[{...score.notes[0],midi,velocity,articulation,duration:held*2}];
      if(!selectRegion(inst,score.notes[0],2048,new Map()))continue;
      p.duration=input.duration=input.player.duration=input.sourceEnd=held+1;
      reopened.inputs[0].player.score!.notes=structuredClone(score.notes);
      reopened.duration=reopened.inputs[0].duration=reopened.inputs[0].player.duration=reopened.inputs[0].sourceEnd=p.duration;
      const expected=renderProject(await prepare(p)),actual=renderProject(await offline(reopened));
      expect(expected.sourcePeak).toBeGreaterThan(.00001);expect(expected.sourcePeak).toBeLessThan(1);
      expect(actual.left).toEqual(expected.left);expect(actual.right).toEqual(expected.right);
    }
  },120000);
}
