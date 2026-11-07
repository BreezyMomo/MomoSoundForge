import { parseDefinition } from './soundDefinitions';
import { decodeSamples, makeLayer, makeProject, parseProject, type SampleAsset } from './model';
import type { SampleRegion } from './instruments';
import { sampleFrames } from './sampleReference';

export type RecordingDefinition = {
  schema: 'momo.recording/v1'; asset: SampleAsset; rootMidi: number | null;
  tuneCents: number; gainDb: number; releaseSeconds: number; loop?: SampleRegion['loop'];
};

export function parseRecording(raw: unknown): RecordingDefinition {
  const d = raw as RecordingDefinition;
  if (!d || d.schema !== 'momo.recording/v1' || !d.asset ||
      (d.loop!==undefined&&(!d.loop||typeof d.loop!=='object')) ||
      (d.rootMidi !== null && (!Number.isInteger(d.rootMidi) || d.rootMidi < 0 || d.rootMidi > 127))) throw Error('resources.invalid');
  // Reuse the engine's asset, tuning, gain and verified-loop validation.
  const definition = parseDefinition({schema:'momo.instrument/v1',assets:{[d.asset.id]:d.asset},instrument:{id:'recording',name:'Recording',regions:[{
    id:'recording',assetId:d.asset.id,rootMidi:d.rootMidi??60,keyLow:0,keyHigh:127,velocityLow:1,velocityHigh:127,
    articulation:'sustain',roundRobin:0,tuneCents:d.tuneCents,gainDb:d.gainDb,releaseSeconds:d.releaseSeconds,
    ...(d.loop?{loop:d.loop}:{}),
  }]}});
  if(definition.schema!=='momo.instrument/v1')throw Error('resources.invalid');
  const region=definition.instrument.regions[0];
  return {schema:d.schema,asset:definition.assets[d.asset.id],rootMidi:d.rootMidi,tuneCents:region.tuneCents,
    gainDb:region.gainDb,releaseSeconds:region.releaseSeconds,...(region.loop?{loop:region.loop}:{})};
}

/** A recording always previews its own complete audio, without an instrument performance. */
export function recordingProject(raw: unknown, name: string) {
  const d=parseRecording(raw),p=makeProject(name);
  const duration=sampleFrames(d.asset)/d.asset.sampleRate;
  const amplitude=10**(d.gainDb/20),gain=Math.min(1.5,amplitude),level=Math.min(8,Math.max(1,amplitude/1.5));
  p.master=amplitude/(gain*level);
  p.assets={[d.asset.id]:structuredClone(d.asset)};
  p.inputs=[makeLayer({name,type:'sample',assetId:d.asset.id,player:{duration:Math.max(.01,duration)},
    speed:2**(d.tuneCents/1200),gain,level,attack:0,release:0,decay:0,cutoff:22000})];
  p.duration=Math.max(.1,p.inputs[0].duration);
  return parseProject(p);
}
