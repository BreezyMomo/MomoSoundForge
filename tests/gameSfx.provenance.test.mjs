import { projectFromGraph, prepareTestProject } from './helpers/resourceGraph';
import { assetResolver } from '../tools/sound-asset-store.mjs';
const resolveAsset = await assetResolver(process.cwd(), {profile:'audit'});
const readFileSync = (name, ...options) => nodeReadFileSync(resolveAsset(name), ...options);
import { readFileSync as nodeReadFileSync } from 'node:fs';
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
const read = async sound => {
  const bytes = readFileSync(`public/sound-library/${sound.file}`);
  expect(hash(bytes), sound.id).toBe(sound.sha256);
  return prepareTestProject(await projectFromGraph(JSON.parse(gunzipSync(bytes))));
};


it('ships 66 unique recordings as 19 discoverable sound groups with source and CC0 evidence', async () => {
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
