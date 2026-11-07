import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { BUILTIN_SOUNDS } from '../src/builtinLibrary';
import { BUILTIN_RECORDINGS, createBuiltinRecordingLoader } from '../src/builtinRecordings';
import { parseProject, projectDocument, encodeSamples } from '../src/model';
import { createSamplePreparer } from '../src/prepareSamples';
import { selectRegion, renderScore, noteEndSeconds, type Score } from '../src/instruments';
import { renderProject } from '../src/engine';
import { embeddedFrames } from '../src/sampleReference';
import { bindInstrumentNote } from '../src/instrumentMapping';
import { BASIC_SYNTH } from '../src/synthesizers';
import type { RecordingDefinition } from '../src/recordingDefinition';

const bank = BUILTIN_SOUNDS.find(s => s.id === 'instrument-vcsl-kawai')!;
const load = () => parseProject(JSON.parse(gunzipSync(readFileSync(`public/sound-library/${bank.file}`)).toString()));
type Source = { id: string; trigger: string; sourcePath: string; rootMidi: number; keyLow: number; keyHigh: number;
  velocityLow: number; velocityHigh: number; offsetFrames: number; sourceEffectiveOpcodes: Record<string, string>;
  conversion: { recommendedRegionGainDb: number } };
const sources: Source[] = JSON.parse(readFileSync('samples/vcsl-kawai-20261107/manifest.json', 'utf8')).samples;
const id = (s: Source) => createHash('sha256').update(s.sourcePath).digest('hex');
const local = async (url: string) => new Response(readFileSync(`public/sound-library/${url.split('/').at(-1)}`));


it('uses independent release pitch, offset, gain and hold decay, and clears source-specific behavior on replacement', () => {
  const sampleRate = 8000;
  const assets = { a: { id: 'a', name: 'Main', sampleRate, channels: [encodeSamples(new Float32Array(24000))] },
    b: { id: 'b', name: 'Release', sampleRate, channels: [encodeSamples(Float32Array.from({ length: 16000 }, (_, i) => .2 * Math.sin(i * 2 * Math.PI * 100 / sampleRate)))] } };
  const r = { id: 'r', assetId: 'a', releaseAssetId: 'b', rootMidi: 60, keyLow: 60, keyHigh: 60, velocityLow: 1, velocityHigh: 127,
    articulation: 'hit', roundRobin: 0, gainDb: -30, tuneCents: 0, releaseSeconds: .1, sampleOffset: 50,
    envelope: { attack: .004, decay: 0, sustain: 1 }, releaseVoice: { rootMidi: 48, tuneCents: 0, gainDb: -6, offset: 20, decayDbPerSecond: 4 } };
  const score: Score = { schema: 'momo.score/v1', bpm: 120, instruments: [{ id: 'i', name: 'Piano', regions: [r] }],
    notes: [{ id: 'n', instrumentId: 'i', midi: 60, velocity: 127, articulation: 'hit', start: 0, duration: .4 }] };
  const short = renderScore(score, assets, 2, sampleRate, 0).left;
  const longScore = { ...score, notes: [{ ...score.notes[0], duration: 1.4 }] };
  const long = renderScore(longScore, assets, 2, sampleRate, 0).left;
  for (let i = 81; i < 1000; i += 71) {
    const expected = .2 * Math.sin((20 + i * 2) * 2 * Math.PI * 100 / sampleRate) * 10 ** ((-6 - 4 * .2) / 20);
    expect(short[1600 + i]).toBeCloseTo(expected, 6);
    expect(long[5600 + i]).toBeCloseTo(short[1600 + i] * 10 ** (-2 / 20), 6);
  }
  const replaced = bindInstrumentNote({ schema: 'momo.instrument/v1', instrument: score.instruments[0], assets }, 60, { type: 'synth', synth: BASIC_SYNTH }, 'r');
  for (const field of ['sampleOffset', 'envelope', 'releaseVoice', 'releaseAssetId']) expect(replaced.instrument.regions[0]).not.toHaveProperty(field);
});


it('releases from the current attack level and lets a one-shot decay continue past the note length', () => {
  const assets = { a: { id: 'a', name: 'Envelope test', sampleRate: 8000, channels: [encodeSamples(new Float32Array(16000).fill(.2))] } };
  const region = { id: 'r', assetId: 'a', rootMidi: 60, keyLow: 60, keyHigh: 60, velocityLow: 1, velocityHigh: 127,
    articulation: 'hit', roundRobin: 0, gainDb: 0, tuneCents: 0, releaseSeconds: .1, envelope: { attack: 1, decay: 0, sustain: 1 } };
  const score: Score = { schema: 'momo.score/v1', bpm: 120, instruments: [{ id: 'i', name: 'Test', regions: [region] }],
    notes: [{ id: 'n', instrumentId: 'i', midi: 60, velocity: 127, articulation: 'hit', start: 0, duration: .1 }] };
  expect(renderScore(score, assets, 1, 8000, 0).left[600]).toBeCloseTo(.2 * .05 * .75, 7);
  score.instruments[0].regions[0] = { ...region, playback: 'one-shot', envelope: { attack: 0, decay: 1, sustain: 0 } };
  expect(renderScore(score, assets, 1, 8000, 0).left[4000]).toBeCloseTo(.1, 7);
});
