import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { BUILTIN_SOUNDS, builtinToneKey, builtinToneName, builtinChoiceName, createBuiltinLoader } from '../src/builtinLibrary';
import { catalogs } from '../src/i18n';
import { parseProject, projectForSave } from '../src/model';
import { renderProject } from '../src/engine';
import { levels } from '../tools/audit-builtin-library.mjs';

const root = 'samples/game-sfx-starter-20261105';
const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const recordings = BUILTIN_SOUNDS.filter(s => s.recordingGroup?.startsWith('game-'));
const scenes = BUILTIN_SOUNDS.filter(s => s.id.startsWith('example-game-'));
const read = sound => {
  const bytes = readFileSync(`public/sound-library/${sound.file}`);
  expect(hash(bytes), sound.id).toBe(sound.sha256);
  return parseProject(JSON.parse(gunzipSync(bytes)));
};

it('ships 66 unique recordings as 19 discoverable sound groups with source and CC0 evidence', () => {
  expect(recordings).toHaveLength(66);
  expect(new Set(recordings.map(builtinToneKey)).size).toBe(19);
  expect(new Set(recordings.map(s => s.id))).toEqual(new Set(manifest.samples.map(s => s.id)));
  const originalHashes = new Set(), pcmHashes = new Set();
  for (const sample of manifest.samples) {
    expect(sample.license).toBe('CC0-1.0');
    for (const [file, digest] of [[sample.originalFile, sample.originalSha256], [sample.wavFile, sample.wavSha256]]) {
      expect(file).not.toMatch(/^([/\\]|[a-z]:)|\.\./i);
      expect(hash(readFileSync(`${root}/${file}`)), sample.id).toBe(digest);
    }
    originalHashes.add(sample.originalSha256); pcmHashes.add(sample.pcmSha256);
  }
  expect(originalHashes.size).toBe(66); expect(pcmHashes.size).toBe(66);
  const distributed = JSON.parse(readFileSync('public/sound-library/licenses/sources.json', 'utf8')).sources;
  for (const source of manifest.sources) {
    expect(readFileSync(`${root}/${source.includedLicenseFile}`, 'utf8')).toContain('Creative Commons Zero, CC0');
    const notice = distributed.find(s => s.id === source.id);
    expect(notice.archiveSha256).toBe(source.archiveSha256);
    expect(readFileSync(`public/sound-library/${notice.includedLicenseFile}`, 'utf8')).toContain('Creative Commons Zero, CC0');
  }
  const translated = key => catalogs['zh-CN'][key];
  const wood = recordings.find(s => s.recordingGroup === 'game-footstep-wood');
  expect(builtinToneName(wood, translated)).toBe('木地板脚步');
  expect(builtinChoiceName(wood)).toContain('录音');
  expect(builtinChoiceName(wood)).not.toContain('版本');
});

it('renders short, audible, peak-safe defaults with exactly matching card waveforms', () => {
  for (const sound of [...recordings, ...scenes]) {
    const project = read(sound), audio = renderProject(project);
    const measured = levels([audio.left, audio.right], audio.sampleRate);
    expect(measured.status, sound.id).toBe('ok');
    expect(audio.sourcePeak, sound.id).toBeLessThanOrEqual(.502);
    expect(measured.activeRmsDb, sound.id).toBeGreaterThan(-34);
    expect(project.duration, sound.id).toBe(sound.duration);
    expect(project.duration, sound.id).toBeLessThan(3);
    expect(Math.abs(audio.left.at(-1))).toBe(0); expect(Math.abs(audio.right.at(-1))).toBe(0);
    const waveform = Array.from({ length: 160 }, (_, bin) => {
      let peak = 0;
      for (let i = Math.floor(bin * audio.left.length / 160); i < Math.floor((bin + 1) * audio.left.length / 160); i++)
        for (const channel of [audio.left, audio.right]) if (Math.abs(channel[i]) > Math.abs(peak)) peak = channel[i];
      return Number(peak.toFixed(6)) || 0; // JSON normalizes IEEE negative zero.
    });
    expect(waveform, sound.id).toEqual(sound.waveform);
  }
}, 30000);

it('opens portable editable combinations with audible controls and reproducible output', () => {
  expect(scenes.map(s => s.id)).toEqual(expect.arrayContaining([
    'example-game-wood-impact', 'example-game-metal-impact', 'example-game-body-impact',
    'example-game-wooden-landing', 'example-game-solid-punch',
  ]));
  for (const sound of scenes) {
    const project = read(sound);
    expect(project.recipe).toBeUndefined();
    expect(project.inputs.length).toBeGreaterThan(1);
    const saved = parseProject(JSON.parse(JSON.stringify(projectForSave(project))));
    expect(renderProject(saved).left).toEqual(renderProject(project).left);
    for (const control of project.controls ?? []) {
      const low = renderProject({ ...project, controlValues: { [control.id]: control.min } });
      const high = renderProject({ ...project, controlValues: { [control.id]: control.max } });
      expect(low.left, sound.id).not.toEqual(high.left);
      expect(high.sourcePeak, sound.id).toBeLessThan(1);
    }
  }
}, 30000);

it('loads distinct recordings independently through the normal lazy project loader', async () => {
  const choices = recordings.filter(s => s.recordingGroup === 'game-footstep-wood');
  const fetcher = async url => new Response(Uint8Array.from(readFileSync(`public/sound-library/${url.split('/').at(-1)}`)).buffer);
  const load = createBuiltinLoader(choices, fetcher, '/');
  const a = await load(choices[0].id, 'My footstep');
  const b = await load(choices[1].id, 'Another footstep');
  a.inputs[0].gain = 0;
  expect(b.inputs[0].gain).not.toBe(0);
  expect(b.assets).not.toEqual(a.assets);
  expect((await load(choices[0].id)).name).not.toBe(a.name);
});
