import { encodeWav } from '../src/engine';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { BUILTIN_RECORDINGS, createBuiltinRecordingLoader, type BuiltinRecording } from '../src/builtinRecordings';
import { BUILTIN_SOUNDS } from '../src/builtinLibrary';
import { decodeSamples, parseProject } from '../src/model';
import { parseResource, resourceProject } from '../src/soundResources';
import type { RecordingDefinition } from '../src/recordingDefinition';

const bytesOf = (r: BuiltinRecording) => readFileSync(`public/sound-library/${r.file}`);
const load = createBuiltinRecordingLoader(BUILTIN_RECORDINGS, async url => new Response(readFileSync(`public${url}`)), '/');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');


it('ships exactly one complete, verified working WAV per instrument recording', () => {
  const expected = new Set(BUILTIN_SOUNDS.flatMap(s => (s.recordings ?? []).map(r => r.id)));
  expect(new Set(BUILTIN_RECORDINGS.map(r => r.id))).toEqual(expected);
  expect(BUILTIN_RECORDINGS.length).toBe(expected.size);
  const sourceHashes = new Map<string, { frames: number; hash: string }>();
  for (const collection of ['orchestra-basics-20261104', 'orchestra-expanded-20261105', 'vcsl-kawai-20261107']) {
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
  const p = parseProject(JSON.parse(gunzipSync(readFileSync(`public/sound-library/${parent.file}`)).toString()));
  const prefix = decodeSamples(p.assets[r.id].channels[0]), complete = decodeSamples(d.asset.channels[0]);
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
    const parent = BUILTIN_SOUNDS.find(s => s.recordings?.some(x => x.id === r.id))!;
    const p = parseProject(JSON.parse(gunzipSync(readFileSync(`public/sound-library/${parent.file}`)).toString()));
    expect(d.asset.channels).toEqual(p.assets[r.id].channels);
    expect(d.rootMidi).toBe(r.unpitched ? null : r.rootMidi);
    expect(d.asset.source?.license).toBe('CC0-1.0');
  }
});
