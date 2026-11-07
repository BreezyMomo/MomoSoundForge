import { uid } from './model';
import { parseDefinition, type InstrumentDefinition } from './soundDefinitions';
import { sameRegionGroup, type SampleRegion } from './instruments';
import { bindInstrumentNote, playableNoteMappings, type NoteSource } from './instrumentMapping';

export function instrumentRange(d: InstrumentDefinition) {
  return d.instrument.keyRange ?? (d.instrument.regions.length
    ? { low: Math.min(...d.instrument.regions.map(r => r.keyLow)), high: Math.max(...d.instrument.regions.map(r => r.keyHigh)) }
    : { low: 60, high: 72 });
}

function checkRange(low: number, high: number) {
  if (!Number.isInteger(low) || !Number.isInteger(high) || low < 0 || high > 127 || high < low) throw Error('instrument.invalidRange');
}

export function setInstrumentRange(d: InstrumentDefinition, low: number, high: number): InstrumentDefinition {
  checkRange(low, high);
  if (d.instrument.regions.some(r => r.keyLow < low || r.keyHigh > high)) throw Error('instrument.rangeHasSources');
  return { ...d, instrument: { ...d.instrument, keyRange: { low, high } } };
}

/** Localize the audible settings before editing one note. Shared neighboring keys stay intact. */
function localize(d: InstrumentDefinition, midi: number) {
  const source = playableNoteMappings(d, midi), groups: { original: SampleRegion; id: string }[] = [];
  checkOverlaps(source);
  const copies = source.map(r => {
    let group = groups.find(g => g.original.articulation === r.articulation && sameRegionGroup(g.original, r));
    if (!group) { group = { original: r, id: uid() }; groups.push(group); }
    return { ...r, id: r.keyLow === midi && r.keyHigh === midi ? r.id : uid(), keyLow: midi, keyHigh: midi, playbackGroup: group.id };
  });
  return { source, copies, definition: { ...d, instrument: { ...d.instrument,
    regions: [...d.instrument.regions.filter(r => r.keyLow !== midi || r.keyHigh !== midi), ...copies] } } };
}

function clean(d: InstrumentDefinition) { return parseDefinition(structuredClone(d)) as InstrumentDefinition; }

export function missingVelocities(regions: SampleRegion[], articulation: string) {
  const styled = regions.filter(r => r.articulation === articulation);
  const gaps: { low: number; high: number }[] = [];
  for (let velocity = 1; velocity <= 127; velocity++) {
    if (styled.some(r => velocity >= r.velocityLow && velocity <= r.velocityHigh)) continue;
    const last = gaps.at(-1);
    if (last && last.high === velocity - 1) last.high = velocity;
    else gaps.push({ low: velocity, high: velocity });
  }
  return gaps.map(g => g.low === g.high ? `${g.low}` : `${g.low}–${g.high}`).join(', ');
}

// Ambiguous imported mappings need explicit editing, not a copy whose priority changes with pitch.
function checkOverlaps(regions: SampleRegion[]) {
  for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
    const a = regions[i], b = regions[j];
    if (a.articulation === b.articulation && Math.max(a.velocityLow, b.velocityLow) <= Math.min(a.velocityHigh, b.velocityHigh)
      && !sameRegionGroup(a, b)) throw Error('instrument.overlappingSettings');
  }
}

export type InstrumentVariant = { type: 'take' } | { type: 'strength'; split: number } | { type: 'style'; name: string };

/** Add a source atomically: cancelling the picker never leaves a half-created velocity split. */
export function addInstrumentVariant(d: InstrumentDefinition, midi: number, settingId: string, action: InstrumentVariant, source: NoteSource) {
  const local = localize(d, midi), index = local.source.findIndex(r => r.id === settingId);
  if (index < 0) throw Error('error.scopeChanged');
  const selected = local.copies[index];
  let added: SampleRegion;
  if (action.type === 'style') {
    const name = action.name.trim();
    if (!name || name.length > 60) throw Error('instrument.styleRequired');
    if (local.source.some(r => r.articulation === name)) throw Error('instrument.styleExists');
    added = { ...selected, id: uid(), articulation: name, velocityLow: 1, velocityHigh: 127, roundRobin: 0, playbackGroup: uid() };
  } else {
    const peers = local.copies.filter(r => r.articulation === selected.articulation && sameRegionGroup(r, selected));
    if (action.type === 'take') {
      if (Math.max(...peers.map(r => r.roundRobin)) >= 127) throw Error('instrument.tooManyTakes');
      added = { ...selected, id: uid(), roundRobin: Math.max(...peers.map(r => r.roundRobin)) + 1 };
    } else {
      if (!Number.isInteger(action.split) || action.split < selected.velocityLow || action.split >= selected.velocityHigh) throw Error('instrument.invalidSplit');
      const high = selected.velocityHigh;
      for (const r of peers) r.velocityHigh = action.split;
      added = { ...selected, id: uid(), velocityLow: action.split + 1, velocityHigh: high, roundRobin: 0, playbackGroup: uid() };
    }
  }
  local.definition.instrument.regions.push(added);
  return bindInstrumentNote(local.definition, midi, source, added.id);
}

export function setNotePlayback(d: InstrumentDefinition, midi: number, settingId: string, playback: 'gate' | 'one-shot') {
  const local = localize(d, midi), index = local.source.findIndex(r => r.id === settingId);
  if (index < 0 || local.copies[index].synth) throw Error('error.scopeChanged');
  local.copies[index].playback = playback;
  return clean(local.definition);
}

/** Copy the note's full performance set into empty keys only, compacting contiguous runs. */
export function fillInstrumentRange(d: InstrumentDefinition, midi: number, low: number, high: number) {
  checkRange(low, high);
  const range = instrumentRange(d);
  if (low < range.low || high > range.high) throw Error('instrument.invalidRange');
  const templates = playableNoteMappings(d, midi);
  if (!templates.length) throw Error('resources.unmapped');
  checkOverlaps(templates);
  const runs: { low: number; high: number }[] = [];
  for (let key = low; key <= high; key++) {
    if (playableNoteMappings(d, key).length) continue;
    const last = runs.at(-1);
    if (last && last.high === key - 1) last.high = key;
    else runs.push({ low: key, high: key });
  }
  if (!runs.length) throw Error('instrument.noEmptyNotes');
  const copies = runs.flatMap(run => {
    const groups: { original: SampleRegion; id: string }[] = [];
    return templates.map(r => {
      let group = groups.find(g => g.original.articulation === r.articulation && sameRegionGroup(g.original, r));
      if (!group) { group = { original: r, id: uid() }; groups.push(group); }
      return { ...r, id: uid(), keyLow: run.low, keyHigh: run.high, playbackGroup: group.id };
    });
  });
  return clean({ ...d, instrument: { ...d.instrument, regions: [...d.instrument.regions, ...copies] } });
}
