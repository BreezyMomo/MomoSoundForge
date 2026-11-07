import { assetResolver } from '../tools/sound-asset-store.mjs';
const resolveAsset = await assetResolver(process.cwd(), {profile:'audit'});
const readFileSync = (name, ...options) => nodeReadFileSync(resolveAsset(name), ...options);
import { expect, it } from 'vitest';
import { legacyInstrumentLevels, standaloneBoostDb } from '../tools/builtin-levels.mjs';
import { levels } from '../tools/audit-builtin-library.mjs';
import { readFileSync as nodeReadFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseProject } from '../src/model';
import { renderProject } from '../src/engine';


it('removes rejected sources, catalog entries and embedded project copies', () => {
  const quality = JSON.parse(readFileSync('tools/builtin-quality.json', 'utf8'));
  const catalog = JSON.parse(readFileSync('src/data/builtin-catalog.json', 'utf8'));
  const manifest = JSON.parse(readFileSync('samples/orchestra-basics-20261104/manifest.json', 'utf8'));
  for (const entry of quality.excludedStandaloneSamples) {
    expect(catalog.sounds.some(s => s.id === `instrument-${entry.id}`)).toBe(false);
    expect(catalog.sounds.some(s => s.id === `instrument-${entry.replacementSampleId}`)).toBe(true);
    expect(manifest.samples.some(s => s.id === entry.id)).toBe(false);
    for (const folder of ['originals', 'wav'])
      expect(existsSync(`samples/orchestra-basics-20261104/${folder}/percussion/${entry.id}.wav`)).toBe(false);
    for (const file of ['projects/17-timpani.soundforge', 'examples/forest-departure-8s.soundforge', 'review/chapters.json'])
      expect(readFileSync(`samples/orchestra-basics-20261104/${file}`, 'utf8')).not.toContain(entry.id);
  }
});
