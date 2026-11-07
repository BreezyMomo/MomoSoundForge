import {createAudioReader,audioChannels} from '../src/sharedAudio';
import { projectFromGraph } from './helpers/resourceGraph';
import { encodeWav } from '../src/engine';
import { createSamplePreparer } from '../src/prepareSamples';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { BUILTIN_RECORDINGS, createBuiltinRecordingLoader, type BuiltinRecording } from '../src/builtinRecordings';
import { BUILTIN_SOUNDS } from '../src/builtinLibrary';
import { decodeSamples, encodeSamples, parseProject, makeLayer } from '../src/model';
import { parseResource, resourceProject } from '../src/soundResources';
import type { RecordingDefinition } from '../src/recordingDefinition';

const bytesOf = (r: BuiltinRecording) => readFileSync(`public/sound-library/${r.file}`);
const load = createBuiltinRecordingLoader(BUILTIN_RECORDINGS, async url => new Response(readFileSync(`public${url}`)), '/');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');


it('ships unique verified working WAVs for instrument mappings and standalone takes', async () => {
  const expected = new Set(BUILTIN_SOUNDS.flatMap(s => (s.recordings ?? []).map(r => r.id)));
  const ids = new Set(BUILTIN_RECORDINGS.map(r => r.id));
  for (const id of expected) expect(ids.has(id)).toBe(true);
  expect(ids.size).toBe(BUILTIN_RECORDINGS.length);
  const sourceHashes = new Map<string, { frames: number; hash: string }>();
  for (const collection of ['orchestra-basics-20261104', 'orchestra-expanded-20261105', 'vcsl-kawai-20261107', 'orchestra-complete-20261107']) {
    const m = JSON.parse(readFileSync(`samples/${collection}/manifest.json`, 'utf8'));
    for (const s of m.samples) sourceHashes.set(s.wavSha256, { frames: Math.round(s.durationSeconds * 48000), hash: s.wavSha256 });
  }
  for (const r of BUILTIN_RECORDINGS) {
    const compressed = bytesOf(r), wav = gunzipSync(compressed);
    expect(sha(compressed), r.id).toBe(r.sha256);
    expect(compressed.length).toBe(r.compressedBytes);
    expect(wav.length).toBe(r.decodedBytes);
    expect(sourceHashes.get(sha(wav))?.frames, r.id).toBe(r.frames);
    expect(r.frames).toBe(wav.readUInt32LE(40) / 4);
    expect(r.duration).toBe(r.frames / 48000);
  }
}, 60000);


it('loads the complete flute tail without a parent download and preserves the original PCM prefix', async () => {
  const r = BUILTIN_RECORDINGS.find(r => r.nameKey === 'builtin.instrument.flute' && r.duration > 8)!;
  const fetcher = vi.fn(async () => new Response(bytesOf(r))), loader = createBuiltinRecordingLoader([r], fetcher, '/nested/');
  const [a, b] = await Promise.all([loader(r.id, '完整钢琴'), loader(r.id, '独立副本')]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(`/nested/sound-library/${r.file}`);
  const d = a.payload as RecordingDefinition;
  expect(decodeSamples(d.asset.channels[0]).length).toBe(r.frames);
  const parent = BUILTIN_SOUNDS.find(s => s.recordings?.some(x => x.id === r.id))!;
  const p = await projectFromGraph(JSON.parse(gunzipSync(readFileSync(`public/sound-library/${parent.file}`)).toString()));
  // Hydrate this particular take at its full excerpt length, independently of
  // whichever take the factory preview note happens to trigger.
  p.inputs = [makeLayer({ type: 'sample', assetId: r.id, duration: p.duration })];
  const prepared = await createSamplePreparer(async url => new Response(readFileSync(`public${url}`)), '/')(p);
  const prefix = decodeSamples(prepared.assets[r.id].channels[0]), complete = decodeSamples(d.asset.channels[0]);
  expect(prefix.length).toBeLessThan(complete.length);
  expect(complete.slice(0, prefix.length)).toEqual(prefix);
  expect(resourceProject(a).duration).toBeCloseTo(r.duration / 2 ** (r.tuneCents / 1200), 5);
  expect(parseResource(JSON.parse(JSON.stringify(a)))).toEqual(a);
  d.asset.channels[0] = 'changed';
  expect((b.payload as RecordingDefinition).asset.channels[0]).not.toBe('changed');
});


it('keeps legacy gain passes and unpitched percussion metadata', async () => {
  for (const r of [BUILTIN_RECORDINGS.find(r => r.assetGains.length)!, BUILTIN_RECORDINGS.find(r => r.unpitched)!]) {
    const full = await load(r.id), d = full.payload as RecordingDefinition;
    const wav = gunzipSync(bytesOf(r));
    for (let channel = 0; channel < 2; channel++) {
      const expected = Float32Array.from({length:r.frames}, (_, i) => {
        let value = wav.readInt16LE(44 + i * 4 + channel * 2) / 32768;
        for (const gain of r.assetGains) value = Math.fround(value * gain);
        return value;
      });
      expect(decodeSamples(d.asset.channels[channel])).toEqual(expected);
    }
    expect(d.rootMidi).toBe(r.unpitched ? null : r.rootMidi);
    expect(d.asset.source?.license).toBe('CC0-1.0');
  }
});
