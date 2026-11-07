import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createSamplePreparer } from '../src/prepareSamples';
import { makeProject, makeLayer, encodeSamples, parseProject, projectDocument, type SampleAsset } from '../src/model';
import { renderProject } from '../src/engine';
import { embeddedFrames, sampleFrames } from '../src/sampleReference';
import { selectRegion } from '../src/instruments';

function fixture() {
  const frames = 48000 * 6, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  const channel = Float32Array.from({ length: frames }, (_, i) => Math.round(Math.sin(i * .03) * 6000) / 32768);
  for (let i = 0; i < frames; i++) { wav.writeInt16LE(channel[i] * 32768, 44 + i * 4); wav.writeInt16LE(channel[i] * 32768, 46 + i * 4); }
  const packed = gzipSync(wav), sha256 = createHash('sha256').update(packed).digest('hex');
  const asset: SampleAsset = { id: 'a', name: 'Piano A', sampleRate: 48000, channels: [], reference: {
    schema: 'momo.builtin-sample/v1', file: `${sha256}.recording.bin`, sha256, frames, assetGains: [], compressedBytes: packed.length, decodedBytes: wav.length } };
  const p = makeProject('lazy instrument'); p.duration = 1.5;
  p.assets = { a: asset, unused: { ...asset, id: 'unused', name: 'Other key' } };
  const region = { id: 'key', assetId: 'a', rootMidi: 60, keyLow: 60, keyHigh: 60, velocityLow: 1, velocityHigh: 127, articulation: 'hit', roundRobin: 0, tuneCents: 0, gainDb: 0, releaseSeconds: .25 };
  p.inputs = [makeLayer({ type: 'instrument', duration: p.duration, gain: 1, attack: 0, release: 0, decay: 0, cutoff: 22000,
    score: { schema: 'momo.score/v1', bpm: 120, instruments: [{ id: 'i', name: 'Piano', regions: [region, { ...region, id: 'next', assetId: 'unused', rootMidi: 61, keyLow: 61, keyHigh: 61 }] }],
      notes: [{ id: 'n', instrumentId: 'i', midi: 60, velocity: 90, start: 0, duration: 1, articulation: 'hit' }] } })];
  const full = structuredClone(p);
  full.assets.a.channels = [encodeSamples(channel), encodeSamples(channel)];
  return { p, full, packed };
}

it('shares a full recording while preserving an excerpt boundary and exact rendered PCM', async () => {
  const { p, full, packed } = fixture(), frames = 4800;
  p.assets.a.reference!.frameLimit = frames;
  full.assets.a.reference!.frameLimit = frames;
  full.assets.a.channels = full.assets.a.channels.map(c => Buffer.from(c, 'base64').subarray(0, frames * 4).toString('base64'));
  const ready = await createSamplePreparer(async () => new Response(packed), '/')(p);
  expect(sampleFrames(ready.assets.a)).toBe(frames);
  expect(embeddedFrames(ready.assets.a)).toBe(frames);
  expect(renderProject(ready).left).toEqual(renderProject(full).left);
  const reopened = parseProject(JSON.parse(JSON.stringify(projectDocument(ready))));
  await expect(createSamplePreparer(async () => { throw Error('must be offline'); }, '/')(reopened)).resolves.toEqual(reopened);
  for (const frameLimit of [0, -1, .5, 48000 * 6 + 1]) {
    p.assets.a.reference!.frameLimit = frameLimit;
    expect(() => parseProject(p)).toThrow();
  }
});

it('loads only played keys, keeps the full keyboard, and reopens the saved performance offline without altering PCM', async () => {
  const { p, full, packed } = fixture(), snapshot = structuredClone(p);
  const fetcher = vi.fn(async () => new Response(packed)), prepare = createSamplePreparer(fetcher, '/nested/');
  expect(() => renderProject(p)).toThrow('error.sampleUnavailable');
  const ready = await prepare(p);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(ready.assets.unused.channels).toEqual([]);
  expect(embeddedFrames(ready.assets.a)).toBe(36002);
  expect(ready.inputs[0].player.score!.instruments[0].regions).toHaveLength(2);
  expect(renderProject(ready).left).toEqual(renderProject(full).left);
  const offline = createSamplePreparer(async () => { throw Error('network must not be used'); }, '/');
  const reopened = await offline(parseProject(JSON.parse(JSON.stringify(projectDocument(ready)))));
  expect(renderProject(reopened).left).toEqual(renderProject(ready).left);
  expect(p).toEqual(snapshot);
  reopened.inputs[0].player.score!.notes[0].midi = 61;
  const changed = await prepare(reopened);
  expect(changed.assets.a.channels).toEqual([]);
  expect(embeddedFrames(changed.assets.unused)).toBeGreaterThan(0);
  expect(fetcher).toHaveBeenCalledTimes(1); // compressed file reused, asset identity preserved
});

it('resolves longer holds and region offsets instead of treating an embedded prefix as the whole recording', async () => {
  const { p, packed } = fixture(), prepare = createSamplePreparer(async () => new Response(packed), '/');
  const ready = await prepare(p);
  ready.inputs[0].player.score!.notes[0].duration = 6;
  ready.inputs[0].player.score!.instruments[0].regions[0].sampleOffset = 4800;
  const longer = await prepare(ready);
  expect(embeddedFrames(longer.assets.a)).toBe(160802);
  expect(() => renderProject(ready)).toThrow('error.sampleUnavailable');
});

it('rejects unsafe references and excessive decoded dependencies before making requests; cancellation does not mutate input', async () => {
  const { p, packed } = fixture(), fetcher = vi.fn(async () => new Response(packed)), prepare = createSamplePreparer(fetcher, '/');
  const unsafe = structuredClone(p); (unsafe.assets.a.reference as import('../src/sampleReference').BuiltinSampleReference).file = '../private.wav';
  await expect(prepare(unsafe)).rejects.toThrow('error.sampleReference');
  const big = structuredClone(p); big.assets.a.reference!.frames = 5_760_000; (big.assets.a.reference as import('../src/sampleReference').BuiltinSampleReference).decodedBytes = 44 + 5_760_000 * 4;
  big.inputs[0].player.score!.notes[0].duration = 240;
  await expect(prepare(big)).rejects.toThrow('error.budget');
  const controller = new AbortController(); controller.abort();
  await expect(prepare(p, controller.signal)).rejects.toThrow('cancelled');
  expect(fetcher).not.toHaveBeenCalled();
  expect(p.assets.a.channels).toEqual([]);
});

it('includes release recordings as dependencies unless note-off is bypassed by one-shot playback', async () => {
  const { p, packed } = fixture(), score = p.inputs[0].player.score!;
  score.instruments[0].regions[0].releaseAssetId = 'unused';
  score.instruments[0].regions[0].releaseVoice = { rootMidi: 61, tuneCents: 3, gainDb: -10, offset: 20, decayDbPerSecond: 4 };
  const ready = await createSamplePreparer(async () => new Response(packed), '/')(p);
  expect(embeddedFrames(ready.assets.unused)).toBe(6 * 48000);
  expect(() => renderProject(ready)).not.toThrow();
  score.instruments[0].regions[0].playback = 'one-shot';
  const shot = await createSamplePreparer(async () => new Response(packed), '/')(p);
  expect(shot.assets.unused.channels).toEqual([]);
  expect(() => renderProject(shot)).not.toThrow();
});

it('loads the same round-robin take that the renderer selects using the player seed, not the project seed', async () => {
  const { p, packed } = fixture(), input = p.inputs[0], score = input.player.score!;
  score.instruments[0].regions[1] = { ...score.instruments[0].regions[0], id: 'take2', assetId: 'unused', roundRobin: 1 };
  const selected = new Set<string>();
  for (const seed of [0, 1]) {
    input.player.noiseSeed = seed; p.seed = 123;
    const region = selectRegion(score.instruments[0], score.notes[0], seed, new Map())!;
    const ready = await createSamplePreparer(async () => new Response(packed), '/')(p);
    expect(Object.values(ready.assets).filter(a => a.channels.length).map(a => a.id)).toEqual([region.assetId]);
    expect(() => renderProject(ready)).not.toThrow(); selected.add(region.assetId);
  }
  expect(selected.size).toBe(2);
});
