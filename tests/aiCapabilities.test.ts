import { describe, expect, it } from 'vitest';
import { encodeSamples, makeLayer, makeProject, makeComposition, parseProject, projectForSave, varyProject, type Project } from '../src/model';
import { renderProject } from '../src/engine';
import type { SampleRegion } from '../src/instruments';
import { createHash } from 'node:crypto';
import { applyEdits } from '../src/aiAuthoring';
import { generateVariants, strictExportSettings } from '../src/aiCapabilities';
import { DEFAULT_EFFECTS, resolveControls, type Macro } from '../src/advanced';
import { DEFAULT_EXPORT } from '../src/exportAudio';
import { renderExport } from '../src/exportPipeline';
import { encodeAudio } from '../src/encodeAudio';

const audioHash = (p: Project) => createHash('sha256').update(new Uint8Array(renderProject(p, 8000).left.buffer)).digest('hex');

function roundRobinProject(): Project {
  const p = makeProject('Round-robin fixture');
  p.seed = 1; p.duration = 0.2;
  for (const [id, amp] of [['soft', 0.15], ['loud', 0.6]] as const) {
    p.assets[id] = { id, name: id, sampleRate: 8000, channels: [encodeSamples(Float32Array.from({ length: 1600 }, (_, i) => amp * Math.sin(i * 2 * Math.PI * 220 / 8000)))] };
  }
  const region = (id: string, rr: number): SampleRegion => ({ id, assetId: id, rootMidi: 60, keyLow: 60, keyHigh: 60, velocityLow: 1, velocityHigh: 127, articulation: 'sustain', roundRobin: rr, tuneCents: 0, gainDb: 0, releaseSeconds: 0.01 });
  p.layers = [makeLayer({ id: 'instrument', name: 'Instrument', type: 'instrument', duration: 0.2, frequency: 440, endFrequency: 440, gain: 1, attack: 0, release: 0, decay: 0, noiseSeed: 0,
    score: { schema: 'momo.score/v1', bpm: 120, instruments: [{ id: 'i', name: 'Synthetic test fixture', regions: [region('soft', 0), region('loud', 1)] }], notes: [{ id: 'note', instrumentId: 'i', midi: 60, start: 0, duration: 0.4, velocity: 80, articulation: 'sustain' }] } })];
  return p;
}

describe('AI-accessible native variation invariants', () => {
  it('does not change round-robin instrument audio at zero variation amount', () => {
    const p = roundRobinProject(), before = structuredClone(p);
    expect(audioHash(varyProject(p, 2, 0))).toBe(audioHash(p));
    expect(p).toEqual(before);
  });
  it('keeps locked round-robin instrument audio unchanged for a different variation seed', () => {
    const p = roundRobinProject(); p.layers[0].locked = true;
    expect(audioHash(varyProject(p, 2, 0.8))).toBe(audioHash(p));
  });
  it('creates reproducible candidates without modifying the source or unlocking a subtree', () => {
    const p = makeProject('Grouped instrument'); p.duration = 0.2;
    p.layers = [makeComposition(roundRobinProject(), { id: 'locked-group', locked: true })];
    const before = structuredClone(p), first = generateVariants(p, { count: 3, amount: 0.8, seed: 99 });
    expect(first).toHaveLength(3);
    expect(first).toEqual(generateVariants(p, { count: 3, amount: 0.8, seed: 99 }));
    for (const next of first) {
      expect(next.layers[0]).toEqual(p.layers[0]);
      expect(audioHash(next)).toBe(audioHash(p));
      expect(() => parseProject(projectForSave(next))).not.toThrow();
    }
    expect(p).toEqual(before);
  });
  it.each([{ count: 0 }, { count: 6 }, { count: 1.5 }, { amount: -0.1 }, { amount: 1.1 }, { amount: NaN }, { seed: -1 }, { seed: 2 ** 32 }, { seed: 1.5 }])('rejects invalid variation options %j', options => {
    expect(() => generateVariants(roundRobinProject(), options)).toThrow();
  });
});

function nestedProject() {
  const child = makeProject('Child'); child.duration = 0.2;
  child.layers = [makeLayer({ id: 'tone', duration: 0.2, gain: 0.2, frequency: 440, endFrequency: 440 })];
  const p = makeProject('Parent'); p.duration = 0.2;
  p.layers = [makeComposition(child, { id: 'group' })];
  return p;
}
const childMacro = (): Macro => ({ id: 'body', name: '力度', min: 0, max: 100, defaultValue: 20, mappings: [{ layerId: 'tone', parameter: 'gain', low: 0, high: 1 }] });

describe('nested authoring through MCP operations', () => {
  it('defines child controls and drives them from a parent macro while preserving editable data', () => {
    const p = nestedProject();
    const next = applyEdits(p, [
      { op: 'project', path: ['group'], patch: { controls: [childMacro()] } },
      { op: 'project', patch: { controls: [{ id: 'power', name: '整体力度', min: 0, max: 1, defaultValue: 0.75, mappings: [{ layerId: 'group', parameter: 'control', controlId: 'body', low: 0, high: 100 }] }] } },
    ]);
    const saved = parseProject(projectForSave(next)), resolved = resolveControls(saved), group = resolved.layers[0];
    expect(group.controlValues?.body).toBe(75);
    expect(resolveControls(group.project!, group.controlValues).layers[0].gain).toBe(0.75);
    expect(group.project!.layers[0].gain).toBe(0.2);
    expect(p.layers[0].project!.controls).toBeUndefined();
    const equivalent = nestedProject(); equivalent.layers[0].project!.layers[0].gain = 0.75;
    expect(audioHash(saved)).toBe(audioHash(equivalent));
  });
  it('rejects newly authored out-of-range macro mappings and values instead of silently clamping', () => {
    const p = nestedProject(), before = structuredClone(p);
    expect(() => applyEdits(p, [{ op: 'project', path: ['group'], patch: { controls: [childMacro()], controlValues: { body: 101 } } }])).toThrow();
    expect(() => applyEdits(p, [
      { op: 'project', path: ['group'], patch: { controls: [childMacro()] } },
      { op: 'project', patch: { controls: [{ id: 'power', name: 'Power', min: 0, max: 1, defaultValue: 0.5, mappings: [{ layerId: 'group', parameter: 'control', controlId: 'body', low: 0, high: 101 }] }] } },
    ])).toThrow();
    expect(p).toEqual(before);
    const withControl = applyEdits(p, [{ op: 'project', path: ['group'], patch: { controls: [childMacro()] } }]);
    expect(() => applyEdits(withControl, [{ op: 'patch', id: 'group', patch: { controlValues: { body: 101 } } }])).toThrow();
  });
  it('reconciles existing overrides and parent mappings when a child control range is narrowed', () => {
    const p = applyEdits(nestedProject(), [
      { op: 'project', path: ['group'], patch: { controls: [childMacro()], controlValues: { body: 80 } } },
      { op: 'patch', id: 'group', patch: { controlValues: { body: 90 } } },
      { op: 'project', patch: { controls: [{ id: 'power', name: 'Power', min: 0, max: 1, defaultValue: 0.75, mappings: [{ layerId: 'group', parameter: 'control', controlId: 'body', low: 0, high: 100 }] }] } },
    ]);
    const next = applyEdits(p, [{ op: 'project', path: ['group'], patch: { controls: [{ ...childMacro(), max: 50 }] } }]);
    expect(next.layers[0].project!.controlValues?.body).toBe(50);
    expect(next.layers[0].controlValues?.body).toBe(50);
    expect(next.controls![0].mappings[0].high).toBe(50);
    expect(p.layers[0].project!.controlValues?.body).toBe(80);
  });
  it('rejects missing nested paths and manual group duration changes atomically', () => {
    const p = nestedProject(), before = structuredClone(p);
    expect(() => applyEdits(p, [{ op: 'project', path: ['missing'], patch: { name: 'bad' } }])).toThrow();
    expect(() => applyEdits(p, [{ op: 'project', patch: { name: 'first' } }, { op: 'project', path: ['group'], patch: { duration: 10 } }])).toThrow();
    expect(p).toEqual(before);
  });
});

describe('sound polish controls', () => {
  it('maps familiar UI percentages to native parameters and retains unrelated settings', () => {
    const p = nestedProject();
    p.layers[0].project!.layers[0].effects = { ...DEFAULT_EFFECTS, toneEnabled: false, delayTime: 0.37 };
    const next = applyEdits(p, [{ op: 'polish', path: ['group'], id: 'tone', action: 'adjust', values: { low: 50, high: -25, delayFeedback: 100, delayWet: 20, reverb: 75 } }]);
    const effects = next.layers[0].project!.layers[0].effects!;
    expect(effects).toMatchObject({ low: 12, high: -6, delayFeedback: 0.85, delayWet: 0.2, reverb: 0.75, delayTime: 0.37 });
    expect(p.layers[0].project!.layers[0].effects!.low).toBe(0);
  });
  it('toggles a group without discarding its values and resets only the requested group', () => {
    const p = nestedProject(); p.layers[0].effects = { ...DEFAULT_EFFECTS, low: 12, delayWet: 0.3, reverb: 0.6 };
    const off = applyEdits(p, [{ op: 'polish', id: 'group', action: 'toggle', group: 'tone', enabled: false }]);
    expect(off.layers[0].effects).toMatchObject({ toneEnabled: false, low: 12, delayWet: 0.3, reverb: 0.6 });
    const reset = applyEdits(off, [{ op: 'polish', id: 'group', action: 'reset', group: 'tone' }]);
    expect(reset.layers[0].effects).toMatchObject({ toneEnabled: true, low: 0, mid: 0, high: 0, delayWet: 0.3, reverb: 0.6 });
  });
  it('rejects an out-of-range adjustment and rolls back earlier changes in the batch', () => {
    const p = nestedProject(), before = structuredClone(p);
    expect(() => applyEdits(p, [{ op: 'project', patch: { name: 'changed' } }, { op: 'polish', id: 'group', action: 'adjust', values: { low: 101 } }])).toThrow();
    expect(p).toEqual(before);
  });
});

describe('strict AI export options', () => {
  it('merges valid explicit options without changing the editor defaults', () => {
    const base = { ...DEFAULT_EXPORT, prefix: 'game', trimSilence: true }, before = { ...base };
    expect(strictExportSettings({ format: 'flac', sampleRate: 22050, mono: true, tail: 0.5 }, base)).toEqual({ ...base, format: 'flac', sampleRate: 22050, mono: true, tail: 0.5 });
    expect(base).toEqual(before);
    expect(strictExportSettings()).toEqual(DEFAULT_EXPORT);
  });
  it.each([
    { format: 'aac' }, { sampleRate: 96000 }, { mono: 'yes' }, { normalize: 1 }, { trimSilence: null }, { loopOnly: 'false' },
    { tail: -1 }, { tail: 2.01 }, { targetRms: -37 }, { targetRms: -5 }, { targetRms: Infinity }, { prefix: 'x'.repeat(81) }, { unknown: true }, { toString: 'unknown field' },
  ].map(value => ({ value })))('rejects malformed options $value instead of defaulting or clamping', ({ value }) => {
    expect(() => strictExportSettings(value)).toThrow();
  });
});

describe('shared editor and AI export pipeline', () => {
  it('applies tail, mono and sample-rate settings to the actual encoded WAV', async () => {
    const p = nestedProject(), before = structuredClone(p);
    const settings = strictExportSettings({ sampleRate: 22050, mono: true, tail: 0.3, normalize: true, targetRms: -18 });
    const output = await renderExport(p, settings, async next => renderProject(next, 8000));
    const wav = await encodeAudio(output, settings), header = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(output.left.length).toBe(11025);
    expect(output.left).toEqual(output.right);
    expect(output.rms).toBeCloseTo(10 ** (-18 / 20), 5);
    expect(header.getUint16(22, true)).toBe(1);
    expect(header.getUint32(24, true)).toBe(22050);
    expect(wav.byteLength).toBe(44 + 11025 * 2);
    expect(p).toEqual(before);
  });
  it('exports the loop and crossfade without extending tail or trimming its silent portion', async () => {
    const p = nestedProject(); p.loopRegion = { start: 0.04, end: 0.16, crossfade: 0.02 };
    const settings = strictExportSettings({ sampleRate: 22050, loopOnly: true, trimSilence: true, tail: 1 });
    const output = await renderExport(p, settings, async next => renderProject(next, 8000));
    expect(output.left.length).toBe(2205);
    expect(output.sampleRate).toBe(22050);
  });
});
