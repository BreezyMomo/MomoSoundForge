import { describe, it, expect } from 'vitest';
import { applyEdits, describeProject } from '../src/aiAuthoring';
import { makeProject, makeLayer, encodeSamples, parseProject, projectForSave } from '../src/model';
import { renderProject, encodeWav } from '../src/engine';

describe('AI authoring transactions', () => {
  it('keeps the input intact when a later operation fails', () => {
    const p = makeProject('Original');
    expect(() => applyEdits(p, [{ op: 'add', layer: { name: 'First' } }, { op: 'patch', id: 'missing', patch: { gain: 0.4 } }])).toThrow();
    expect(p.layers).toEqual([]);
    expect(() => applyEdits(p, [{ op: 'add', layer: { gain: 12 } }])).toThrow();
    expect(() => applyEdits(p, [{ op: 'project', patch: { layers: [] } }])).toThrow();
  });
  it('groups and edits nested nodes without changing timing or rendering', () => {
    const p = applyEdits(makeProject('Sound'), [{ op: 'add', layer: { id: 'a', name: 'Tone', start: 0.1, duration: 0.3 } }]);
    const grouped = applyEdits(p, [{ op: 'group', ids: ['a'], name: 'Group' }]);
    expect(grouped.layers[0].start).toBe(0.1);
    expect(grouped.layers[0].project!.layers[0].start).toBe(0);
    expect(Buffer.from(encodeWav(renderProject(p)))).toEqual(Buffer.from(encodeWav(renderProject(grouped))));
    const next = applyEdits(grouped, [{ op: 'patch', path: [grouped.layers[0].id], id: 'a', patch: { gain: 0.2 } }]);
    expect(next.layers[0].project!.layers[0].gain).toBe(0.2);
    expect(grouped.layers[0].project!.layers[0].gain).toBe(0.6);
  });
  it('preserves sample provenance through insertion, save and reopening', () => {
    const source = { provider: 'Test', url: 'https://example.org/a', author: 'Composer', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', quality: 'original' as const, retrievedAt: '2026-11-05T00:00:00Z' };
    const p = makeProject('Sample');
    p.assets.a = { id: 'a', name: 'A', sampleRate: 48000, channels: [encodeSamples(new Float32Array([0, 0.1, 0]))], source };
    p.layers = [makeLayer({ type: 'sample', assetId: 'a' })];
    const inserted = applyEdits(makeProject('Parent'), [{ op: 'insert', project: p, start: 0.5 }]);
    const reopened = parseProject(JSON.parse(JSON.stringify(projectForSave(inserted))));
    expect(reopened.layers[0].project!.assets.a.source).toEqual(source);
    const summary = describeProject(reopened) as any;
    expect(summary.layers[0].project.assets.a.channels).toBeUndefined();
    expect(summary.layers[0].project.assets.a.frames).toBe(3);
    expect(summary.layers[0].project.assets.a.source.quality).toBe('original');
    p.assets.a.source!.url = 'file:///private';
    expect(() => parseProject(p)).toThrow();
    (p.assets.a as any).source = false;
    expect(() => parseProject(p)).toThrow();
  });
});
