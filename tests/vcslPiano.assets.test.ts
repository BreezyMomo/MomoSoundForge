import { projectFromGraph } from './helpers/resourceGraph';
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
const load = async () => await projectFromGraph(JSON.parse(gunzipSync(readFileSync(`public/sound-library/${bank.file}`)).toString()));
type Source = { id: string; trigger: string; sourcePath: string; rootMidi: number; keyLow: number; keyHigh: number;
  velocityLow: number; velocityHigh: number; offsetFrames: number; sourceEffectiveOpcodes: Record<string, string>;
  conversion: { recommendedRegionGainDb: number } };
const sources: Source[] = JSON.parse(readFileSync('samples/vcsl-kawai-20261107/manifest.json', 'utf8')).samples;
const id = (s: Source) => createHash('sha256').update(s.sourcePath).digest('hex');
const local = async (url: string) => new Response(readFileSync(`public/sound-library/${url.split('/').at(-1)}`));


it('matches the author attack AND release mapping at every key and velocity, without embedding the whole bank', async () => {
  const p = await load(), score = p.inputs[0].player.score!, instrument = score.instruments[0];
  expect(instrument.keyRange).toEqual({ low: 21, high: 108 });
  expect(Object.values(p.assets)).toHaveLength(222);
  expect(Object.values(p.assets).every(a => a.reference && !a.channels.length)).toBe(true);
  expect(bank.projectBytes).toBeLessThan(500_000);
  const reached = new Set<string>();
  for (let midi = 21; midi <= 108; midi++) for (let velocity = 1; velocity <= 127; velocity++) {
    const matches = sources.filter(s => midi >= s.keyLow && midi <= s.keyHigh && velocity >= s.velocityLow && velocity <= s.velocityHigh);
    const attack = matches.filter(s => s.trigger === 'attack'), release = matches.filter(s => s.trigger === 'release');
    expect(attack).toHaveLength(1); expect(release.length).toBeLessThanOrEqual(1);
    const r = selectRegion(instrument, { ...score.notes[0], midi, velocity }, p.inputs[0].player.noiseSeed, new Map())!;
    reached.add(r.id);
    expect(r.assetId).toBe(id(attack[0]));
    expect(r.rootMidi).toBe(attack[0].rootMidi);
    expect(r.sampleOffset).toBe(attack[0].offsetFrames);
    expect(r.tuneCents).toBe(Number(attack[0].sourceEffectiveOpcodes.tune ?? 0));
    expect(r.gainDb).toBe(attack[0].conversion.recommendedRegionGainDb);
    expect(r.releaseAssetId).toBe(release[0] ? id(release[0]) : undefined);
    if (release[0]) expect(r.releaseVoice).toEqual({ rootMidi: release[0].rootMidi, offset: release[0].offsetFrames,
      tuneCents: Number(release[0].sourceEffectiveOpcodes.tune ?? 0), gainDb: release[0].conversion.recommendedRegionGainDb,
      decayDbPerSecond: Number(release[0].sourceEffectiveOpcodes.rt_decay ?? 0) });
  }
  expect(reached.size).toBe(instrument.regions.length);
});


it('renders low/middle/high and soft/hard notes, keeps long holds, and reopens each performance offline identically', async () => {
  const prepare = createSamplePreparer(local, '/');
  const offline = createSamplePreparer(async () => { throw Error('Offline'); }, '/');
  for (const [midi, velocity, held] of [[21, 30, .15], [21, 115, .6], [60, 30, 6], [60, 115, .6], [108, 30, .15], [108, 115, .6]]) {
    const p = await load(), input = p.inputs[0], score = input.player.score!;
    score.notes = [{ ...score.notes[0], midi, velocity, duration: held * 2 }];
    const r = selectRegion(score.instruments[0], score.notes[0], input.player.noiseSeed, new Map())!;
    const seconds = noteEndSeconds(score.notes[0], r, p.assets, score.bpm) + .01;
    p.duration = input.duration = input.player.duration = input.sourceEnd = seconds;
    const fetcher = vi.fn(local), prepared = await createSamplePreparer(fetcher, '/')(p);
    expect(fetcher.mock.calls.length).toBe(r.releaseAssetId ? 2 : 1);
    const audio = renderProject(prepared);
    expect(audio.sourcePeak).toBeGreaterThan(.0001);
    expect(audio.sourcePeak).toBeLessThan(1);
    expect(audio.left).not.toEqual(audio.right);
    if (held > 4) expect(embeddedFrames(prepared.assets[r.assetId])).toBeGreaterThan(4 * 48000);
    const saved = await offline(parseProject(projectDocument(prepared)));
    expect(renderProject(saved).left).toEqual(audio.left);
  }
  // The shipped example now uses this same complete instrument, not the old four-second clips.
  const example = BUILTIN_SOUNDS.find(s => s.id === 'example-expanded-piano')!;
  const p = await projectFromGraph(JSON.parse(gunzipSync(readFileSync(`public/sound-library/${example.file}`)).toString()));
  expect(p.inputs[0].player.score!.instruments[0].id).toBe('instrument-vcsl-kawai');
  expect(renderProject(await prepare(p)).peak).toBeGreaterThan(.01);
}, 30000);


it('preserves complete independent recordings longer than thirty seconds', async () => {
  const recording = BUILTIN_RECORDINGS.filter(r => r.nameKey === bank.nameKey).sort((a, b) => b.frames - a.frames)[0];
  expect(recording.duration).toBeGreaterThan(40);
  const resource = await createBuiltinRecordingLoader([recording], local, '/')(recording.id);
  expect(embeddedFrames((resource.payload as RecordingDefinition).asset)).toBe(recording.frames);
});
