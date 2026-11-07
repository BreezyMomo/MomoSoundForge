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


it('rejects corrupt, oversized and invalid recordings and permits a clean retry', async () => {
  const wav = Buffer.from(encodeWav({left:new Float32Array(480).fill(.1),right:new Float32Array(480).fill(.2),sampleRate:48000}));
  const original = gzipSync(wav);
  const r = {...BUILTIN_RECORDINGS[0], sha256:sha(original), compressedBytes:original.length, decodedBytes:wav.length, frames:480, duration:.01, file:sha(original)+'.recording.bin'};
  wav.writeUInt32LE(44100, 24);
  const broken = gzipSync(wav), entry = { ...r, sha256: sha(broken), compressedBytes: broken.length };
  await expect(createBuiltinRecordingLoader([entry], async () => new Response(broken), '/')(r.id)).rejects.toThrow('library.builtinLoadError');
  await expect(createBuiltinRecordingLoader([{ ...r, decodedBytes: 44 }], async () => new Response(original), '/')(r.id)).rejects.toThrow('library.builtinLoadError');
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(original.length))).mockImplementation(async () => new Response(original));
  const loader = createBuiltinRecordingLoader([r], fetcher, '/');
  await expect(loader(r.id)).rejects.toThrow('library.builtinLoadError');
  expect((await loader(r.id)).kind).toBe('recording');
  expect(fetcher).toHaveBeenCalledTimes(2);
});


it('publishes standalone orchestra takes as recordings, not instrument definitions', () => {
  type Source = {id:string;instrumentId:string;rootMidi:number|null;velocityLow:number;velocityHigh:number};
  const manifest = JSON.parse(readFileSync('samples/orchestra-basics-20261104/manifest.json', 'utf8')) as {samples:Source[]};
  const expanded = JSON.parse(readFileSync('samples/orchestra-expanded-20261105/manifest.json', 'utf8')) as {samples:Source[]};
  const complete = JSON.parse(readFileSync('samples/orchestra-complete-20261107/manifest.json', 'utf8')) as {samples:Source[]};
  const quality = JSON.parse(readFileSync('tools/builtin-quality.json', 'utf8')) as {excludedStandaloneSamples:{id:string}[]};
  const mapped = new Set([...expanded.samples, ...complete.samples].map(s => s.instrumentId));
  const excluded = new Set(quality.excludedStandaloneSamples.map(s => s.id));
  const standalone = manifest.samples.filter(s => !mapped.has(s.instrumentId) && !excluded.has(s.id));
  expect(standalone.length).toBeGreaterThan(0);
  for (const sample of standalone) {
    expect(BUILTIN_SOUNDS.some(s => s.id === `instrument-${sample.id}`)).toBe(false);
    const recordings = BUILTIN_RECORDINGS.filter(r => r.id === sample.id);
    expect(recordings).toHaveLength(1);
    expect(recordings[0].rootMidi).toBe(sample.rootMidi ?? 60);
    expect(recordings[0].velocityLow).toBe(sample.velocityLow);
    expect(recordings[0].velocityHigh).toBe(sample.velocityHigh);
  }
});
