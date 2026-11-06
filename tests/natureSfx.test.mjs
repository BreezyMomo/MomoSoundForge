import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { BUILTIN_SOUNDS, builtinToneKey, builtinSoundDescription, createBuiltinLoader } from '../src/builtinLibrary';
import { catalogs } from '../src/i18n';
import { parseProject, projectForSave } from '../src/model';
import { renderProject } from '../src/engine';
import { levels } from '../tools/audit-builtin-library.mjs';

const root = 'samples/nature-ambience-20261105';
const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clips = BUILTIN_SOUNDS.filter(s => s.id.startsWith('nature-'));
const scenes = BUILTIN_SOUNDS.filter(s => s.id.startsWith('example-nature-'));
const read = sound => {
  const bytes = readFileSync(`public/sound-library/${sound.file}`);
  expect(hash(bytes), sound.id).toBe(sound.sha256);
  return parseProject(JSON.parse(gunzipSync(bytes)));
};

it('keeps 11 publisher originals and 20 documented clips discoverable in eight nature groups', () => {
  expect(manifest.originals).toHaveLength(11);
  expect(clips).toHaveLength(20);
  expect(scenes).toHaveLength(3);
  expect(new Set(clips.map(builtinToneKey)).size).toBe(8);
  expect(new Set(clips.map(s => s.id))).toEqual(new Set(manifest.samples.map(s => s.id)));
  const hashes = new Set();
  for (const original of manifest.originals) {
    expect(hash(readFileSync(`${root}/${original.file}`)), original.id).toBe(original.sha256);
    hashes.add(original.sha256);
  }
  expect(hashes.size).toBe(11);
  const retired = manifest.excluded.flatMap(source => source.retiredClipIds ?? []);
  expect(retired).toHaveLength(9);
  expect(clips.every(sound => !retired.includes(sound.id))).toBe(true);
  const sources = JSON.parse(readFileSync('public/sound-library/licenses/sources.json', 'utf8')).sources;
  for (const source of manifest.sources) {
    expect(source.license).toBe('CC0-1.0');
    expect(hash(readFileSync(`${root}/${source.pageSnapshot}`))).toBe(source.pageSnapshotSha256);
    expect(sources).toContainEqual(expect.objectContaining({ sourceUrl: source.sourceUrl, author: source.author, license: 'CC0-1.0' }));
    expect(readFileSync('public/sound-library/licenses/nature-cc0.txt', 'utf8')).toContain(source.sourceUrl);
  }
  for (const sound of clips) for (const lang of ['zh-CN', 'en']) {
    expect(catalogs[lang]).toHaveProperty(sound.nameKey);
    expect(builtinSoundDescription(sound, key => catalogs[lang][key])).toContain('CC0');
  }
});

it('renders audible loop/event defaults with matching waveforms and quiet cycle boundaries', () => {
  for (const sound of [...clips, ...scenes]) {
    const project = read(sound), audio = renderProject(project);
    expect(project.duration, sound.id).toBeCloseTo(sound.duration, 6);
    expect(audio.sourcePeak, sound.id).toBeLessThanOrEqual(.502);
    expect(levels([audio.left, audio.right], audio.sampleRate).status, sound.id).toBe('ok');
    expect(sound.duration).toBeLessThanOrEqual(sound.playback === 'one-shot' ? 16 : 12);
    if (sound.playback === 'loop') {
      expect(project.loopRegion).toEqual({ start: 0, end: project.duration, crossfade: 0 });
      expect(sound.duration).toBeGreaterThanOrEqual(10);
      for (const channel of [audio.left, audio.right])
        expect(Math.abs(channel[0] - channel.at(-1)), sound.id).toBeLessThan(.001);
    } else expect(project.loopRegion).toBeUndefined();
    const waveform = Array.from({ length: 160 }, (_, bin) => {
      const start = Math.floor(bin * audio.left.length / 160), end = Math.floor((bin + 1) * audio.left.length / 160);
      let peak = 0;
      for (let i = start; i < end; i++) for (const channel of [audio.left, audio.right])
        if (Math.abs(channel[i]) > Math.abs(peak)) peak = channel[i];
      return Number(peak.toFixed(6));
    });
    expect(waveform, sound.id).toEqual(sound.waveform);
    for (const asset of Object.values(project.assets)) {
      expect(asset.source.quality).toBe('original');
      expect(asset.source.license).toBe('CC0-1.0');
      expect(asset.source.url).toMatch(/^https:\/\/(?:opengameart.org\/content\/|bigsoundbank.com\/)/);
    }
  }
}, 60000);

it('opens localized editable scenes with portable provenance and repeatable engine output', async () => {
  const sound = scenes.find(s => s.id === 'example-nature-forest-morning');
  const bytes = readFileSync(`public/sound-library/${sound.file}`);
  const load = createBuiltinLoader([sound], async () => new Response(Uint8Array.from(bytes)), '/');
  const project = await load(sound.id, '林间清晨');
  expect(project.inputs).toHaveLength(4);
  expect(project.inputs.every(layer => !layer.name.startsWith('builtin.'))).toBe(true);
  expect(project.controls[0].name).not.toContain('builtin.');
  const reopened = parseProject(JSON.parse(JSON.stringify(projectForSave(project))));
  expect(reopened.assets).toEqual(project.assets);
  const first = renderProject(project), again = renderProject(reopened);
  expect(hash(new Uint8Array(first.left.buffer))).toBe(hash(new Uint8Array(again.left.buffer)));
  expect(hash(new Uint8Array(first.right.buffer))).toBe(hash(new Uint8Array(again.right.buffer)));
}, 20000);
