import { describe, expect, it } from 'vitest';
import { localizedArticulationName, validateArticulationNames } from '../src/articulationNames';
import { validateScore, type Score } from '../src/instruments';
import { encodeSamples } from '../src/model';
import { resourceFromDefinition } from '../src/soundResources';
import { type InstrumentDefinition } from '../src/soundDefinitions';
import { sealResource, openResourceGraph } from '../src/resourceGraph';
import { packResource, unpackResource } from '../src/resourcePackage';

function definition(): InstrumentDefinition {
  return {
    schema: 'momo.instrument/v1',
    assets: { sample: { id: 'sample', name: 'Authored recording', sampleRate: 8000,
      channels: [encodeSamples(new Float32Array(4000).fill(.1))] } },
    instrument: {
      id: 'instrument', name: 'User-named instrument',
      regions: [{ id: 'region', assetId: 'sample', rootMidi: 60, keyLow: 60, keyHigh: 60,
        velocityLow: 1, velocityHigh: 127, articulation: 'soft-mallet', roundRobin: 0,
        tuneCents: 0, gainDb: 0, releaseSeconds: .1 }],
    },
  };
}

describe('resource-supplied articulation labels', () => {
  it('selects a display language without changing user names or articulation IDs', () => {
    const d = definition();
    d.instrument.articulationNames = { 'soft-mallet': { zh: '软槌', en: 'Soft mallet' } };
    const before = structuredClone(d.instrument);
    expect(localizedArticulationName('soft-mallet', d.instrument.articulationNames, 'zh-CN')).toBe('软槌');
    expect(localizedArticulationName('soft-mallet', d.instrument.articulationNames, 'en')).toBe('Soft mallet');
    expect(localizedArticulationName('custom user name', d.instrument.articulationNames, 'en')).toBe('custom user name');
    expect(localizedArticulationName('sustain', d.instrument.articulationNames, 'zh-CN', () => '长音')).toBe('长音');
    expect(d.instrument).toEqual(before);
  });

  it.each([
    null, [], 'labels',
    { style: { zh: '软槌' } },
    { style: { zh: '', en: 'Soft mallet' } },
    { style: { zh: '软槌', en: 10 } },
    { style: { zh: '软槌', en: 'Soft mallet', extra: 'unbounded' } },
    { ['a'.repeat(61)]: { zh: '软槌', en: 'Soft mallet' } },
    { style: { zh: '软槌', en: 'a'.repeat(121) } },
    Object.fromEntries(Array.from({ length: 513 }, (_, i) => [`style-${i}`, { zh: '软槌', en: 'Soft mallet' }])),
    JSON.parse('{"__proto__":{"zh":"软槌","en":"Soft mallet"}}'),
  ])('rejects malformed or excessive labels from external resources (%#)', raw => {
    expect(() => validateArticulationNames(raw)).toThrow('score.invalid');
    const d = definition();
    const score = { schema: 'momo.score/v1', bpm: 120, notes: [], instruments: [
      { ...d.instrument, articulationNames: raw },
    ] } as unknown as Score;
    expect(() => validateScore(score, d.assets)).toThrow('score.invalid');
  });

  it('keeps localized labels outside sound identity and preserves them on complete package reopen', async () => {
    const d = definition();
    const plain = await sealResource(resourceFromDefinition(d, 'label-fixture'), async () => {});
    d.instrument.articulationNames = { 'soft-mallet': { zh: '软槌', en: 'Soft mallet' } };
    const labeled = await sealResource(resourceFromDefinition(d, 'label-fixture'), async () => {});
    expect(labeled.root).toBe(plain.root);
    expect(labeled.objects).toEqual(plain.objects);
    expect(Object.values(labeled.annotations).some(value => value.articulationNames)).toBe(true);
    const renamed = structuredClone(d);
    renamed.instrument.articulationNames!['soft-mallet'].zh = '柔软槌击';
    const graph = await sealResource(resourceFromDefinition(renamed, 'label-fixture'), async () => {});
    expect(graph.root).toBe(labeled.root);
    const opened = await openResourceGraph(graph);
    expect((opened.resource.payload as InstrumentDefinition).instrument.articulationNames).toEqual(renamed.instrument.articulationNames);
    const packaged = await packResource(resourceFromDefinition(d, 'label-fixture'));
    const reopened = await unpackResource(packaged);
    expect((reopened.payload as InstrumentDefinition).instrument).toEqual(d.instrument);
  });

  it('rejects malformed label annotations and labels attached to non-instrument objects', async () => {
    const d = definition();
    d.instrument.articulationNames = { 'soft-mallet': { zh: '软槌', en: 'Soft mallet' } };
    const graph = await sealResource(resourceFromDefinition(d, 'label-fixture'), async () => {});
    const path = Object.keys(graph.annotations).find(key => graph.annotations[key].articulationNames)!;
    const invalid = structuredClone(graph);
    invalid.annotations[path].articulationNames = { 'soft-mallet': { zh: '软槌', en: '' } };
    await expect(openResourceGraph(invalid)).rejects.toThrow('resources.invalid');
    const misplaced = structuredClone(graph);
    misplaced.annotations[''] = { ...misplaced.annotations[''], articulationNames: d.instrument.articulationNames };
    await expect(openResourceGraph(misplaced)).rejects.toThrow('resources.invalid');
  });
});
