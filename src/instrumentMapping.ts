import { encodeSamples, uid, type Project, type RenderResult } from "./model";
import { parseDefinition, type InstrumentDefinition } from "./soundDefinitions";
import { compareNoteRegions, type SampleRegion } from "./instruments";
import type { SynthDefinition } from "./synthesizers";
import { parseResource, resourceProject, type SoundResource } from "./soundResources";
import { singleRecordingRegion } from "./recordingSources";
import type { RecordingDefinition } from './recordingDefinition';

export type NoteSource = { type: "recording"; assetId: string; rootMidi?:number; fixedPitch?:boolean; tuneCents?:number; gainDb?:number; releaseSeconds?:number; loop?:SampleRegion['loop'] } | { type: "synth"; synth: SynthDefinition };

/** Musical sounds reuse the same render as preview/export; synths remain generators. */
export async function instrumentSource(resource: SoundResource, render: (project: Project) => Promise<RenderResult>) {
  const clean = parseResource(structuredClone(resource));
  if(clean.kind==='recording'){
    const d=clean.payload as RecordingDefinition,id=uid();
    return {source:{type:'recording',assetId:id,...(d.rootMidi!==null?{rootMidi:d.rootMidi}:{fixedPitch:true}),tuneCents:d.tuneCents,gainDb:d.gainDb,
      releaseSeconds:d.releaseSeconds,...(d.loop?{loop:structuredClone(d.loop)}:{})} as NoteSource,
      assets:{[id]:{...structuredClone(d.asset),id,name:clean.name}} as Project['assets']};
  }
  if (clean.kind === "instrument") {
    const region=singleRecordingRegion(clean);
    if(!region)throw Error("instrument.invalidSource");
    const definition=clean.payload as InstrumentDefinition;
    const id=uid(),asset=structuredClone(definition.assets[region.assetId]);
    return {source:{type:'recording',assetId:id,rootMidi:region.rootMidi,tuneCents:region.tuneCents,gainDb:region.gainDb,
      releaseSeconds:region.releaseSeconds,...(region.loop?{loop:structuredClone(region.loop)}:{})} as NoteSource,
      assets:{[id]:{...asset,id}} as Project['assets']};
  }
  if (clean.kind === "synth") return { source: { type: "synth", synth: clean.payload as SynthDefinition } as NoteSource, assets: {} as Project["assets"] };
  const audio = await render(resourceProject(clean));
  const id = uid();
  return { source: { type: "recording", assetId: id } as NoteSource,
    assets: { [id]: { id, name: clean.name, sampleRate: audio.sampleRate,
      channels: [encodeSamples(audio.left), encodeSamples(audio.right)] } } as Project["assets"] };
}

export function noteMappings(definition: InstrumentDefinition, midi: number) {
  return definition.instrument.regions.filter(r => midi >= r.keyLow && midi <= r.keyHigh)
    .sort((a, b) => compareNoteRegions(midi, a, b));
}

/** A basic assignment changes one key. Shared ranges and other performance variants survive. */
export function bindInstrumentNote(definition: InstrumentDefinition, midi: number, source: NoteSource, selectedId?: string): InstrumentDefinition {
  const previous = definition.instrument.regions.find(r => r.id === selectedId) ?? noteMappings(definition, midi)[0];
  const selected = previous?.keyLow === midi && previous.keyHigh === midi ? previous : undefined;
  const id = selected?.id ?? uid();
  const defaults: SampleRegion = { id, assetId: "", rootMidi: midi, keyLow: midi, keyHigh: midi,
    velocityLow: 1, velocityHigh: 127, articulation: previous?.articulation ?? "sustain", roundRobin: 0,
    tuneCents: 0, gainDb: 0, releaseSeconds: 0.15 };
  // Loops, release recordings and generator values belong to the previous sound source.
  const { assetId: _asset, synth: _synth, synthValues: _values, loop: _loop, releaseAssetId: _release, fixedPitch:_fixed, ...settings } = selected ?? defaults;
  const region: SampleRegion = { ...settings, id, rootMidi: midi, keyLow: midi, keyHigh: midi,
    ...(source.type === "synth" ? { assetId: "", synth: structuredClone(source.synth) } : {
      assetId:source.assetId,rootMidi:source.rootMidi??midi,
      ...(source.fixedPitch?{fixedPitch:true}:{}),
      ...(source.tuneCents!==undefined?{tuneCents:source.tuneCents}:{}),...(source.gainDb!==undefined?{gainDb:source.gainDb}:{}),
      ...(source.releaseSeconds!==undefined?{releaseSeconds:source.releaseSeconds}:{}),...(source.loop?{loop:structuredClone(source.loop)}:{}) }) };
  const candidate: InstrumentDefinition = { ...definition, instrument: { ...definition.instrument,
    regions: selected ? definition.instrument.regions.map(r => r.id === id ? region : r) : [...definition.instrument.regions, region] } };
  const used = new Set(candidate.instrument.regions.flatMap(r => [r.assetId, r.releaseAssetId].filter(Boolean)));
  candidate.assets = Object.fromEntries(Object.entries(candidate.assets).filter(([key]) => used.has(key)));
  return parseDefinition(structuredClone(candidate)) as InstrumentDefinition;
}
