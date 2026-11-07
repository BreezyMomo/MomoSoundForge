import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileVelocityRegions, sourceRegionId } from '../tools/builtin-velocity-regions.mjs';
import { selectRegion } from '../src/instruments';

const region = (id, low, high, roundRobin = 0) => ({ id, rootMidi: 24, keyLow: 24, keyHigh: 27,
  articulation: 'hit', velocityLow: low, velocityHigh: high, roundRobin });

it('keeps every eligible original take reachable at every velocity, including mismatched alternate bands', () => {
  const original = [region('soft-a', 1, 80), region('hard-a', 81, 127), region('soft-b', 1, 60, 50),
    region('mid-b', 61, 110, 50), region('hard-b', 111, 127, 50)];
  const snapshot = structuredClone(original), compiled = compileVelocityRegions(original);
  for (let velocity = 1; velocity <= 127; velocity++) {
    const expected = original.filter(r => velocity >= r.velocityLow && velocity <= r.velocityHigh).map(r => r.id).sort();
    const occurrences = new Map(), inst = { id: 'i', regions: compiled }, note = { midi: 24, velocity, articulation: 'hit' };
    const sequence = Array.from({ length: expected.length * 2 }, () => sourceRegionId(selectRegion(inst, note, 2048, occurrences).id));
    expect([...new Set(sequence)].sort()).toEqual(expected);
    expect(sequence.slice(0, expected.length)).toEqual(sequence.slice(expected.length));
  }
  expect(original).toEqual(snapshot);
  expect(new Set(compiled.map(r => r.id)).size).toBe(compiled.length);
});

it('does not change already aligned ranges, gaps, or unrelated root and articulation groups', () => {
  const aligned = [region('a', 1, 63), region('b', 1, 63, 1), region('c', 65, 127),
    { ...region('other', 1, 80), rootMidi: 25 }, { ...region('style', 1, 40), articulation: 'other' }];
  expect(compileVelocityRegions(aligned)).toEqual(aligned);
  expect(selectRegion({ id: 'i', regions: aligned.slice(0, 3) }, { midi: 24, velocity: 64, articulation: 'hit' }, 1, new Map())).toBeUndefined();
});

it('restores the three diagnosed author mappings without adding or removing source recordings', () => {
  const manifest = JSON.parse(readFileSync('samples/orchestra-expanded-20261105/manifest.json', 'utf8'));
  for (const id of ['upright-piano-vsupright1-001', 'upright-piano-vsupright1-008', 'french-horn-fhornstac-038']) {
    const source = manifest.samples.find(r => r.id === id);
    const original = manifest.samples.filter(r => r.instrumentId === source.instrumentId && r.articulation === source.articulation && r.rootMidi === source.rootMidi)
      .map(r => ({ ...r, velocityLow: Math.max(1, r.velocityLow), roundRobin: Math.round((r.roundRobin.randomLow ?? 0) * 100) }));
    const regions = compileVelocityRegions(original), reached = new Set();
    for (let velocity = 1; velocity <= 127; velocity++) {
      const occurrences = new Map();
      for (let n = 0; n < original.length * 2; n++) {
        const selected = selectRegion({ id: 'test', regions }, { midi: source.rootMidi, velocity, articulation: source.articulation }, 2048, occurrences);
        if (selected) reached.add(sourceRegionId(selected.id));
      }
    }
    expect(reached.has(id)).toBe(true);
    expect(reached).toEqual(new Set(original.map(r => r.id)));
  }
});
