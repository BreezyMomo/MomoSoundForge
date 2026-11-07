import { expect, it } from 'vitest';
import { addInstrumentVariant, fillInstrumentRange, instrumentRange, missingVelocities, setInstrumentRange, setNotePlayback } from '../src/instrumentEditing';
import { playableNoteMappings } from '../src/instrumentMapping';
import { selectRegion, renderScore, noteEndSeconds, scoreIssues, type NoteEvent } from '../src/instruments';
import { BASIC_SYNTH } from '../src/synthesizers';
import { definitionProject, parseDefinition, type InstrumentDefinition } from '../src/soundDefinitions';
import { encodeSamples, parseProject, projectDocument } from '../src/model';

const source = { type: 'synth' as const, synth: { ...BASIC_SYNTH, name: 'New sound' } };
function definition(): InstrumentDefinition {
  return { schema: 'momo.instrument/v1', assets: {}, instrument: { id: 'i', name: 'Instrument', keyRange: { low: 60, high: 72 }, regions: [
    { id: 'a', assetId: '', synth: structuredClone(BASIC_SYNTH), synthValues: {}, rootMidi: 60, keyLow: 60, keyHigh: 62,
      velocityLow: 1, velocityHigh: 127, articulation: 'sustain', roundRobin: 0, tuneCents: 0, gainDb: 0, releaseSeconds: .05 },
  ] } };
}
const note = (midi = 60, velocity = 100, articulation = 'sustain'): NoteEvent => ({ id: 'n', instrumentId: 'i', midi, velocity, articulation, start: 0, duration: .1 });
const chosen = (d: InstrumentDefinition, midi = 60, velocity = 100, articulation = 'sustain') => selectRegion(d.instrument, note(midi, velocity, articulation), 42, new Map());

it('keeps a deliberate range with unassigned notes through project serialization and rejects destructive narrowing', () => {
  const d = definition();
  expect(instrumentRange(d)).toEqual({ low: 60, high: 72 });
  expect(() => setInstrumentRange(d, 61, 72)).toThrow('instrument.rangeHasSources');
  expect(() => setInstrumentRange(d, 70, 60)).toThrow('instrument.invalidRange');
  const wide = setInstrumentRange(d, 48, 84);
  const reopened = parseProject(projectDocument(definitionProject(wide)));
  expect(reopened.inputs[0].player.score!.instruments[0].keyRange).toEqual({ low: 48, high: 84 });
  expect(chosen(wide, 70)).toBeUndefined();
  expect(setInstrumentRange({ ...d, instrument: { ...d.instrument, regions: [] } }, 60, 64).instrument.regions).toEqual([]);
  expect(() => parseDefinition({ ...d, instrument: { ...d.instrument, keyRange: null } })).toThrow();
});

it('splits a velocity band atomically, keeps all softer takes and preserves neighboring notes', () => {
  const d = definition();
  d.instrument.regions.push({ ...d.instrument.regions[0], id: 'b', roundRobin: 1 });
  const before = structuredClone(d);
  const next = addInstrumentVariant(d, 60, 'a', { type: 'strength', split: 63 }, source);
  expect(d).toEqual(before);
  expect(playableNoteMappings(next, 60)).toHaveLength(3);
  for (let velocity = 1; velocity <= 127; velocity++) {
    expect(chosen(next, 60, velocity)?.synth?.name).toBe(velocity <= 63 ? BASIC_SYNTH.name : 'New sound');
    expect(chosen(next, 61, velocity)).toEqual(chosen(d, 61, velocity));
  }
  const counts = new Map<string, number>();
  expect(new Set(Array.from({ length: 4 }, () => selectRegion(next.instrument, note(60, 30), 42, counts)?.roundRobin))).toEqual(new Set([0, 1]));
  expect(() => addInstrumentVariant(d, 60, 'a', { type: 'strength', split: 127 }, source)).toThrow('instrument.invalidSplit');
});

it('adds named styles and alternating takes without replacing the current performance', () => {
  const d = definition();
  const styled = addInstrumentVariant(d, 60, 'a', { type: 'style', name: ' 拨弦 ' }, source);
  expect(chosen(styled)?.synth?.name).toBe(BASIC_SYNTH.name);
  expect(chosen(styled, 60, 1, '拨弦')?.synth?.name).toBe('New sound');
  expect(chosen(styled, 61, 127, '拨弦')).toBeUndefined();
  expect(() => addInstrumentVariant(styled, 60, playableNoteMappings(styled, 60)[0].id, { type: 'style', name: '拨弦' }, source)).toThrow('instrument.styleExists');
  const next = addInstrumentVariant(d, 60, 'a', { type: 'take' }, source), counts = new Map<string, number>();
  const sounds = Array.from({ length: 4 }, () => selectRegion(next.instrument, note(), 42, counts)?.synth?.name);
  expect(new Set(sounds)).toEqual(new Set([BASIC_SYNTH.name, 'New sound']));
  expect(sounds[0]).toBe(sounds[2]);
  expect(chosen(next, 61)).toEqual(chosen(d, 61));
});

it('fills only empty notes, preserves all variants, compacts ranges and never duplicates audio', () => {
  const d = definition();
  const variants = addInstrumentVariant(d, 60, 'a', { type: 'strength', split: 63 }, source);
  const filled = fillInstrumentRange(variants, 60, 60, 72);
  expect(filled.instrument.regions.length - variants.instrument.regions.length).toBe(2);
  for (const midi of [63, 64, 72]) for (const velocity of [1, 63, 64, 127]) {
    expect(chosen(filled, midi, velocity)?.synth?.name).toBe(chosen(variants, 60, velocity)?.synth?.name);
  }
  expect(chosen(filled, 61)).toEqual(chosen(variants, 61));
  expect(filled.assets).toEqual(variants.assets);
  expect(() => fillInstrumentRange(filled, 60, 60, 72)).toThrow('instrument.noEmptyNotes');
  expect(() => fillInstrumentRange(filled, 60, 60, 80)).toThrow('instrument.invalidRange');
});

it('keeps recording roots and fixed pitch while filling a range and obeys the existing region budget', () => {
  const d = definition();
  d.assets = { a: { id: 'a', name: 'A', sampleRate: 8000, channels: [encodeSamples(new Float32Array(8000).fill(.1))] } };
  d.instrument.regions = [{ ...d.instrument.regions[0], assetId: 'a', synth: undefined, rootMidi: 60, fixedPitch: true }];
  const filled = fillInstrumentRange(d, 60, 60, 72);
  expect(Object.keys(filled.assets)).toEqual(['a']);
  expect(chosen(filled, 72)).toMatchObject({ rootMidi: 60, fixedPitch: true, assetId: 'a' });
  const over = definition();
  over.instrument.regions = Array.from({ length: 128 }, (_, i) => ({ ...over.instrument.regions[0], id: `r${i}`, roundRobin: i }));
  expect(() => addInstrumentVariant(over, 60, 'r0', { type: 'style', name: 'new' }, source)).toThrow('score.invalid');
});

it('one-shot audio ignores note-off, keeps full duration and reports clipping instead of a false sustain warning', () => {
  const d = definition();
  d.assets = { a: { id: 'a', name: 'Hit', sampleRate: 8000, channels: [encodeSamples(new Float32Array(8000).fill(.2))] } };
  d.instrument.regions = [{ ...d.instrument.regions[0], assetId: 'a', synth: undefined }];
  const next = setNotePlayback(d, 60, 'a', 'one-shot');
  expect(chosen(next)?.playback).toBe('one-shot');
  expect(chosen(next, 61)?.playback).toBeUndefined();
  const score = { schema: 'momo.score/v1' as const, bpm: 120, instruments: [next.instrument], notes: [note()] };
  const audio = renderScore(score, next.assets, 1.2, 8000, 42).left;
  expect(audio[4000]).toBeGreaterThan(.1);
  expect(audio[8100]).toBe(0);
  expect(noteEndSeconds(note(), chosen(next), next.assets, 120)).toBe(1);
  expect(scoreIssues({ ...score, notes: [{ ...note(), duration: 8 }] }, next.assets, 1.2)).toEqual([]);
  expect(scoreIssues(score, next.assets, .5).map(i => i.key)).toEqual(['score.tailClipped']);
  const gated = setNotePlayback(next, 60, chosen(next)!.id, 'gate');
  expect(renderScore({ ...score, instruments: [gated.instrument] }, gated.assets, 1.2, 8000, 42).left[4000]).toBe(0);
  expect(parseProject(projectDocument(definitionProject(next))).inputs[0].player.score!.instruments[0].regions).toEqual(next.instrument.regions);
});

it('reports gaps per playing style and refuses ambiguous overlapping mappings when copying', () => {
  const d = definition(), r = d.instrument.regions[0];
  d.instrument.regions = [{ ...r, velocityLow: 20, velocityHigh: 60 }, { ...r, id: 'b', velocityLow: 64, velocityHigh: 100 },
    { ...r, id: 'c', articulation: 'short' }];
  expect(missingVelocities(d.instrument.regions, 'sustain')).toBe('1–19, 61–63, 101–127');
  expect(missingVelocities(d.instrument.regions, 'short')).toBe('');
  d.instrument.regions[1].velocityLow = 50;
  expect(() => fillInstrumentRange(d, 60, 60, 72)).toThrow('instrument.overlappingSettings');
});

it('one-shot bypasses loops and release recordings without deleting them, and synths cannot select it', () => {
  const d = definition();
  d.assets = { a: { id: 'a', name: 'Hit', sampleRate: 8000, channels: [encodeSamples(new Float32Array(24000).fill(.2))] },
    release: { id: 'release', name: 'Release', sampleRate: 8000, channels: [encodeSamples(new Float32Array(800).fill(-.2))] } };
  d.instrument.regions = [{ ...d.instrument.regions[0], synth: undefined, assetId: 'a', releaseAssetId: 'release',
    loop: { start: 0, end: 800, crossfade: 32, verified: true } }];
  const next = setNotePlayback(d, 60, 'a', 'one-shot'), region = chosen(next)!;
  expect(region.loop).toEqual(d.instrument.regions[0].loop);
  expect(region.releaseAssetId).toBe('release');
  const project = definitionProject(next, true);
  // The first shared mapping is still gated; explicitly preview the one-shot mapping.
  const isolated = { ...next, instrument: { ...next.instrument, regions: [region] } };
  expect(definitionProject(isolated, true).duration).toBe(3);
  const score = { ...project.inputs[0].player.score!, notes: [note()] };
  const audio = renderScore(score, next.assets, 3.1, 8000, 42).left;
  expect(audio[500]).toBeCloseTo(.2 * 100 / 127, 5);
  expect(audio[16000]).toBeCloseTo(.2 * 100 / 127, 5);
  expect(audio[24100]).toBe(0);
  const synth = definition(); synth.instrument.regions[0].playback = 'one-shot';
  expect(() => parseDefinition(synth)).toThrow('score.invalid');
});
