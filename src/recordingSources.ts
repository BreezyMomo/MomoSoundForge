import { parseDefinition, type InstrumentDefinition } from "./soundDefinitions";
import { parseResource, type SoundResource } from "./soundResources";
import { uid } from "./model";
import { recordingProject } from './recordingDefinition';
import type { SampleRegion } from "./instruments";

/** One entry per actual audio asset, even when several mapping regions use it. */
export type RecordingSummary = {
  id: string;
  regionId: string;
  name: string;
  rootMidi: number;
  velocityLow: number;
  velocityHigh: number;
  articulation: string;
  variant: number;
  release?: boolean;
  unpitched?: boolean;
};

export function recordingSummaries(definition: InstrumentDefinition): RecordingSummary[] {
  const grouped = new Map<string, { region: SampleRegion; release: boolean; low: number; high: number }>();
  for (const region of definition.instrument.regions) {
    if (region.synth) continue;
    for (const [id, release] of [[region.assetId, false], [region.releaseAssetId, true]] as const) {
      if (!id || !definition.assets[id]) continue;
      const previous = grouped.get(id);
      if (previous) { previous.low = Math.min(previous.low, region.velocityLow); previous.high = Math.max(previous.high, region.velocityHigh); }
      else grouped.set(id, { region, release, low: region.velocityLow, high: region.velocityHigh });
    }
  }
  const entries = [...grouped].sort(([idA, a], [idB, b]) => a.region.rootMidi - b.region.rootMidi
    || a.low - b.low || a.high - b.high || a.region.articulation.localeCompare(b.region.articulation)
    || Number(a.release) - Number(b.release) || a.region.roundRobin - b.region.roundRobin || idA.localeCompare(idB, "en"));
  const variants = new Map<string, number>();
  return entries.map(([id, { region, release, low, high }]) => {
    const group = JSON.stringify([region.rootMidi, low, high, region.articulation, release]);
    const variant = (variants.get(group) ?? 0) + 1;
    variants.set(group, variant);
    return { id, regionId: region.id, name: definition.assets[id].name, rootMidi: region.rootMidi,
      velocityLow: low, velocityHigh: high, articulation: region.articulation, variant, ...(release ? { release: true } : {}),...(region.fixedPitch?{unpitched:true}:{}) };
  });
}

export function parseRecordingSummaries(raw: unknown): RecordingSummary[] {
  if (!Array.isArray(raw) || raw.length > 64) throw Error("resources.invalid");
  const text = (value: unknown, limit: number) => typeof value === "string" && value.length > 0 && value.length <= limit;
  const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
  const ids = new Set<string>();
  return raw.map((value: RecordingSummary) => {
    if (!value || !text(value.id, 120) || ids.has(value.id) || !text(value.regionId, 120) || !text(value.name, 120)
      || !integer(value.rootMidi, 0, 127) || !integer(value.velocityLow, 1, 127)
      || !integer(value.velocityHigh, value.velocityLow, 127) || !text(value.articulation, 60)
      || !integer(value.variant, 1, 64) || (value.release !== undefined && value.release !== true) || (value.unpitched!==undefined&&value.unpitched!==true)) throw Error("resources.invalid");
    ids.add(value.id);
    return { id: value.id, regionId: value.regionId, name: value.name, rootMidi: value.rootMidi,
      velocityLow: value.velocityLow, velocityHigh: value.velocityHigh, articulation: value.articulation,
      variant: value.variant, ...(value.release ? { release: true } : {}),...(value.unpitched?{unpitched:true}:{}) };
  });
}

/** Extract one independent recording, retaining its authored pitch and gain. */
export function recordingResource(parent: SoundResource, recordingId: string, name: string): SoundResource {
  if (parent.kind !== "instrument") throw Error("resources.invalid");
  const definition = parseDefinition(structuredClone(parent.payload)) as InstrumentDefinition;
  const summary = recordingSummaries(definition).find(r => r.id === recordingId);
  if (!summary) throw Error("resources.missing");
  const original = definition.instrument.regions.find(r => r.id === summary.regionId)!;
  const region = structuredClone(original);
  region.assetId = summary.id;
  // The source is this recording alone, rather than its performance variants.
  region.roundRobin = 0;
  delete region.releaseAssetId;
  if (summary.release) delete region.loop;
  return parseResource({ ...parent, kind:'recording', id: uid(), version: 1, name: name.slice(0, 120), preview: [],
    payload: { schema:'momo.recording/v1',asset:structuredClone(definition.assets[summary.id]),rootMidi:region.fixedPitch?null:region.rootMidi,
      tuneCents:region.tuneCents,gainDb:region.gainDb,releaseSeconds:region.releaseSeconds,...(region.loop?{loop:region.loop}:{}) } });
}

export function recordingPreview(resource: SoundResource) {
  return recordingProject(resource.payload,resource.name);
}

export function singleRecordingRegion(resource: SoundResource) {
  if (resource.kind !== "instrument") return undefined;
  const definition = resource.payload as InstrumentDefinition;
  const regions = definition.instrument.regions;
  return regions.length === 1 && !regions[0].synth ? regions[0] : undefined;
}
