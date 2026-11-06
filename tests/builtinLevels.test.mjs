import { expect, it } from 'vitest';
import { legacyInstrumentLevels, standaloneBoostDb } from '../tools/builtin-levels.mjs';
import { levels } from '../tools/audit-builtin-library.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseProject } from '../src/model';
import { renderProject } from '../src/engine';

it('restores authored balance, keeps dynamics and leaves headroom without changing the input', () => {
  const samples = [
    { id: 'soft', instrumentId: 'drum', peak: .001220703125, sourceEffectiveOpcodes: { volume: '27' } },
    { id: 'loud', instrumentId: 'drum', peak: .084625244140625, sourceEffectiveOpcodes: { volume: '10' } },
  ];
  const original = structuredClone(samples), result = legacyInstrumentLevels(samples);
  const output = s => {
    const gain = result.get(s.id);
    expect(gain.regionGainDb).toBeLessThanOrEqual(24);
    expect(s.peak * 10 ** (gain.assetGainDb / 20)).toBeLessThan(1);
    return s.peak * 10 ** ((gain.assetGainDb + gain.regionGainDb) / 20) * 1.3;
  };
  expect(output(samples[1])).toBeCloseTo(.65, 6);
  expect(output(samples[0])).toBeGreaterThan(.05);
  expect(output(samples[0]) / output(samples[1])).toBeCloseTo(
    samples[0].peak / samples[1].peak * 10 ** (17 / 20), 6);
  expect(result.get('soft').assetGainDb).toBe(result.get('loud').assetGainDb);
  expect(samples).toEqual(original);
});

it('rejects invalid or silent sources instead of amplifying them blindly', () => {
  for (const peak of [0, NaN, Infinity, 1.5]) expect(() => legacyInstrumentLevels([
    { id: 'bad', instrumentId: 'bad', peak },
  ])).toThrow();
});

it('raises standalone default audibility, while limiting transients and leaving loud sounds alone', () => {
  expect(standaloneBoostDb({ peakDb: -25.64, activeRmsDb: -33.85 })).toBeCloseTo(13.85);
  expect(standaloneBoostDb({ peakDb: -8, activeRmsDb: -35 })).toBe(2);
  expect(standaloneBoostDb({ peakDb: -4, activeRmsDb: -16 })).toBe(0);
  expect(() => standaloneBoostDb({ peakDb: null, activeRmsDb: null })).toThrow();
});

it('renders the shipped timpani at usable default loudness and retains velocity control', () => {
    const catalog = JSON.parse(readFileSync('src/data/builtin-catalog.json', 'utf8'));
    expect(catalog.sounds.some(s => s.id === 'instrument-17-timpani-1-Fs2-single-hit')).toBe(false);
    const sound = catalog.sounds.find(s => s.id === 'instrument-17-timpani-2-Cs3-single-hit');
    const project = parseProject(JSON.parse(gunzipSync(readFileSync(`public/sound-library/${sound.file}`))));
    const normal = renderProject(project);
    const measured = levels([normal.left, normal.right], normal.sampleRate);
    expect(measured.activeRmsDb).toBeGreaterThanOrEqual(-20.1);
    expect(normal.peak).toBeGreaterThan(.2);
    (project.layers[0].content.score).notes[0].velocity = 50;
    expect(renderProject(project).peak / normal.peak).toBeCloseTo(.5, 4);
    (project.layers[0].content.score).notes[0].velocity = 127;
    expect(renderProject(project).sourcePeak).toBeLessThan(.8);
});

it('removes rejected sources, catalog entries and embedded project copies', () => {
  const quality = JSON.parse(readFileSync('tools/builtin-quality.json', 'utf8'));
  const catalog = JSON.parse(readFileSync('src/data/builtin-catalog.json', 'utf8'));
  const manifest = JSON.parse(readFileSync('samples/orchestra-basics-20261104/manifest.json', 'utf8'));
  for (const entry of quality.excludedStandaloneSamples) {
    expect(catalog.sounds.some(s => s.id === `instrument-${entry.id}`)).toBe(false);
    expect(catalog.sounds.some(s => s.id === `instrument-${entry.replacementSampleId}`)).toBe(true);
    expect(manifest.samples.some(s => s.id === entry.id)).toBe(false);
    for (const folder of ['originals', 'wav'])
      expect(existsSync(`samples/orchestra-basics-20261104/${folder}/percussion/${entry.id}.wav`)).toBe(false);
    for (const file of ['projects/17-timpani.soundforge', 'examples/forest-departure-8s.soundforge', 'review/chapters.json'])
      expect(readFileSync(`samples/orchestra-basics-20261104/${file}`, 'utf8')).not.toContain(entry.id);
  }
});

it('audits both channels and distinguishes silent and quiet audio from long tails', () => {
  const signal = new Float32Array(80000);
  signal.fill(.1, 0, 800);
  expect(levels([new Float32Array(80000), signal], 8000).status).toBe('ok');
  expect(levels([new Float32Array(100)], 8000).status).toBe('silent');
  expect(levels([new Float32Array(100).fill(.001)], 8000).status).toBe('quiet');
  expect(() => levels([new Float32Array([NaN])], 8000)).toThrow();
});
