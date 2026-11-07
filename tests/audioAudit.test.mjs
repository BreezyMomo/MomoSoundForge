import { expect, it } from 'vitest';
import { compareEmbedded, mappingCoverage, pcmHash, representativeRegions, workingPcm } from '../tools/audio-audit-core.mjs';
import { encodeWav } from '../src/engine';
import { selectRegion } from '../src/instruments';
import { readFileSync } from 'node:fs';
import { sha256 } from '../tools/audio-audit-core.mjs';
import { encodeSamples, parseProject, projectDocument } from '../src/model';
import { recordingProject } from '../src/recordingDefinition';
import { renderProject } from '../src/engine';

it('distinguishes PCM identity by rate, channel order and frame count', () => {
  const a = new Float32Array([.25, -.5]), b = new Float32Array([-.25, .5]);
  const digest = pcmHash([a, b], 48000);
  expect(digest).toBe(pcmHash([a.slice(), b.slice()], 48000));
  expect(digest).not.toBe(pcmHash([a, b], 44100));
  expect(digest).not.toBe(pcmHash([b, a], 48000));
  expect(digest).not.toBe(pcmHash([new Float32Array([...a, ...b])], 48000));
  expect(() => pcmHash([a, new Float32Array(1)], 48000)).toThrow();
  expect(() => pcmHash([new Float32Array([NaN])], 48000)).toThrow();
});

it('identifies gain and retained prefix separately from a removed audible tail', () => {
  const source = [new Float32Array([.1, .2, .1, .2]), new Float32Array([-.1, -.2, -.1, -.2])];
  const cut = source.map(c => Float32Array.from(c.subarray(0, 2), x => x * 2));
  const result = compareEmbedded(source, cut, 100);
  expect(result.prefixMatchesWithGain).toBe(true);
  expect(result.gainDb).toBeCloseTo(6.0206);
  expect(result.removedSeconds).toBe(.02);
  expect(result.removedTail.status).toBe('ok');
  cut[0][1] = -.1;
  expect(compareEmbedded(source, cut, 100).prefixMatchesWithGain).toBe(false);
  expect(compareEmbedded([source[0]], cut, 100).comparable).toBe(false);
});

it('reads the working WAV format and rejects truncation or unsupported layout', () => {
  const bytes = Buffer.from(encodeWav({ left: new Float32Array([-.5, .5]), right: new Float32Array([.25, -.25]), sampleRate: 48000 }));
  expect(workingPcm(bytes)[0][0]).toBe(-.5);
  expect(workingPcm(bytes)[1][0]).toBe(.25);
  expect(() => workingPcm(bytes.subarray(0, bytes.length - 1))).toThrow();
  expect(() => workingPcm(Buffer.alloc(44))).toThrow();
});

const region = (id, rootMidi, velocityLow = 1, velocityHigh = 127, roundRobin = 0) => ({
  id, assetId: id, rootMidi, keyLow: rootMidi, keyHigh: rootMidi, velocityLow, velocityHigh,
  articulation: 'hit', roundRobin, tuneCents: 0, gainDb: 0, releaseSeconds: .1,
});

it('selects actual low/mid/high roots, every available velocity band and alternate take', () => {
  const regions = [region('low', 48), region('mid-soft', 60, 1, 80), region('mid-hard', 60, 81, 127),
    region('mid-alt', 60, 81, 127, 1), region('high', 72)];
  expect(representativeRegions(regions).map(r => [r.regionId, r.velocity])).toEqual([
    ['low', 64], ['mid-soft', 41], ['mid-hard', 104], ['mid-alt', 104], ['high', 64],
  ]);
});

it('checks all keyboard/velocity boundaries and two repeatable alternate cycles without hiding gaps', () => {
  const instrument = { id: 'i', name: 'I', regions: [region('soft-a', 60, 1, 63), region('soft-b', 60, 1, 63, 1), region('hard', 60, 65, 127)] };
  const coverage = mappingCoverage(instrument, selectRegion);
  expect(coverage.testedCells).toBe(128 * 127);
  expect(coverage.failures).toEqual([]);
  expect(coverage.groups[0].gaps).toEqual([{ midi: 60, velocityRanges: [[64, 64]] }]);
  expect(coverage.groups[0].cycles[0].sequence).toHaveLength(4);
  expect(coverage.groups[0].cycles.every(c => c.allAlternativesReached && c.repeatsAfterOneCycle)).toBe(true);
  expect(coverage.unreachedRegions).toEqual([]);
});

it('reports hidden alternate groups under single-key overrides as a mapping review item', () => {
  const broad = { ...region('broad', 60), keyLow: 59, keyHigh: 61 };
  const coverage = mappingCoverage({ id: 'i', regions: [broad, region('override', 60)] }, selectRegion);
  expect(coverage.groups[0].overlaps.length).toBe(127);
  expect(coverage.groups[0].cycles.find(c => c.expected.includes('broad')).allAlternativesReached).toBe(false);
  expect(coverage.failures).toEqual([]);
});

it('preserves a real licensed recording through a portable project and WAV export', () => {
  const root = new URL('./fixtures/cc0-carpet-step/', import.meta.url);
  const metadata = JSON.parse(readFileSync(new URL('source.json', root), 'utf8'));
  const wav = readFileSync(new URL('working.wav', root));
  expect(sha256(wav)).toBe(metadata.sample.wavSha256);
  expect(sha256(readFileSync(new URL('original.ogg', root)))).toBe(metadata.sample.originalSha256);
  const channels = workingPcm(wav);
  const project = recordingProject({ schema: 'momo.recording/v1', asset: { id: 'fixture', name: 'Carpet step',
    sampleRate: 48000, channels: channels.map(encodeSamples) }, rootMidi: null, tuneCents: 0, gainDb: 0, releaseSeconds: .05 }, 'Step');
  const before = renderProject(project), after = renderProject(parseProject(JSON.parse(JSON.stringify(projectDocument(project)))));
  expect(pcmHash([before.left, before.right], 48000)).toBe(pcmHash([after.left, after.right], 48000));
  expect(before.peak).toBeGreaterThan(.1);
  const exported = workingPcm(Buffer.from(encodeWav(after)));
  expect(exported[0]).toHaveLength(after.left.length);
  expect(Math.max(...exported[0].map((x, i) => Math.abs(x - after.left[i])))).toBeLessThan(2 / 32768);
});
