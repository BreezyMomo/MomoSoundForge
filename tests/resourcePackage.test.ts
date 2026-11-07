import {expect,it} from 'vitest';
import JSZip from 'jszip';
import {makeProject,makeLayer,encodeSamples} from '../src/model';
import {resourceFromDefinition,resourceFromProject} from '../src/soundResources';
import {BASIC_SYNTH} from '../src/synthesizers';
import {packProject,unpackProject,packResource} from '../src/resourcePackage';
import {sealResource,openResourceGraph} from '../src/resourceGraph';
import {prepareProjectSamples} from '../src/prepareSamples';
import {renderProject} from '../src/engine';

it('seals immutable definitions independently of their names and creates new IDs for sound changes',async()=>{
  const r=resourceFromDefinition(BASIC_SYNTH),a=await sealResource(r,async()=>{});
  const b=await sealResource({...r,name:'Renamed',description:'A different description'},async()=>{});
  expect(b.root).toBe(a.root);expect((await openResourceGraph(b)).resource.name).toBe('Renamed');
  const changed=resourceFromDefinition({...BASIC_SYNTH,defaults:{...BASIC_SYNTH.defaults,frequency:440}});
  expect((await sealResource(changed,async()=>{})).root).not.toBe(a.root);
  const corrupted=structuredClone(a);corrupted.objects[a.root].value.algorithm='other';
  await expect(openResourceGraph(corrupted)).rejects.toThrow('resources.verify');
});
function fixture(){
  const p=makeProject('Offline keys');p.duration=1;
  const channels=[encodeSamples(Float32Array.from({length:8000},(_,i)=>Math.sin(i*.3)*.2))];
  p.assets={a:{id:'a',name:'A.wav',sampleRate:8000,channels},b:{id:'b',name:'Same recording.wav',sampleRate:8000,channels:[...channels]}};
  const region={id:'a',assetId:'a',rootMidi:60,keyLow:60,keyHigh:60,velocityLow:1,velocityHigh:127,articulation:'sustain',roundRobin:0,tuneCents:0,gainDb:0,releaseSeconds:.1};
  p.inputs=[makeLayer({type:'instrument',score:{schema:'momo.score/v1',bpm:120,instruments:[{id:'keys',name:'Keys',regions:[region,{...region,id:'b',assetId:'b',rootMidi:61,keyLow:61,keyHigh:61}]}],notes:[{id:'note',instrumentId:'keys',midi:60,start:0,duration:1,velocity:80,articulation:'sustain'}]}})];return p;
}
it('packs each complete audio once, preserves PCM, and plays a previously unused key offline',async()=>{
  const p=fixture(),before=structuredClone(p),bytes=await packProject(p),zip=await JSZip.loadAsync(bytes);
  expect(Object.keys(zip.files).filter(k=>k.endsWith('.pcm.gz'))).toHaveLength(1);
  const reopened=await unpackProject(bytes);expect(Object.values(reopened.assets).every(a=>a.channels.length===0)).toBe(true);
  expect(renderProject(await prepareProjectSamples(reopened),8000).left).toEqual(renderProject(p,8000).left);
  reopened.inputs[0].player.score!.notes[0].midi=61;p.inputs[0].player.score!.notes[0].midi=61;
  expect(renderProject(await prepareProjectSamples(reopened),8000).left).toEqual(renderProject(p,8000).left);
  expect(before.inputs[0].player.score!.notes[0].midi).toBe(60);
  // A missing dependency and an audio ID/content conflict both reject the whole package.
  const audioName=Object.keys(zip.files).find(k=>k.endsWith('.pcm.gz'))!;
  zip.remove(audioName);await expect(unpackProject(await zip.generateAsync({type:'uint8array'}))).rejects.toThrow();
  const damaged=await JSZip.loadAsync(bytes);const {compressAudio,decompressAudio}=await import('../src/sharedAudio');const audio=await decompressAudio(await damaged.file(audioName)!.async('uint8array'));audio[audio.length-1]^=1;damaged.file(audioName,await compressAudio(audio));
  await expect(unpackProject(await damaged.generateAsync({type:'uint8array'}))).rejects.toThrow('resources.verify');
});
it('keeps metadata out of sound identity without discarding attribution or allowing it to overwrite sound data',async()=>{
  const p=fixture(),a=await sealResource(resourceFromProject(p),async()=>{});
  p.name='New name';p.assets.a.name='New file name';
  const b=await sealResource(resourceFromProject(p),async()=>{});expect(a.root).toBe(b.root);
  const bad=structuredClone(a);bad.annotations['']={schema:'different'};
  await expect(openResourceGraph(bad)).rejects.toThrow();
  expect((await packResource(resourceFromDefinition(BASIC_SYNTH))).length).toBeGreaterThan(0);
});
it('changes an instrument content ID when the recording behind an unchanged local binding changes',async()=>{
  const p=fixture(),a=await sealResource(resourceFromProject(p),async()=>{});
  p.assets.a.channels=[encodeSamples(new Float32Array(8000).fill(.3))];
  const b=await sealResource(resourceFromProject(p),async()=>{});
  expect(Object.keys(a.objects).filter(k=>k.startsWith('instrument-'))).not.toEqual(Object.keys(b.objects).filter(k=>k.startsWith('instrument-')));
  const r=await openResourceGraph(b);expect(r.audio.size).toBe(2);
});
