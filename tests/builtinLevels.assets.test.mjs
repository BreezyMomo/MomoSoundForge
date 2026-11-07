import { expect, it } from 'vitest';
import { levels } from '../tools/audit-builtin-library.mjs';
import { readFileSync } from 'node:fs';
import { renderProject } from '../src/engine';
import { BUILTIN_RECORDINGS, createBuiltinRecordingLoader } from '../src/builtinRecordings';
import { resourceProject } from '../src/soundResources';
import { createRemoteLoader, parseRemoteIndex } from '../src/remoteLibrary';

it('ships audible standalone timpani and harp recordings with original pitch metadata', async () => {
  const load = createBuiltinRecordingLoader(BUILTIN_RECORDINGS, async url => new Response(readFileSync(`public${url}`)), '/');
  for (const id of ['17-timpani-2-Cs3-single-hit', '06-harp-1-C3-single-hit']) {
    const resource = await load(id);
    expect(resource.kind).toBe('recording');
    expect(resource.payload.rootMidi).toBe(BUILTIN_RECORDINGS.find(r => r.id === id).rootMidi);
    const audio = renderProject(resourceProject(resource));
    const measured = levels([audio.left, audio.right], audio.sampleRate);
    expect(measured.status).toBe('ok');
    expect(audio.peak).toBeGreaterThan(.03);
    expect(audio.sourcePeak).toBeLessThan(1);
  }
});


it('publishes standalone takes as recordings in the actual selectable library', async () => {
  const url = 'http://localhost/sound-library/index.json';
  const index = parseRemoteIndex(JSON.parse(readFileSync('public/sound-library/index.json', 'utf8')), url);
  const load = createRemoteLoader(index, url, async url => new Response(readFileSync('public' + new URL(url).pathname)));
  for (const id of ['17-timpani-2-Cs3-single-hit', '06-harp-1-C3-single-hit']) {
    expect(index.entries.some(e => e.id === 'instrument-' + id)).toBe(false);
    const entry = index.entries.find(e => e.id === 'builtin-recording-' + id);
    expect(entry?.kind).toBe('recording');
    expect((await load(entry)).kind).toBe('recording');
  }
});
