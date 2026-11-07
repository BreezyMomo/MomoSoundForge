import { assetResolver } from '../tools/sound-asset-store.mjs';
const resolveAsset = await assetResolver(process.cwd(), {profile:'audit'});
const readFileSync = (name, ...options) => nodeReadFileSync(resolveAsset(name), ...options);
import { readFileSync as nodeReadFileSync } from 'node:fs';
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
